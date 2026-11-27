import type { Candle, PriceSide } from "./candle-data";

const DAY = 86_400_000;
const weekday = (t: number) => new Date(t).getUTCDay();

/** Sunday 00:00 UTC that opens the trading week containing `time`. */
export function weekStart(time: number): number {
  const day = Math.floor(time / DAY) * DAY;
  return day - weekday(day) * DAY;
}

/**
 * Capital.com publishes the Sunday-evening session as its own DAY bar.
 * Charts (TradingView/MT5) treat it as the opening of Monday's trading day,
 * so it is merged into the following Monday bar. A Sunday bar without its
 * Monday yet is the still-forming start of that day and is never closed.
 */
export function mergeSundaySessions(daily: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < daily.length; i++) {
    const sunday = daily[i], t = Date.parse(sunday.time);
    if (weekday(t) !== 0) { out.push(sunday); continue; }
    const monday = daily[i + 1];
    if (!monday || Date.parse(monday.time) !== t + DAY) {
      out.push(i === daily.length - 1 ? { ...sunday, is_closed: false } : sunday);
      continue;
    }
    const merged: Candle = { ...monday, open: { ...sunday.open }, high: { ...monday.high }, low: { ...monday.low } };
    for (const side of ["bid", "ask"] as PriceSide[]) {
      const values = [sunday.high[side], sunday.low[side], monday.high[side], monday.low[side]];
      if (values.some((v) => v === null) || sunday.open[side] === null) {
        merged.open[side] = merged.high[side] = merged.low[side] = merged.close[side] = null;
        continue;
      }
      merged.high[side] = Math.max(sunday.high[side]!, monday.high[side]!);
      merged.low[side] = Math.min(sunday.low[side]!, monday.low[side]!);
    }
    out.push(merged);
    i++;
  }
  return out;
}

/**
 * Weekly bars from session-merged daily bars. The week runs Sunday 00:00 UTC
 * to the next Sunday 00:00 UTC, so it closes after Friday's session and the
 * Sunday-evening session belongs to the new week (as on standard charts).
 */
export function aggregateWeeks(daily: Candle[], fetchedAt: number, rejectedTimes: (string | null)[] = []): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const bar of daily) {
    const t = Date.parse(bar.time);
    if (t > fetchedAt) continue;
    const start = weekStart(t);
    groups.set(start, [...(groups.get(start) ?? []), bar]);
  }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([start, bars]) => {
    const end = start + 7 * DAY;
    const partial = rejectedTimes.some((time) => time === null || (Date.parse(time) >= start && Date.parse(time) < end));
    const candle: Candle = {
      time: new Date(start).toISOString(), start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      open: { bid: null, ask: null }, high: { bid: null, ask: null }, low: { bid: null, ask: null }, close: { bid: null, ask: null },
      is_closed: end <= fetchedAt && bars.every((b) => b.is_closed), source: "Capital.com DAY",
      first_daily_bar: bars[0].time, last_daily_bar: bars.at(-1)!.time, daily_bars: bars.length,
      history_completeness: partial ? "partial_validation" : "unknown_sessions_not_verified",
    };
    for (const side of ["bid", "ask"] as PriceSide[]) {
      if (bars.some((b) => [b.open, b.high, b.low, b.close].some((p) => p[side] === null))) { candle.history_completeness = "partial_validation"; continue; }
      candle.open[side] = bars[0].open[side];
      candle.high[side] = Math.max(...bars.map((b) => b.high[side]!));
      candle.low[side] = Math.min(...bars.map((b) => b.low[side]!));
      candle.close[side] = bars.at(-1)!.close[side];
    }
    return candle;
  });
}

/** A regular weekend closure (Friday/Saturday end to Sunday/Monday start, at most 50h) is not a data gap. */
export function isWeekendClosure(from: number, to: number): boolean {
  return to > from && to - from <= 50 * 3600_000 && [5, 6].includes(weekday(from)) && [0, 1].includes(weekday(to));
}
