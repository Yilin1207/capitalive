import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Candle, CandleResponse, Timeframe } from "../lib/candle-data";
import { historyDiagnostics } from "../lib/history-diagnostics";
import { analyzeSeries, targetMap, type AnalysisSymbol } from "../lib/technical-analysis";
import { checkConsistency } from "../lib/analysis-consistency";
import { evaluateQuote } from "../lib/analysis-quote";
import { normalizeQuote, unavailable } from "../lib/quote-normalization";
import { chartSvg } from "../lib/chart-svg";
import sharp from "sharp";

export function bar(index: number, high: number, low = high - 2, closed = true): Candle {
  const price = (bid: number) => ({ bid, ask: bid + 0.01 });
  return { time: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(), open: price((high + low) / 2),
    high: price(high), low: price(low), close: price((high + low) / 2), is_closed: closed };
}
export function response(candles: Candle[], timeframe: Timeframe = "D1"): CandleResponse {
  const now = Date.parse(candles.at(-1)?.time ?? "2026-01-01T00:00:00Z");
  return { ok: true, symbol: "NAS100", epic: "US100", timeframe, environment: "demo", provider: "Capital.com", price_side: "bid_ask", fetched_at: new Date(now).toISOString(), candles,
    metadata: { requested: candles.length, returned: candles.length, available: candles.length, insufficient_history: false,
      discarded_rows: 0, discarded_reasons: { invalid_time: 0, future_time: 0, no_valid_side: 0, crossed_sides: 0 },
      discarded_sides: 0, duplicate_rows: 0, time_semantics: "provider_bar_start_utc", closure_basis: "successor_or_nominal_interval_elapsed_at_fetch",
      cache_ttl_seconds: 30, cache_hit: false, diagnostics: historyDiagnostics({ provider_rows: candles.length, provider_times: candles.map(c => c.time), rejected: [] }, candles, timeframe, now, now, 30) } };
}
const analysis = (candles: Candle[]) => analyzeSeries(response(candles), "NAS100");

test("strict fractal needs TWO closed right bars; forming center/right and ties cannot confirm", () => {
  const candles = [8, 9, 12, 10, 9].map((h, i) => bar(i, h));
  candles[4].is_closed = false;
  assert.equal(analysis(candles).fractals.length, 0);
  assert.equal(analysis(candles).forming_fractals.find(f => f.index === 2)?.right_closed_bars, 1);
  candles[4].is_closed = true;
  const high = analysis(candles).fractals.find(f => f.kind === "high")!;
  assert.equal(high.price, 12);
  assert.equal(high.confirmation_bar_time, candles[4].time);
  assert.equal(high.confirmed_at, "2026-01-06T00:00:00.000Z");
  candles[3].high.bid = 12;
  assert.equal(analysis(candles).fractals.length, 0);
  candles[3].high.bid = 10;
  candles[2].is_closed = false;
  assert.equal(analysis(candles).fractals.length, 0);
});

test("low fractals mirror high rules; equality on the left also rejects", () => {
  const candles = [8, 7, 3, 6, 8].map((l, i) => bar(i, 12, l));
  assert.equal(analysis(candles).fractals[0].kind, "low");
  candles[0].low.bid = 3;
  assert.equal(analysis(candles).fractals.length, 0);
});

test("equal touch by a forming candle is separate from a strict sweep; both timestamps persist", () => {
  const candles = [8, 9, 12, 10, 9, 12].map((h, i) => bar(i, h, h - 2, i !== 5));
  let high = analysis(candles).fractals[0];
  assert.equal(high.status, "confirmed");
  assert.equal(high.liquidity_status, "touched");
  assert.equal(high.touched_at, candles[5].time);
  assert.equal(high.swept_at, null);
  assert.equal(high.touched_by_forming_candle, true);
  assert.equal(targetMap([analysis(candles)], 11).above.nearest?.liquidity_status, "touched");
  candles.push(bar(6, 12.01, 10, false));
  high = analysis(candles).fractals[0];
  assert.equal(high.liquidity_status, "swept");
  assert.equal(high.touched_at, candles[5].time);
  assert.equal(high.swept_at, candles[6].time);
  assert.equal(high.swept_by_forming_candle, true);
});

