// Public data types and pure validation; no credentials or server imports.
export const TIMEFRAMES = ["W1", "D1", "H4", "MN1"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export type PriceSide = "bid" | "ask";
export const HISTORY = {
  W1: { resolution: "WEEK", limit: 120, seconds: 7 * 86400 },
  D1: { resolution: "DAY", limit: 200, seconds: 86400 },
  H4: { resolution: "HOUR_4", limit: 240, seconds: 4 * 3600 },
  MN1: { resolution: "DAY", limit: 60, seconds: 0 }, // Calendar arithmetic only; never a fixed 30-day month.
} as const;

type Price = Record<PriceSide, number | null>;
export type Candle = {
  time: string;
  open: Price;
  high: Price;
  low: Price;
  close: Price;
  is_closed: boolean;
  start_time?: string;
  end_time?: string;
  source?: "Capital.com DAY";
  first_daily_bar?: string;
  last_daily_bar?: string;
  daily_bars?: number;
  history_completeness?: "unknown_sessions_not_verified" | "partial_validation";
};
export type RejectedCandle = {
  time: string | null;
  reason: "invalid_time" | "future_time" | "no_valid_side" | "crossed_sides";
  // Only allowlisted market prices, never the upstream response object.
  crossed_fields?: { field: "open" | "high" | "low" | "close"; bid: number; ask: number }[];
};
export type CandleResponse = {
  ok: true;
  symbol: string;
  epic: string;
  timeframe: Timeframe;
  provider: "Capital.com";
  environment: "demo" | "live";
  price_side: "bid_ask";
  fetched_at: string;
  candles: Candle[];
  metadata: {
    requested: number;
    returned: number;
    available: number;
    insufficient_history: boolean;
    discarded_rows: number;
    discarded_reasons: { invalid_time: number; future_time: number; no_valid_side: number; crossed_sides: number };
    discarded_sides: number;
    duplicate_rows: number;
    validation_gaps?: string[];
    time_semantics: "provider_bar_start_utc" | "calendar_month_start_utc";
    closure_basis: "successor_or_nominal_interval_elapsed_at_fetch" | "calendar_month_end_elapsed_at_fetch";
    aggregation?: { source: "Capital.com DAY"; calendar: "UTC"; requested_from: string; requested_to: string; pages: number; coverage: "requested_window_fetched"; session_completeness: "unknown" };
    cache_ttl_seconds: number;
    cache_hit: boolean;
    diagnostics: import("./history-diagnostics").HistoryDiagnostics;
  };
};

const fields = ["open", "high", "low", "close"] as const;
type Field = (typeof fields)[number];
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function parseCandleTime(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)?$/.test(value)) return null;
  const date = new Date(/(?:Z|\+00:00)$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return iso.slice(0, 19) === value.slice(0, 19) ? iso : null;
}

export function normalizeCandles(payload: unknown, timeframe: Exclude<Timeframe, "MN1"> | "M1", fetchedAt: number) {
  const prices = object(payload).prices;
  if (!Array.isArray(prices)) throw new Error("Invalid prices schema");
  const byTime = new Map<string, Candle>();
  let discardedRows = 0;
  let discardedSides = 0;
  let duplicateRows = 0;
  const discardedReasons = { invalid_time: 0, future_time: 0, no_valid_side: 0, crossed_sides: 0 };
  const rejected: RejectedCandle[] = [];
  const providerTimes = new Set<string>();
  for (const raw of prices) {
    const row = object(raw);
    const time = parseCandleTime(row.snapshotTimeUTC);
    if (!time) { discardedRows++; discardedReasons.invalid_time++; rejected.push({ time: null, reason: "invalid_time" }); continue; }
    providerTimes.add(time);
    if (Date.parse(time) > fetchedAt) { discardedRows++; discardedReasons.future_time++; rejected.push({ time, reason: "future_time" }); continue; }
    const sides = {} as Record<PriceSide, Record<Field, number> | null>;
    for (const side of ["bid", "ask"] as const) {
      const values = Object.fromEntries(fields.map(field => [field, object(row[`${field}Price`])[side]])) as Record<Field, number>;
      const valid = fields.every(field => typeof values[field] === "number" && Number.isFinite(values[field]))
        && values.low <= Math.min(values.open, values.close)
        && values.high >= Math.max(values.open, values.close);
      sides[side] = valid ? values : null;
      if (!valid) discardedSides++;
    }
    if (!sides.bid && !sides.ask) {
      discardedRows++;
      discardedReasons.no_valid_side++;
      rejected.push({ time, reason: "no_valid_side" });
      continue;
    }
    if (sides.bid && sides.ask && fields.some(field => sides.bid![field] > sides.ask![field])) {
      discardedRows++;
      discardedReasons.crossed_sides++;
      rejected.push({ time, reason: "crossed_sides", crossed_fields: fields
        .filter(field => sides.bid![field] > sides.ask![field])
        .map(field => ({ field, bid: sides.bid![field], ask: sides.ask![field] })) });
      continue;
    }
    const candle = {
      time,
      ...Object.fromEntries(fields.map(field => [field, { bid: sides.bid?.[field] ?? null, ask: sides.ask?.[field] ?? null }])),
      is_closed: Date.parse(time) + (timeframe === "M1" ? 60 : HISTORY[timeframe].seconds) * 1000 <= fetchedAt,
    } as Candle;
    if (byTime.has(time)) duplicateRows++;
    byTime.set(time, candle);
  }
  const candles = [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
  // A successor proves that the preceding provider bar has finished, even at a session boundary.
  candles.slice(0, -1).forEach(candle => { candle.is_closed = true; });
  return { candles, provider_rows: prices.length, provider_times: [...providerTimes].sort(), rejected,
    discarded_rows: discardedRows, discarded_reasons: discardedReasons, discarded_sides: discardedSides, duplicate_rows: duplicateRows };
}

export function parseLimit(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1000) throw new Error("Limit must be an integer from 1 to 1000");
  return Number(value);
}
