import "server-only";
import { archiveConfigured, findQuote } from "./archive";
import { capitalEnvironment, CapitalApiError, getHistoricalPrices, VERIFIED_MARKETS, type PublicSymbol } from "./capital";
import { normalizeCandles } from "./candle-data";
import { HistoryError } from "./candles";

export async function quoteAt(symbol: PublicSymbol, at: string) {
  const time = Date.parse(at);
  const environment = capitalEnvironment();
  const base = { symbol, epic: VERIFIED_MARKETS[symbol].epic, environment, provider: "Capital.com", requested_at: at };
  let archiveStatus = archiveConfigured() ? "ready" : "not_configured";
  let previous = null;
  if (archiveConfigured()) {
    try {
      const exact = await findQuote(symbol, environment, time, "exact");
      if (exact) return { ...base, ok: true, status: "exact_tick", exact: true, quote: exact, temporal_deviation_seconds: 0,
        received_after_requested_seconds: (Date.parse(exact.received_at_utc) - time) / 1000, archive_status: archiveStatus };
      previous = await findQuote(symbol, environment, time, "before");
    } catch { archiveStatus = "unavailable"; }
  }
  const start = Math.floor(time / 60_000) * 60_000;
  let payload;
  try {
    payload = await getHistoricalPrices(base.epic, "MINUTE", 2, undefined, {
      from: new Date(start).toISOString(), to: new Date(start + 59_000).toISOString(),
    });
  } catch (error) {
    // An absent historical range is not an exact tick. Auth/network errors must remain errors.
    if (!(error instanceof CapitalApiError) || error.status !== 404) throw error;
    payload = { prices: [] };
  }
  const fetchedAt = new Date().toISOString();
  let normalized;
  try { normalized = normalizeCandles(payload, "M1", Date.parse(fetchedAt)); }
  catch { throw new HistoryError("CAPITAL_INVALID_RESPONSE", "Capital.com returned invalid historical prices", 502); }
  const candle = normalized.candles.find(bar => Date.parse(bar.time) === start);
  return { ...base, ok: true, status: candle ? "interval_estimate" : "no_data", exact: false, quote: null,
    reason: "exact_tick_unavailable", archive_status: archiveStatus, fetched_at_utc: fetchedAt,
    interval: candle ? { start: candle.time, end: new Date(start + 60_000).toISOString(), end_exclusive: true,
      timeframe: "M1", source_type: "CAPITAL_HISTORICAL_MINUTE", candle,
      includes_prices_after_requested_at: time < start + 60_000, is_exact_tick: false } : null,
    previous_observation: previous ? { quote: previous, is_exact_at_requested_time: false,
      temporal_deviation_seconds: (Date.parse(previous.provider_timestamp!) - time) / 1000,
      received_after_requested_seconds: (Date.parse(previous.received_at_utc) - time) / 1000 } : null,
    discarded_rows: normalized.discarded_rows,
  };
}