test("low touch is equality; strict penetration sweeps without a close-back requirement", () => {
  const candles = [8, 7, 3, 6, 8, 3].map((l, i) => bar(i, 12, l, i !== 5));
  let low = analysis(candles).fractals.find(f => f.kind === "low")!;
  assert.equal(low.liquidity_status, "touched"); assert.equal(low.swept_at, null);
  candles.push(bar(6, 4, 2.99, false));
  low = analysis(candles).fractals.find(f => f.kind === "low")!;
  assert.equal(low.liquidity_status, "swept"); assert.equal(low.swept_at, candles[6].time);
});

test("explicit H4 range honors confirmed IDs instead of latest automatic pivots; rejects invalid pairs", () => {
  const candles = [[8, 6], [9, 7], [12, 8], [10, 7], [9, 6], [7, 3], [8, 5], [9, 6], [11, 7], [9, 6], [8, 5]].map(([h, l], i) => bar(i, h, l));
  const data = response(candles, "H4"), auto = analyzeSeries(data, "NAS100");
  const high = auto.fractals.find(f => f.price === 12)!, low = auto.fractals.find(f => f.kind === "low")!;
  const selection = { high_id: high.id, low_id: low.id };
  const explicit = analyzeSeries(data, "NAS100", "bid", {}, undefined, selection);
  assert.equal(explicit.ranges.selection_mode, "explicit_fractals");
  assert.equal(explicit.ranges.selected.high?.id, high.id);
  assert.equal(explicit.ranges.selected.low?.id, low.id);
  assert.equal(explicit.ranges.selected.upper, 12); assert.equal(explicit.ranges.selected.equilibrium, 7.5);
  assert.equal(explicit.ranges.automatic?.upper, 11);
  assert.throws(() => analyzeSeries(data, "NAS100", "ask", {}, undefined, selection), { code: "INVALID_RANGE_SELECTION" });
  assert.throws(() => analyzeSeries(response(candles), "NAS100", "bid", {}, undefined, selection), { code: "INVALID_RANGE_SELECTION" });
  assert.throws(() => analyzeSeries(data, "NAS100", "bid", {}, undefined, { ...selection, high_id: low.id }), { code: "INVALID_RANGE_SELECTION" });
  assert.throws(() => analyzeSeries(data, "NAS100", "bid", {}, undefined, { ...selection, low_id: "H4:bid:low:1900-01-01T00:00:00.000Z" }), { code: "INVALID_RANGE_SELECTION" });
});

test("ranges use confirmed pivots, exact EQ, provenance, alternatives; missing pivot stays unconfirmed", () => {
  const candles = [[8, 6], [9, 7], [12, 8], [10, 7], [9, 6], [7, 3], [8, 5], [9, 6], [11, 7], [9, 6], [8, 5]].map(([h, l], i) => bar(i, h, l));
  const result = analysis(candles), r = result.ranges.selected;
  assert.equal(r.status, "confirmed");
  assert.equal(r.upper, 11); assert.equal(r.lower, 3); assert.equal(r.equilibrium, 7);
  assert.deepEqual(r.discount, [3, 7]); assert.deepEqual(r.premium, [7, 11]);
  assert.ok(result.fractals.some(f => f.id === r.high!.id));
  assert.ok(result.fractals.some(f => f.id === r.low!.id));
  assert.equal(result.ranges.alternatives[0].upper, 12);
  assert.equal(result.ranges.reaction_strength, null);
  const missing = analysis(candles.slice(0, 5)).ranges.selected;
  assert.equal(missing.status, "unconfirmed"); assert.equal(missing.equilibrium, null); assert.equal(missing.low, null);
});

test("known validation holes are never bridged into a five-bar fractal or FVG", () => {
  const data = response([8, 9, 12, 10, 9].map((h, i) => bar(i, h)));
  data.metadata.validation_gaps = ["2026-01-04T12:00:00.000Z"];
  assert.equal(analyzeSeries(data, "NAS100").fractals.length, 0);
  data.metadata.validation_gaps = [];
  data.candles[3].high.bid = null;
  assert.equal(analyzeSeries(data, "NAS100").fractals.length, 0);
});

