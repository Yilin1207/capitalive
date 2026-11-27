import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { aggregateWeeks, isWeekendClosure, mergeSundaySessions, weekStart } from "../lib/session-candles.ts";
import { closedFrame } from "../lib/knowledge/data.ts";
import { detectFractals, detectFvg } from "../lib/knowledge/detectors.ts";
import type { Candle } from "../lib/candle-data.ts";

const p = (bid: number) => ({ bid, ask: bid + 1 });
const bar = (time: string, o: number, h: number, l: number, c: number, closed = true): Candle =>
  ({ time, open: p(o), high: p(h), low: p(l), close: p(c), is_closed: closed });

test("Sunday session is merged into Monday: Sunday open, combined high/low, Monday close", () => {
  const out = mergeSundaySessions([
    bar("2026-11-13T00:00:00.000Z", 10, 12, 9, 11),
    bar("2026-11-15T00:00:00.000Z", 13, 15, 12.5, 14),
    bar("2026-11-16T00:00:00.000Z", 14, 14.5, 8, 9),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].time, "2026-11-16T00:00:00.000Z");
  assert.deepEqual([out[1].open.bid, out[1].high.bid, out[1].low.bid, out[1].close.bid], [13, 15, 8, 9]);
  assert.deepEqual(mergeSundaySessions(out), out, "idempotent");
  const lone = mergeSundaySessions([bar("2026-11-22T00:00:00.000Z", 1, 2, 0.5, 1.5)]);
  assert.equal(lone[0].is_closed, false, "a Sunday without its Monday is still forming");
});

test("Weeks run Sunday 00:00 UTC to Sunday: Friday close is the weekly close", () => {
  const daily = mergeSundaySessions([
    bar("2026-11-09T00:00:00.000Z", 100, 105, 99, 104),
    bar("2026-11-13T00:00:00.000Z", 104, 106, 101, 102),   // Friday close 102
    bar("2026-11-15T00:00:00.000Z", 103, 120, 103, 119),   // Sunday session -> next week
    bar("2026-11-16T00:00:00.000Z", 119, 121, 118, 120),
  ]);
  const weeks = aggregateWeeks(daily, Date.parse("2026-11-21T12:00:00.000Z"));
  assert.equal(weeks[0].time, "2026-11-08T00:00:00.000Z");
  assert.deepEqual([weeks[0].open.bid, weeks[0].high.bid, weeks[0].low.bid, weeks[0].close.bid], [100, 106, 99, 102]);
  assert.equal(weeks[0].is_closed, true);
  assert.equal(weeks[1].open.bid, 103, "new week opens at the Sunday session");
  assert.equal(weeks[1].is_closed, false);
  assert.equal(weekStart(Date.parse("2026-11-15T22:00:00.000Z")), Date.parse("2026-11-15T00:00:00.000Z"));
});

test("Only the regular weekend is continuous; a missing weekday is still a gap", () => {
  assert.equal(isWeekendClosure(Date.parse("2026-11-14T00:00:00.000Z"), Date.parse("2026-11-16T00:00:00.000Z")), true);
  assert.equal(isWeekendClosure(Date.parse("2026-11-14T00:00:00.000Z"), Date.parse("2026-11-15T22:00:00.000Z")), true);
  assert.equal(isWeekendClosure(Date.parse("2026-11-12T00:00:00.000Z"), Date.parse("2026-11-13T00:00:00.000Z")), false);
  assert.equal(isWeekendClosure(Date.parse("2026-11-14T00:00:00.000Z"), Date.parse("2026-11-17T00:00:00.000Z")), false);
});

test("Recorded NAS100 D1: detectors match an independent chart-style recomputation across weekends", () => {
  const f = JSON.parse(readFileSync("tests/fixtures/htf-NAS100.json", "utf8"));
  const frame = closedFrame(f.data.D1, "bid");
  const bars = frame.bars;
  assert.ok(!bars.some(b => new Date(b.time).getUTCDay() === 0), "no standalone Sunday D1 bars");
  const contiguous = (a: typeof bars[number], b: typeof bars[number]) => a.segment === b.segment;
  // Independent Fractal 3 / FVG per Notion on the same bars.
  const fractals = new Set<string>(), gaps = new Set<string>();
  for (let i = 1; i < bars.length - 1; i++) {
    const [a, b, c] = [bars[i - 1], bars[i], bars[i + 1]];
    if (!contiguous(a, b) || !contiguous(b, c)) continue;
    if (b.high > a.high && b.high > c.high) fractals.add(`high:${b.time}`);
    if (b.low < a.low && b.low < c.low) fractals.add(`low:${b.time}`);
  }
  for (let i = 2; i < bars.length; i++) {
    const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
    if (!contiguous(a, b) || !contiguous(b, c)) continue;
    const lo = Math.min(b.open, b.close), hi = Math.max(b.open, b.close);
    if (c.low > a.high && b.close > b.open && lo <= a.high && hi >= c.low) gaps.add(`${a.high}-${c.low}`);
    if (c.high < a.low && b.close < b.open && lo <= c.high && hi >= a.low) gaps.add(`${c.high}-${a.low}`);
  }
  assert.deepEqual(new Set(detectFractals(frame).map(p => `${p.polarity}:${p.facts.pivot_time}`)), fractals);
  assert.deepEqual(new Set(detectFvg(frame).levels.map(l => `${l.lower}-${l.upper}`)), gaps);
  const segments = new Set(bars.map(b => b.segment)).size;
  assert.ok(segments < bars.length / 20, `weekends must not split D1 history (segments=${segments}, bars=${bars.length})`);
});
