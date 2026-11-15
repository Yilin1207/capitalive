import test from "node:test";
import assert from "node:assert/strict";
import { closedFrame, type Frame } from "../lib/knowledge/data";
import * as pa from "../lib/knowledge/detectors";
import { data, candle } from "./htf-test-helpers";
import { provenance } from "../lib/knowledge/rules";
// Schematic OHLC transcriptions of textual definitions; not historical trades or profitability data.
const frame = (rows: number[][]): Frame => ({
  timeframe: "H4",
  side: "bid",
  status: "PARTIAL",
  warnings: [],
  symbol: "EURUSD",
  as_of: "2026-01-10T00:00:00.000Z",
  bars: rows.map(([open, high, low, close], index) => ({
    open,
    high,
    low,
    close,
    index,
    segment: 0,
    time: new Date(Date.UTC(2026, 0, 1, index * 4)).toISOString(),
    end: new Date(Date.UTC(2026, 0, 1, (index + 1) * 4)).toISOString(),
  })),
});
const peak = () =>
  frame([
    [7, 10, 6, 8],
    [8, 12, 7, 10],
    [10, 11, 6, 8],
  ]);
function level(
  f: Frame,
  price = 10,
  role: "support" | "resistance" = "support",
): pa.KeyLevel {
  const p = pa.detectFractals(peak())[0];
  return {
    id: "explicit-kl",
    kind: "FRACTAL",
    timeframe: "W1",
    side: "bid",
    lower: price,
    upper: price,
    role,
    confirmed_at: "2025-12-01T00:00:00.000Z",
    source_finding: p,
    qualified: true,
  };
}
test("author three-bar and project five-bar pivots are distinct; ties and missing right bar reject", () => {
  const f = peak();
  assert.equal(
    pa.detectFractals(f, 3).filter((p) => p.polarity === "high").length,
    1,
  );
  assert.equal(pa.detectFractals(f, 5).length, 0);
  assert.equal(pa.detectFractals({ ...f, bars: f.bars.slice(0, 2) }).length, 0);
  f.bars[2].high = 12;
  assert.equal(pa.detectFractals(f).length, 0);
  const five = frame([
    [6, 9, 4, 7],
    [7, 10, 5, 8],
    [8, 12, 6, 10],
    [9, 11, 5, 8],
    [8, 10, 4, 7],
  ]);
  assert.equal(pa.detectFractals(five, 5)[0].variant, 5);
});
test("FVG golden geometry requires three closed contiguous bars and body coverage; touching wicks are not gaps", () => {
  const f = frame([
      [8, 10, 7, 9],
      [9, 14, 9, 13],
      [12, 15, 12, 14],
    ]),
    a = pa.detectFvg(f);
  assert.equal(a.findings.length, 1);
  assert.deepEqual([a.levels[0].lower, a.levels[0].upper], [10, 12]);
  const bad = structuredClone(f);
  bad.bars[2].low = 10;
  assert.equal(pa.detectFvg(bad).findings.length, 0);
  bad.bars[2].low = 12;
  bad.bars[1].close = 11;
  assert.equal(pa.detectFvg(bad).findings.length, 0);
  bad.bars[1].close = 13;
  bad.bars[2].segment = 1;
  assert.equal(pa.detectFvg(bad).findings.length, 0);
});
test("iFVG closed breach is a candidate, not an invented confirmed opposite role", () => {
  const f = frame([
      [8, 10, 7, 9],
      [9, 14, 9, 13],
      [12, 15, 12, 14],
      [11, 12, 8, 9],
    ]),
    g = pa.detectFvg(f);
  const inv = pa.detectInversions(f, g.levels);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].facts.opposite_role_confirmed, false);
  assert.equal(inv[0].state, "CANDIDATE");
  f.bars[3].close = 10;
  assert.equal(pa.detectInversions(f, g.levels).length, 0);
  f.bars[3].close = 9;
  f.bars[3].segment = 1;
  assert.equal(
    pa.detectInversions(f, g.levels).length,
    0,
    "Unknown interval cannot establish inversion",
  );
});
test("raid preserves equal touch separately; close beyond level does not require reclaim", () => {
  const f = frame([
      [7, 10, 6, 8],
      [8, 12, 7, 10],
      [10, 11, 6, 8],
      [9, 12, 7, 10],
      [11, 14, 9, 13],
    ]),
    p = pa
      .detectFractals(f)
      .filter((p) => p.index === 1 && p.polarity === "high");
  const e = pa.detectRaids(f, p);
  assert.deepEqual(
    e.map((x) => x.kind),
    ["TOUCH", "RAID"],
  );
  assert.equal(e[1].facts.close_back, false);
  assert.equal(e[1].candle_evidence[0].index, 4);
});
test("RB textual golden: two opposite candles with rejection at already-known KL; lone rejection and future KL reject", () => {
  const f = frame([
      [12, 13, 9, 11],
      [11, 14, 10, 13],
    ]),
    kl = level(f),
    r = pa.detectRejectionBlocks(f, [kl]);
  assert.equal(r.length, 1);
  assert.equal(r[0].facts.author_bounds_verified, false);
  assert.equal(
    pa.detectRejectionBlocks({ ...f, bars: f.bars.slice(0, 1) }, [kl]).length,
    0,
  );
  assert.equal(pa.detectRejectionBlocks(f, []).length, 0);
  assert.equal(
    pa.detectRejectionBlocks(f, [{ ...kl, confirmed_at: f.bars[1].end }])
      .length,
    0,
  );
  f.bars[0].low = 10;
  assert.equal(
    pa.detectRejectionBlocks(f, [kl]).length,
    0,
    "Equal touch is not a fractal raid",
  );
});
test("SNR origin, KL delivery and closed breakout are independent of FVG", () => {
  const f = frame([
      [10, 13, 9, 12],
      [12, 13, 10, 11],
      [10, 11, 7, 9],
      [10, 15, 9, 14],
    ]),
    kl = level(f, 8),
    r = pa.detectSnr(f, [kl]);
  assert.ok(r.length > 0);
  assert.equal(r[0].facts.fvg_required, false);
  assert.equal(r[0].facts.proposed_role, "support");
  assert.equal(pa.detectFvg(f).findings.length, 0);
  assert.equal(pa.detectSnr(f, []).length, 0);
  f.bars[3].close = 12;
  assert.equal(pa.detectSnr(f, [kl]).length, 0);
  f.bars[3].close = 12.5;
  assert.ok(
    pa.detectSnr(f, [kl]).length > 0,
    "Author diagram crosses junction 12; origin wick 13 is not the boundary",
  );
});
test("IDM inside only: correct X/X-1, not arbitrary near or future POI", () => {
  const f = peak(),
    p = pa.detectFractals(f),
    kl = { ...level(f), timeframe: "D1" as const, lower: 11, upper: 13 };
  assert.equal(pa.detectIdm(f, p, [kl]).length, 1);
  assert.equal(pa.detectIdm(f, p, [{ ...kl, lower: 12.1 }]).length, 0);
  assert.equal(pa.detectIdm(f, p, [{ ...kl, timeframe: "MN1" }]).length, 0);
  assert.equal(
    pa.detectIdm(f, p, [{ ...kl, confirmed_at: "2027-01-01T00:00:00.000Z" }])
      .length,
    0,
  );
});
test("strong pivot needs both raid and contextual two-candle VC, ordinary fractal is not strong", () => {
  const f = frame([
      [9, 11, 8, 10],
      [12, 13, 9, 11],
      [11, 12, 8, 10],
    ]),
    p = pa.detectFractals(f),
    pivot = p.find((p) => p.polarity === "high")!;
  const old = {
    ...pivot,
    id: "older-pivot",
    price: 12,
    index: -3,
    confirmed_at: "2025-12-30T00:00:00.000Z",
  };
  const raids = pa.detectRaids(f, [old]);
  const proof: pa.Finding = {
    ...pivot,
    ...provenance("EDGE.RB.v1"),
    kind: "RB_TWO_CANDLE",
    candle_evidence: pivot.candle_evidence,
    state: "CANDIDATE",
      facts: {direction:'bearish'},
  };
  assert.equal(pa.detectStrong(f, [pivot], raids, [proof]).length, 1);
  assert.equal(pa.detectStrong(f, [pivot], raids.map(r=>({...r,facts:{...r.facts,polarity:'low'}})), [proof]).length,0);
  assert.equal(pa.detectStrong(f, [pivot], raids, [{...proof,facts:{direction:'bullish'}}]).length,0);
  assert.equal(pa.detectStrong(f, [pivot], raids, []).length, 0);
});
test("BOS/CHOCH uses only pivots confirmed before break; repeated crossing consumed once", () => {
  const f = frame([
      [7, 10, 6, 8],
      [8, 12, 7, 10],
      [10, 11, 6, 8],
      [11, 14, 9, 13],
      [12, 15, 10, 14],
    ]),
    p = pa.detectFractals(f);
  const result = pa.detectStructure(f, p);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, "BOS");
  assert.equal(result.bias, "Bullish");
  assert.equal(
    pa.detectStructure({ ...f, bars: f.bars.slice(0, 3) }, p).findings.length,
    0,
  );
});
test("opposite closed break changes project BOS to CHOCH without inventing a narrative reversal", () => {
  const f = frame([
    [8, 10, 7, 9],
    [9, 12, 8, 10],
    [10, 11, 6, 9],
    [9, 14, 7, 13],
    [13, 14, 5, 5.5],
  ]);
  const result = pa.detectStructure(f, pa.detectFractals(f));
  assert.deepEqual(
    result.findings.map((e) => e.kind),
    ["BOS", "CHOCH"],
  );
  assert.equal(result.findings[1].facts.previous_bias, "Bullish");
  assert.equal(result.bias, "Bearish");
});
test("DR requires explicit IDs, EQ is midpoint, IRL remains internal geometry", () => {
  const f = frame([
      [7, 10, 6, 8],
      [8, 12, 7, 10],
      [10, 11, 5, 8],
      [8, 10, 4, 9],
      [9, 11, 6, 10],
    ]),
    p = pa.detectFractals(f),
    hi = p.find((p) => p.polarity === "high")!,
    lo = p.find((p) => p.polarity === "low")!;
  assert.equal(pa.selectRange(f, p).range, null);
  assert.equal(pa.selectRange(f,[hi,{...lo,index:hi.index}],{high_id:hi.id,low_id:lo.id}).range,null,'A high and low on the same candle do not define a two-pivot DR');
  const r = pa.selectRange(f, p, { high_id: hi.id, low_id: lo.id });
  assert.equal(r.range?.equilibrium, 8);
  assert.equal(r.findings[1].rule_id, "EDGE.PREMIUM_DISCOUNT.v1");
  const internal = { ...hi, id: "internal", price: 9 };
  assert.equal(pa.detectIrl(f, [internal], r.range).length, 1);
  assert.equal(
    pa.detectIrl(f, [{ ...internal, price: 12 }], r.range).length,
    0,
  );
});
test("Compression/LRL and Displacement expose measurements, never invented thresholds or reversal signals", () => {
  const f = peak();
  assert.equal(
    pa.measureCompression(f, pa.detectFractals(f), [level(f)])[0].state,
    "NEEDS_SPECIFICATION",
  );
  assert.equal(pa.measureCompression(f, [], [])[0].facts.reversal, false);
  assert.equal(pa.measureDisplacement(f)[0].state, "NEEDS_SPECIFICATION");
  assert.equal(pa.measureDisplacement(f)[0].facts.body, 2);
});
test("Session Gap requires verified calendar and exact boundaries for spot/CFD/futures; wrong timezone rejects", () => {
  const f = frame([
    [8, 10, 7, 9],
    [11, 13, 10, 12],
  ]);
  assert.equal(pa.detectSessionGaps(f).findings.length, 0);
  for (const instrument_type of ["spot", "cfd", "futures"] as const) {
    const calendar = {
      verified: true,
      timezone: "America/New_York",
      instrument_type,
      boundaries: [
        {
          previous_close_time: f.bars[0].end,
          next_open_time: f.bars[1].time,
          previous_session_id: "previous",
          next_session_id: "next",
        },
      ],
    };
    assert.equal(pa.detectSessionGaps(f, calendar).findings.length, 1);
    assert.equal(
      pa.detectSessionGaps(f, { ...calendar, timezone: "invalid" }).findings
        .length,
      0,
    );
  }
});
test("Weekly and Monthly Open are provider-specific closed-period facts", () => {
  const f = peak();
  for (const tf of ["W1", "MN1"] as const) {
    const e = pa.detectOpeningLevels({ ...f, timeframe: tf });
    assert.equal(e.length, 3);
    assert.equal(e[0].facts.closed_period_only, true);
    assert.equal(e[0].facts.price, 7);
  }
  assert.equal(pa.detectOpeningLevels(f).length, 0);
});
test("data gate rejects incomplete/crossed OHLC, forming/future closure and preserves gap barriers", () => {
  const d = data([
    candle(0, 12, 8, 10),
    candle(1, 13, 9, 12),
    candle(2, 12, 8, 10, false),
  ]);
  let f = closedFrame(d, "bid");
  assert.equal(f.bars.length, 2);
  const broken = structuredClone(d);
  broken.candles[1].high.bid = null;
  f = closedFrame(broken, "bid");
  assert.equal(f.bars.length, 1);
  const crossed = structuredClone(d);
  crossed.candles[0].open.ask = 1;
  assert.equal(closedFrame(crossed, "bid").bars.length, 1);
  const asof = d.candles[1].time;
  assert.equal(closedFrame(d, "bid", asof).bars.length, 1);
  const gaps = data([
    candle(0, 12, 8, 10),
    candle(2, 13, 9, 12),
    candle(3, 12, 8, 10),
  ]);
  assert.equal(pa.detectFractals(closedFrame(gaps, "bid")).length, 0);
});
test("prefix invariance: appending future bars cannot alter prior confirmed fractals/FVG/break events", () => {
  const f = frame([
      [7, 10, 6, 8],
      [8, 12, 7, 10],
      [10, 11, 6, 8],
      [11, 14, 9, 13],
      [12, 15, 10, 14],
    ]),
    prefix = { ...f, bars: f.bars.slice(0, 3) };
  assert.deepEqual(
    pa
      .detectFractals(f)
      .filter((p) => p.confirmed_at <= prefix.bars.at(-1)!.end),
    pa.detectFractals(prefix),
  );
  assert.deepEqual(
    pa
      .detectFvg(f)
      .findings.filter((p) => p.confirmed_at <= prefix.bars.at(-1)!.end),
    pa.detectFvg(prefix).findings,
  );
});
