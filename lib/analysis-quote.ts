import "server-only";
import { createHash } from "node:crypto";
import { capitalEnvironment, createCapitalRequestContext, getMarketSnapshot, getMarketSummaries, VERIFIED_MARKETS } from "./capital";
import { liveQuotes } from "./live-quotes";
import { HistoryCache } from "./history-cache";
import { normalizeQuote, normalizeStreamingQuote, unavailable, type MarketQuote } from "./quote-normalization";
import { actionableLive, quoteQuality } from "./market-semantics";
import type { AnalysisSymbol } from "./technical-analysis";

const cache = new HistoryCache<MarketQuote>(5000, 12);
export function evaluateQuote(quote: MarketQuote, now = Date.now()): MarketQuote {
  const time = quote.provider_timestamp ?? quote.quote_time;
  const age = time && Number.isFinite(Date.parse(time)) ? (now - Date.parse(time)) / 1000 : null;
  const fresh = age !== null && age >= 0 && age <= 300 && (quote.source_type === "WEBSOCKET" || quote.delay_seconds === 0);
  return { ...quote, age_seconds: age, fresh, actionable_live: actionableLive(quote.market_status, fresh),
    quote_quality: quote.bid === null || quote.ask === null ? "unavailable" : quoteQuality(quote.source_type, age !== null, fresh) };
}

export async function getAnalysisQuote(symbol: AnalysisSymbol) {
  const environment = capitalEnvironment();
  const scope = createHash("sha256").update([process.env.CAPITAL_API_BASE_URL, process.env.CAPITAL_IDENTIFIER, process.env.CAPITAL_API_KEY, process.env.CAPITAL_API_PASSWORD].join("\n")).digest("hex");
  const { value, hit } = await cache.get(`${scope}:${symbol}`, async () => {
    const context = createCapitalRequestContext(), epic = VERIFIED_MARKETS[symbol].epic;
    const [snapshot, summaries, streaming] = await Promise.allSettled([
      getMarketSnapshot(epic, context).then(value => ({ value, receivedAt: new Date().toISOString() })),
      getMarketSummaries([epic], context), liveQuotes([epic], context),
    ]);
    const now = Date.now(), retrieved = new Date(now).toISOString();
    const rest = snapshot.status === "fulfilled" ? normalizeQuote(symbol, epic, snapshot.value.value,
      summaries.status === "fulfilled" ? summaries.value[epic] : undefined, snapshot.value.receivedAt, now) : null;
    const tick = streaming.status === "fulfilled" ? streaming.value.quotes[epic] : undefined;
    const ws = tick ? normalizeStreamingQuote(symbol, tick, rest, now) : null;
    const quote = ws ?? rest ?? unavailable(symbol, epic);
    return { ...quote, provider_timestamp: quote.quote_time, environment, fetched_at_utc: retrieved,
      rest_fallback_reason: ws ? null : "no_valid_stream_tick_for_analysis" };
  });
  return { ...evaluateQuote(value), cache_hit: hit, evaluated_at: new Date().toISOString() };
}
