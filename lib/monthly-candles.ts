import { type Candle, type PriceSide } from "./candle-data";

export function monthStart(time: number, offset = 0): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
}

// Only daily observations are admitted by the caller. No weekly splitting or gap filling.
export function aggregateMonths(daily: Candle[], fetchedAt: number, rejectedTimes: (string | null)[] = []): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const bar of [...new Map(daily.map(bar => [bar.time, bar])).values()].sort((a, b) => a.time.localeCompare(b.time))) {
    const start = monthStart(Date.parse(bar.time));
    if (Date.parse(bar.time) > fetchedAt) continue;
    groups.set(start, [...(groups.get(start) ?? []), bar]);
  }
  return [...groups].map(([start, bars]) => {
    const end = monthStart(start, 1);
    const candle: Candle = {
      time: new Date(start).toISOString(), start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      open: { bid: null, ask: null }, high: { bid: null, ask: null }, low: { bid: null, ask: null }, close: { bid: null, ask: null },
      is_closed: end <= fetchedAt, source: "Capital.com DAY", first_daily_bar: bars[0].time,
      last_daily_bar: bars.at(-1)!.time, daily_bars: bars.length,
      history_completeness: rejectedTimes.some(time => time === null || (Date.parse(time) >= start && Date.parse(time) < end))
        ? "partial_validation" : "unknown_sessions_not_verified",
    };
    for (const side of ["bid", "ask"] as PriceSide[]) {
      // A missing side anywhere makes that monthly side incomplete; never silently skip it.
      if (bars.some(bar => [bar.open, bar.high, bar.low, bar.close].some(price => price[side] === null))) {
        candle.history_completeness = "partial_validation";
        continue;
      }
      candle.open[side] = bars[0].open[side];
      candle.high[side] = Math.max(...bars.map(bar => bar.high[side]!));
      candle.low[side] = Math.min(...bars.map(bar => bar.low[side]!));
      candle.close[side] = bars.at(-1)!.close[side];
    }
    return candle;
  });
}
