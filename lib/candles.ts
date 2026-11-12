import "server-only";
import { createHash } from "node:crypto";
import { CapitalApiError, capitalEnvironment, getHistoricalPrices, VERIFIED_MARKETS, type PublicSymbol } from "@/lib/capital";
import { HISTORY, normalizeCandles, type CandleResponse, type Timeframe } from "@/lib/candle-data";
import { HistoryCache, WindowLimit } from "@/lib/history-cache";
import { historyDiagnostics, type HistoryDiagnostics } from "@/lib/history-diagnostics";
import { aggregateMonths, monthStart } from "@/lib/monthly-candles";

export class HistoryError extends Error {
  constructor(public code: string, message: string, public status: number, public retryAfter = 0, public diagnostics?: HistoryDiagnostics) { super(message); }
}

const TTL_SECONDS = 30;
const cache = new HistoryCache<Omit<CandleResponse, "metadata"> & { quality: ReturnType<typeof normalizeCandles>; aggregation?: CandleResponse["metadata"]["aggregation"] }>(TTL_SECONDS * 1000);
const upstreamBudget = new WindowLimit(24, 60_000);
let activeLoads = 0;
let coolingUntil = 0;

export async function getCandles(symbol: PublicSymbol, timeframe: Timeframe, limit: number): Promise<CandleResponse> {
  if (timeframe === "MN1" && limit > 60) throw new HistoryError("INVALID_LIMIT", "MN1 limit must be from 1 to 60", 400);
  const environment = capitalEnvironment();
  const epic = VERIFIED_MARKETS[symbol].epic;
  // A small finite set of fetch sizes prevents arbitrary query limits from multiplying upstream calls.
  const fetchLimit = limit <= HISTORY[timeframe].limit ? HISTORY[timeframe].limit : Math.ceil(limit / 250) * 250;
  const scope = createHash("sha256").update([
    process.env.CAPITAL_API_BASE_URL, process.env.CAPITAL_IDENTIFIER,
    process.env.CAPITAL_API_KEY, process.env.CAPITAL_API_PASSWORD,
  ].join("\n")).digest("hex");
  const { value, hit } = await cache.get(`${scope}:${environment}:${symbol}:${timeframe}:${fetchLimit}`, async () => {
    if (Date.now() < coolingUntil) throw new HistoryError("CAPITAL_RATE_LIMIT", "Capital.com rate limit reached", 429, Math.ceil((coolingUntil - Date.now()) / 1000));
    if (activeLoads >= 3) throw new HistoryError("HISTORY_BUSY", "History service is busy; retry shortly", 429, 5);
    const retryAfter = upstreamBudget.take("history");
    if (retryAfter) throw new HistoryError("HISTORY_RATE_LIMIT", "History request budget reached", 429, retryAfter);
    activeLoads++;
    try {
      // A small validation reserve can replace rejected rows with older real bars.
      // Never exceed Capital.com's 1000-bar ceiling or synthesize missing prices.
      const rangeEnd = Date.now();
      const rangeStart = monthStart(rangeEnd, 1 - fetchLimit);
      let aggregation: CandleResponse["metadata"]["aggregation"];
      let payload: unknown;
      if (timeframe === "MN1") {
        // Bounded windows contain at most 900 calendar days, below the 1000-row ceiling.
        // Fetch every window even if one is empty (a listing can start later).
        const prices: unknown[] = [];
        let pages = 0;
        for (let from = rangeStart; from <= rangeEnd;) {
          if (pages > 0) {
            const wait = upstreamBudget.take("history");
            if (wait) throw new HistoryError("HISTORY_RATE_LIMIT", "History request budget reached", 429, wait);
          }
          const to = Math.min(rangeEnd, from + 900 * 86400_000 - 1000);
          const page = await getHistoricalPrices(epic, "DAY", 1000, undefined, { from: new Date(from).toISOString(), to: new Date(to).toISOString() }) as { prices?: unknown };
          if (!Array.isArray(page?.prices)) throw new HistoryError("CAPITAL_INVALID_RESPONSE", "Capital.com returned invalid daily candles", 502);
          prices.push(...page.prices);
          pages++;
          from = to + 1000;
        }
        payload = { prices };
        aggregation = { source: "Capital.com DAY", calendar: "UTC", requested_from: new Date(rangeStart).toISOString(), requested_to: new Date(rangeEnd).toISOString(), pages, coverage: "requested_window_fetched", session_completeness: "unknown" };
      } else {
        payload = await getHistoricalPrices(epic, HISTORY[timeframe].resolution, Math.min(1000, fetchLimit + 10));
      }
      const fetchedAt = Date.now();
      let quality: ReturnType<typeof normalizeCandles>;
      try {
        quality = normalizeCandles(payload, timeframe === "MN1" ? "D1" : timeframe, fetchedAt);
        if (timeframe === "MN1") {
          quality.candles = aggregateMonths(quality.candles.filter(bar => Date.parse(bar.time) >= rangeStart && Date.parse(bar.time) <= rangeEnd), fetchedAt, quality.rejected.map(row => row.time));
          quality.provider_times = [...new Set(quality.provider_times.map(time => new Date(monthStart(Date.parse(time))).toISOString()))].sort();
        }
      }
      catch { throw new HistoryError("CAPITAL_INVALID_RESPONSE", "Capital.com returned invalid candles", 502); }
      if (!quality.candles.length) throw new HistoryError("CANDLES_UNAVAILABLE", "No valid historical candles available for this instrument", 404, 0,
        historyDiagnostics(quality, [], timeframe, fetchedAt, fetchedAt, TTL_SECONDS));
      return {
        ok: true, symbol, epic, timeframe, provider: "Capital.com", environment,
        price_side: "bid_ask", fetched_at: new Date(fetchedAt).toISOString(), candles: quality.candles, quality, aggregation,
      };
    } catch (error) {
      if (error instanceof CapitalApiError && error.code === "CAPITAL_RATE_LIMIT") {
        const retryAfter = Math.max(60, error.retryAfter ?? 0);
        coolingUntil = Date.now() + retryAfter * 1000;
        throw new HistoryError("CAPITAL_RATE_LIMIT", "Capital.com rate limit reached", 429, retryAfter);
      }
      if (error instanceof CapitalApiError && (error.status === 404 || (error.status === 400 && error.code === "CAPITAL_UPSTREAM"))) {
        throw new HistoryError("CANDLES_UNAVAILABLE", "Capital.com historical data is unavailable for this instrument", 404);
      }
      throw error;
    } finally { activeLoads--; }
  });
  const { quality, aggregation, ...data } = value;
  const candles = data.candles.slice(-limit);
  return { ...data, candles, metadata: {
    requested: limit, returned: candles.length, available: data.candles.length,
    insufficient_history: candles.length < limit,
    discarded_rows: quality.discarded_rows, discarded_sides: quality.discarded_sides,
    discarded_reasons: quality.discarded_reasons,
    duplicate_rows: quality.duplicate_rows, time_semantics: timeframe === "MN1" ? "calendar_month_start_utc" : "provider_bar_start_utc",
    validation_gaps: [...new Set(quality.rejected.flatMap(row => row.time && !quality.candles.some(c => c.time === row.time) ? [row.time] : []))].sort(),
    closure_basis: timeframe === "MN1" ? "calendar_month_end_elapsed_at_fetch" : "successor_or_nominal_interval_elapsed_at_fetch",
    ...(aggregation ? { aggregation } : {}),
    cache_ttl_seconds: TTL_SECONDS, cache_hit: hit,
    diagnostics: historyDiagnostics(quality, candles, timeframe, Date.parse(data.fetched_at), Date.now(), TTL_SECONDS),
  } };
}