test("missing calendar month or incomplete monthly source cannot confirm a monthly fractal", () => {
  const data = response([8, 9, 12, 10, 9].map((h, i) => ({ ...bar(i, h), time: new Date(Date.UTC(2025, i, 1)).toISOString() })), "MN1");
  assert.equal(analyzeSeries(data, "NAS100").fractals.length, 1);
  data.candles[4].time = "2025-06-01T00:00:00.000Z";
  assert.equal(analyzeSeries(data, "NAS100").fractals.length, 0);
  data.candles[4].time = "2025-05-01T00:00:00.000Z";
  data.candles[1].history_completeness = "partial_validation";
  assert.equal(analyzeSeries(data, "NAS100").fractals.length, 0);
});

test("unlocatable invalid timestamps suppress confirmations rather than assume adjacency", () => {
  const data = response([8, 9, 12, 10, 9].map((h, i) => bar(i, h)));
  data.metadata.discarded_reasons.invalid_time = 1;
  const result = analyzeSeries(data, "NAS100");
  assert.equal(result.fractals.length, 0);
  assert.ok(result.warnings.includes("UNLOCATABLE_REJECTED_ROWS_CONFIRMATIONS_SUPPRESSED"));
});

test("bullish FVG tracks progressive wick penetration including forming bar, then full fill", () => {
  const candles = [bar(0, 10, 8), bar(1, 14, 9), bar(2, 16, 12)];
  let gap = analysis(candles).fvgs[0];
  assert.deepEqual([gap.lower, gap.upper, gap.status, gap.fill_percent], [10, 12, "untouched", 0]);
  candles.push(bar(3, 15, 11, false));
  gap = analysis(candles).fvgs[0];
  assert.equal(gap.status, "partial"); assert.equal(gap.fill_percent, 50);
  assert.equal(gap.remaining_lower, 10); assert.equal(gap.remaining_upper, 11);
  assert.equal(gap.last_touch_at, candles[3].time);
  candles.push(bar(4, 13, 9, false));
  gap = analysis(candles).fvgs[0];
  assert.equal(gap.status, "filled"); assert.equal(gap.remaining_lower, null); assert.equal(gap.material, false);
});

test("bearish FVG uses upper residual; open third candle is provisional only", () => {
  const candles = [bar(0, 16, 14), bar(1, 15, 10), bar(2, 12, 8, false)];
  assert.equal(analysis(candles).fvgs.length, 0);
  assert.equal(analysis(candles).forming_fvgs.length, 1);
  candles[2].is_closed = true; candles.push(bar(3, 13, 9, false));
  const gap = analysis(candles).fvgs[0];
  assert.equal(gap.direction, "bearish"); assert.equal(gap.fill_percent, 50);
  assert.equal(gap.remaining_lower, 13); assert.equal(gap.remaining_upper, 14);
});

test("EURUSD residual 0.2 pip remains visible but is NOT a material target; settings and ATR apply", () => {
  const data = response([bar(0, 1.101, 1.100), bar(1, 1.103, 1.1005), bar(2, 1.104, 1.102), bar(3, 1.103, 1.10102, false)]);
  const result = analyzeSeries(data, "EURUSD");
  const gap = result.fvgs[0];
  assert.ok(Math.abs(gap.remaining_units - 0.2) < 1e-8);
  assert.ok(Math.abs(gap.fill_percent - 98) < 1e-8);
  assert.equal(gap.material, false);
  assert.equal(targetMap([result], 1.100).above.nearest, null);
  assert.equal(analyzeSeries(data, "EURUSD", "bid", { min_remaining_units: 0.1, atr_fraction: 0 }).fvgs[0].material, true);
  assert.equal(analyzeSeries(data, "EURUSD", "bid", { min_remaining_units: 0, atr_fraction: 1 }).fvgs[0].material, false);
});

test("nearest D1+ target respects side, swept/filled/material exclusions and intermediate H4 obstacles", () => {
  const candles = [8, 9, 12, 10, 9].map((h, i) => bar(i, h, 6));
  const d1 = analyzeSeries(response(candles, "D1"), "NAS100");
  const h4 = analyzeSeries(response([8, 9, 11, 10, 9].map((h, i) => bar(i, h, 6)), "H4"), "NAS100");
  let targets = targetMap([d1, h4], 10);
  assert.equal(targets.above.nearest?.price, 12);
  assert.equal(targets.above.nearest?.timeframe, "D1");
  assert.equal(targets.above.intermediate_obstacles[0].price, 11);
  assert.equal(targetMap([h4], 10).above.nearest, null);
  d1.fractals[0].liquidity_status = "swept";
  targets = targetMap([d1, h4], 10);
  assert.equal(targets.above.nearest, null);
  assert.equal(targetMap([d1], null).above.nearest, null);
});

