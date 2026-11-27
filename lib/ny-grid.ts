import type { Candle, PriceSide } from "./candle-data";

/** Candle grid of a request: New York close (17:00 America/New_York) or the provider UTC grid. */
export const GRIDS = ["ny", "utc"] as const;
export type Grid = (typeof GRIDS)[number];
/** Grid actually used for one timeframe's bars (reported per TF; MN1/W1 are not rebuilt from intraday). */
export type BarGrid = "ny" | "utc" | "utc_week" | "utc_calendar";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });

/** America/New_York UTC offset in ms (negative: -5h EST / -4h EDT), IANA DST rules via Intl. */
export function nyOffset(ms: number): number {
  const p = Object.fromEntries(parts.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Start (UTC ms) of the NY trading day containing `ms`: the latest 17:00 America/New_York at or before it.
 * Sunday 17:00 ET therefore opens Monday's day. US DST switches at 02:00 on a Sunday, inside the closed weekend. */
export function nyDayStart(ms: number): number {
  const local = ms + nyOffset(ms);
  const startLocal = Math.floor((local - 17 * HOUR) / DAY) * DAY + 17 * HOUR;
  const guess = startLocal - nyOffset(ms);
  return startLocal - nyOffset(guess);
}

/** UTC ms start of the H4/D1 bucket containing `ms` on the given grid. */
export function bucketStart(ms: number, tf: "H4" | "D1", grid: Grid): number {
  const size = tf === "H4" ? 4 * HOUR : DAY;
  if (grid === "utc") return Math.floor(ms / size) * size;
  const day = nyDayStart(ms);
  return tf === "D1" ? day : day + Math.floor((ms - day) / size) * size;
}

/** UTC ms end of the bucket that starts at `start` (a 25h/23h DST weekend day is never cut into a stub). */
export function bucketEnd(start: number, tf: "H4" | "D1", grid: Grid): number {
  if (grid === "utc") return start + (tf === "H4" ? 4 : 24) * HOUR;
  const dayEnd = nyDayStart(nyDayStart(start) + 26 * HOUR);
  return tf === "D1" ? dayEnd : Math.min(start + 4 * HOUR, dayEnd);
}

/**
 * Aggregate closed provider HOUR bars into NY-close H4/D1 buckets. Open = first hour's open, Close = last
 * hour's close, High/Low = extremes; a side with a missing hour is left null (never interpolated). A bucket
 * containing a rejected provider hour is marked partial_validation. Only buckets starting at or after
 * `from` are returned so a fetch window never yields a truncated first bucket.
 */
export function aggregateNy(hours: Candle[], tf: "H4" | "D1", fetchedAt: number, from: number, rejectedTimes: (string | null)[] = []): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const bar of hours) {
    const t = Date.parse(bar.time);
    if (t > fetchedAt) continue;
    const start = bucketStart(t, tf, "ny");
    if (start < from) continue;
    groups.set(start, [...(groups.get(start) ?? []), bar]);
  }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([start, bars]) => {
    const end = bucketEnd(start, tf, "ny");
    const partial = rejectedTimes.some((time) => time === null || (Date.parse(time) >= start && Date.parse(time) < end));
    const candle: Candle = {
      time: new Date(start).toISOString(), start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      open: { bid: null, ask: null }, high: { bid: null, ask: null }, low: { bid: null, ask: null }, close: { bid: null, ask: null },
      is_closed: end <= fetchedAt && bars.every((b) => b.is_closed), source: "Capital.com HOUR",
      ...(partial ? { history_completeness: "partial_validation" as const } : {}),
    };
    for (const side of ["bid", "ask"] as PriceSide[]) {
      if (bars.some((b) => [b.open, b.high, b.low, b.close].some((p) => p[side] === null))) continue;
      candle.open[side] = bars[0].open[side];
      candle.high[side] = Math.max(...bars.map((b) => b.high[side]!));
      candle.low[side] = Math.min(...bars.map((b) => b.low[side]!));
      candle.close[side] = bars.at(-1)!.close[side];
    }
    return candle;
  });
}
