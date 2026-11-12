import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY, TIMEFRAMES, normalizeCandles, parseCandleTime, parseLimit } from "../lib/candle-data.ts";
import { HistoryCache, WindowLimit } from "../lib/history-cache.ts";

export function price(time = "2026-10-19T00:00:00", shift = 0) {
  return { snapshotTimeUTC: time, snapshotTime: "1999-01-01T00:00:00",
    openPrice: { bid: 100 + shift, ask: 102 + shift }, highPrice: { bid: 110 + shift, ask: 113 + shift },
    lowPrice: { bid: 90 + shift, ask: 91 + shift }, closePrice: { bid: 105 + shift, ask: 108 + shift } };
}
const now = Date.parse("2026-10-21T13:00:00Z");

test("strict UTC timestamps: never uses local time or accepts date rollover", () => {
  assert.equal(parseCandleTime("2026-10-21T12:00:00"), "2026-10-21T12:00:00.000Z");
  assert.equal(parseCandleTime("2026-10-21T12:00:00.123Z"), "2026-10-21T12:00:00.123Z");
  for (const value of [null, "2026-02-30T00:00:00", "2026-10-21", "2026-10-21T12:00:00+03:00", "garbage"]) assert.equal(parseCandleTime(value), null);
});

test("sorts and deduplicates provider timestamps, preserves both OHLC sides exactly", () => {
  const result = normalizeCandles({ prices: [price("2026-10-21T12:00:00"), price(), price("2026-10-21T12:00:00", 5)] }, "H4", now);
  assert.equal(result.duplicate_rows, 1);
  assert.deepEqual(result.candles.map(c => c.time), ["2026-10-19T00:00:00.000Z", "2026-10-21T12:00:00.000Z"]);
  assert.deepEqual(result.candles[1].close, { bid: 110, ask: 113 });
  assert.equal(result.candles[0].is_closed, true);
  assert.equal(result.candles[1].is_closed, false);
});

test("bad OHLC side becomes null without averaging or copying the other side", () => {
  const row = price(); row.highPrice.bid = 99;
  const result = normalizeCandles({ prices: [row] }, "D1", now);
  assert.equal(result.discarded_sides, 1);
  assert.deepEqual(result.candles[0].open, { bid: null, ask: 102 });
  assert.deepEqual(result.candles[0].high, { bid: null, ask: 113 });
});

test("discards crossed sides, future and invalid timestamps, non-finite and invalid OHLC", () => {
  const crossed = price(); crossed.openPrice.ask = 99;
  const invalid = price(); invalid.highPrice = { bid: NaN, ask: Infinity };
  const invalidRange = price(); invalidRange.lowPrice = { bid: 200, ask: 210 };
  const result = normalizeCandles({ prices: [crossed, invalid, invalidRange, price("2026-10-22T00:00:00"), { ...price(), snapshotTimeUTC: null }] }, "H4", now);
  assert.equal(result.candles.length, 0);
  assert.equal(result.discarded_rows, 5);
  assert.deepEqual(result.discarded_reasons, { crossed_sides: 1, no_valid_side: 2, future_time: 1, invalid_time: 1 });
  assert.throws(() => normalizeCandles({}, "D1", now));
});

for (const timeframe of TIMEFRAMES.filter(t => t !== "MN1")) test(`${timeframe}: closure is calculated as of fetch time, including exact boundary`, () => {
  const start = Date.parse("2026-10-19T00:00:00Z");
  const end = start + HISTORY[timeframe].seconds * 1000;
  assert.equal(normalizeCandles({ prices: [price()] }, timeframe, end - 1).candles[0].is_closed, false);
  assert.equal(normalizeCandles({ prices: [price()] }, timeframe, end).candles[0].is_closed, true);
});

test("limits default correctly and reject overflow, zero, decimals and malformed numbers", () => {
  for (const timeframe of TIMEFRAMES) assert.equal(parseLimit(null, HISTORY[timeframe].limit), HISTORY[timeframe].limit);
  assert.equal(parseLimit("1000", 120), 1000);
  for (const input of ["", "0", "-1", "1001", "2.5", "1e2", "Infinity", "020"]) assert.throws(() => parseLimit(input, 200));
});

test("cache coalesces concurrent requests, expires and never saves failures", async () => {
  const cache = new HistoryCache<number>(30, 2);
  let loads = 0;
  const load = async () => ++loads;
  const results = await Promise.all([cache.get("x", load), cache.get("x", load)]);
  assert.deepEqual(results.map(r => r.value), [1, 1]);
  assert.equal(loads, 1);
  assert.equal((await cache.get("x", load)).hit, true);
  await cache.get("x", load, Date.now() + 1000);
  assert.equal(loads, 2);
  await assert.rejects(cache.get("bad", async () => { throw new Error("unavailable"); }));
  assert.equal((await cache.get("bad", load)).hit, false);
  assert.equal((await cache.get("different-environment", load)).hit, false);
});

test("bounded limiter rejects over-budget requests and resets after its window", () => {
  const limiter = new WindowLimit(2, 1000, 2);
  assert.equal(limiter.take("a", 0), 0);
  assert.equal(limiter.take("a", 0), 0);
  assert.equal(limiter.take("a", 500), 1);
  assert.equal(limiter.take("b", 500), 0);
  assert.equal(limiter.take("c", 500), 1);
  assert.equal(limiter.take("a", 1001), 0);
});