test("cross timeframe checker flags contradictory closed extrema but skips forming snapshots", () => {
  const daily = response([bar(0, 10, 5)]);
  const intraday = response([bar(0, 11, 6)], "H4");
  const result = checkConsistency({ D1: daily, H4: intraday }, "bid");
  assert.equal(result.status, "mismatch"); assert.equal(result.checked_child_bars, 1);
  intraday.candles[0].high.bid = 9;
  assert.equal(checkConsistency({ D1: daily, H4: intraday }, "bid").status, "no_contradiction_in_checked_bars");
  daily.candles[0].is_closed = false;
  assert.equal(checkConsistency({ D1: daily, H4: intraday }, "bid").status, "not_checkable");
});

test("fresh retrieval cannot substitute a missing/stale/future provider tick timestamp", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const base = { ...unavailable("EURUSD", "EURUSD"), bid: 1.1, ask: 1.1001, source_type: "WEBSOCKET" as const, market_status: "TRADEABLE" };
  assert.equal(evaluateQuote(base, now).fresh, false);
  assert.equal(evaluateQuote({ ...base, provider_timestamp: "2026-01-01T11:54:59Z", fresh: true }, now).fresh, false);
  assert.equal(evaluateQuote({ ...base, provider_timestamp: "2026-01-01T12:01:00Z" }, now).fresh, false);
  assert.equal(evaluateQuote({ ...base, provider_timestamp: "2026-01-01T12:00:00Z" }, now).fresh, true);
  const rest = normalizeQuote("EURUSD", "EURUSD", { snapshot: { bid: 1.1, offer: 1.1001, updateTimeUTC: "12:00:00" } }, undefined, new Date(now).toISOString(), now)!;
  assert.equal(rest.quote_time, null); assert.equal(evaluateQuote(rest, now).fresh, false);
});

for (const symbol of ["EURUSD", "NAS100", "EU50"] as AnalysisSymbol[]) test(`recorded Capital.com DEMO ${symbol}: both sides, exact pivot/EQ/FVG invariants and PNG`, async () => {
  const data: CandleResponse = JSON.parse(readFileSync(`tests/fixtures/capital-${symbol}-mn1.json`, "utf8"));
  assert.equal(data.symbol, symbol); assert.equal(data.candles.length, 60); assert.equal(data.candles.at(-1)!.is_closed, false);
  // Specific recorded market observations, not just round-trip assertions.
  const expected = { EURUSD: { price: 1.17115, time: "2026-08-01", swept: false }, NAS100: { price: 26980.6, time: "2026-07-01", swept: true }, EU50: { price: 6579.5, time: "2026-08-01", swept: false } }[symbol];
  const lastFractal = analyzeSeries(data, symbol).fractals.at(-1)!;
  assert.equal(lastFractal.price, expected.price); assert.equal(lastFractal.time.slice(0, 10), expected.time);
  assert.equal(lastFractal.liquidity_status === "swept", expected.swept);
  for (const side of ["bid", "ask"] as const) {
    const result = analyzeSeries(data, symbol, side);
    for (const f of result.fractals) {
      assert.ok(data.candles.slice(f.index - 2, f.index + 3).every(c => c.is_closed));
      for (const j of [-2, -1, 1, 2]) assert.ok(f.kind === "high" ? f.price > data.candles[f.index + j].high[side]! : f.price < data.candles[f.index + j].low[side]!);
    }
    const r = result.ranges.selected;
    if (r.status === "confirmed") assert.equal(r.equilibrium, (r.high!.price + r.low!.price) / 2);
    for (const g of result.fvgs) { assert.ok(g.fill_percent >= 0 && g.fill_percent <= 100); assert.ok(g.remaining_size <= g.original_size); }
    const svg = chartSvg(data, result, symbol, side);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, "png"); assert.equal(meta.width, 1400); assert.equal(meta.height, 1000);
  }
});
