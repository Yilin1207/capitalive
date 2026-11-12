import { HISTORY, type CandleResponse, type PriceSide, type Timeframe } from "./candle-data";
import { monthStart } from "./monthly-candles";

/** Test containment only on overlapping CLOSED bars; never compare different forming snapshots as equal. */
export function checkConsistency(series: Partial<Record<Timeframe, CandleResponse>>, side: PriceSide) {
  const mismatches: { parent: Timeframe; child: Timeframe; parent_time: string; child_time: string; reason: string }[] = [];
  let checked = 0;
  for (const [parentTf, childTf] of [["MN1", "D1"], ["W1", "D1"], ["D1", "H4"]] as const) {
    for (const p of series[parentTf]?.candles ?? []) {
      if (!p.is_closed || p.high[side] === null || p.low[side] === null) continue;
      const start = Date.parse(p.time), end = parentTf === "MN1" ? monthStart(start, 1) : start + HISTORY[parentTf].seconds * 1000;
      for (const c of series[childTf]?.candles ?? []) {
        const childStart = Date.parse(c.time), childEnd = childStart + HISTORY[childTf].seconds * 1000;
        if (!c.is_closed || childStart < start || childEnd > end || c.high[side] === null || c.low[side] === null) continue;
        checked++;
        const epsilon = Math.max(Math.abs(p.high[side]!), 1) * 1e-10;
        if (c.high[side]! > p.high[side]! + epsilon || c.low[side]! < p.low[side]! - epsilon)
          mismatches.push({ parent: parentTf, child: childTf, parent_time: p.time, child_time: c.time, reason: "child_extrema_outside_parent" });
      }
    }
  }
  return { status: mismatches.length ? "mismatch" : checked ? "no_contradiction_in_checked_bars" : "not_checkable",
    checked_child_bars: checked, mismatches: mismatches.slice(0, 50), mismatch_count: mismatches.length,
    scope: "closed_contained_bars_only; does_not_certify_session_coverage_or_equal_aggregation", forming_bars_compared: false };
}
