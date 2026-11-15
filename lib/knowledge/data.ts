import type { CandleResponse, PriceSide, Timeframe } from "../candle-data";
import { HISTORY } from "../candle-data";
export type Bar = {
  index: number;
  time: string;
  end: string;
  open: number;
  high: number;
  low: number;
  close: number;
  segment: number;
};
export type Frame = {
  timeframe: Timeframe;
  side: PriceSide;
  bars: Bar[];
  status: "PARTIAL" | "UNVERIFIED";
  warnings: string[];
  as_of: string;
  symbol: string;
};
export function closedFrame(
  data: CandleResponse,
  side: PriceSide,
  asOf = data.fetched_at,
): Frame {
  const now = Date.parse(asOf),
    fetched = Date.parse(data.fetched_at),
    bars: Bar[] = [],
    warnings = new Set<string>(["SESSION_COVERAGE_NOT_INDEPENDENTLY_VERIFIED"]);
  let segment = 0,
    previous = -Infinity,
    formingSeen = false;
  const rejected = (
    data.metadata.validation_gaps ??
    data.metadata.diagnostics.missing_filtered_times
  ).map(Date.parse);
  const fatal =
    !Number.isFinite(now) ||
    !Number.isFinite(fetched) ||
    data.metadata.discarded_reasons.invalid_time > 0;
  for (let index = 0; index < data.candles.length; index++) {
    const c = data.candles[index],
      t = Date.parse(c.time),
      end =
        data.timeframe === "MN1"
          ? Date.UTC(
              new Date(t).getUTCFullYear(),
              new Date(t).getUTCMonth() + 1,
              1,
            )
          : t + HISTORY[data.timeframe].seconds * 1000;
    if (!Number.isFinite(t) || t <= previous) {
      warnings.add("INVALID_TIME_ORDER");
      segment++;
      continue;
    }
    previous = t;
    if (t > now) continue;
    if (!c.is_closed || end > now || end > fetched) {
      formingSeen = true;
      segment++;
      continue;
    }
    if (formingSeen) {
      warnings.add("CLOSED_AFTER_FORMING");
      segment++;
      continue;
    }
    const values = [c.open[side], c.high[side], c.low[side], c.close[side]];
    if (
      values.some((v) => v === null || !Number.isFinite(v) || v! <= 0) ||
      c.low[side]! > Math.min(c.open[side]!, c.close[side]!) ||
      c.high[side]! < Math.max(c.open[side]!, c.close[side]!) ||
      c.history_completeness === "partial_validation" ||
      ["open", "high", "low", "close"].some((f) => {
        const p = c[f as "open"];
        return p.bid !== null && p.ask !== null && p.bid > p.ask;
      })
    ) {
      warnings.add("INVALID_OHLC");
      segment++;
      continue;
    }
    const prev = bars.at(-1);
    if (
      prev &&
      (Date.parse(prev.end) !== t ||
        rejected.some((x) => x >= Date.parse(prev.time) && x <= t))
    ) {
      segment++;
      warnings.add("GAP_BOUNDARY_NO_PATTERN_STITCHING");
    }
    if (rejected.includes(t)) {
      segment++;
      warnings.add("KNOWN_REJECTED_BAR");
      continue;
    }
    bars.push({
      index,
      time: c.time,
      end: new Date(end).toISOString(),
      open: c.open[side]!,
      high: c.high[side]!,
      low: c.low[side]!,
      close: c.close[side]!,
      segment,
    });
  }
  if (data.metadata.insufficient_history)
    warnings.add("REQUESTED_HISTORY_INCOMPLETE");
  if (data.metadata.discarded_rows || data.metadata.discarded_sides)
    warnings.add("PROVIDER_VALIDATION_LOSS");
  if (fatal) warnings.add("UNLOCATABLE_OR_INVALID_TIME");
  return {
    timeframe: data.timeframe,
    side,
    bars: fatal ? [] : bars,
    status: fatal || !bars.length ? "UNVERIFIED" : "PARTIAL",
    warnings: [...warnings],
    as_of: asOf,
    symbol: data.symbol,
  };
}
export function contiguous(bars: Bar[]) {
  return bars.length > 0 && bars.every((b) => b.segment === bars[0].segment);
}
