import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCandles, type Timeframe } from "../lib/candle-data.ts";
import { historyDiagnostics, periodStart } from "../lib/history-diagnostics.ts";

const fetched = Date.parse("2026-10-21T06:35:00Z");
function row(time: string, crossed = false) {
  return { snapshotTimeUTC: time, openPrice: { bid: 100, ask: 102 }, highPrice: { bid: 110, ask: 112 },
    lowPrice: { bid: 90, ask: 92 }, closePrice: { bid: 105, ask: crossed ? 104 : 107 },
    account: "must-not-leak", CST: "must-not-leak" };
}
function diagnose(prices: unknown[], timeframe: Exclude<Timeframe, "MN1"> = "H4", evaluated = fetched, limit = 200) {
  const quality = normalizeCandles({ prices }, timeframe, fetched);
  return historyDiagnostics(quality, quality.candles.slice(-limit), timeframe, fetched, evaluated, 30);
}

test("NAS100 regression: crossed current 04:00 bar is diagnosed even when older bars fill the requested count", () => {
  const d = diagnose([row("2026-10-20T20:00:00"), row("2026-10-21T00:00:00"), row("2026-10-21T04:00:00", true)], "H4", fetched, 2);
  assert.equal(d.current_period.status, "filtered_by_validation");
  assert.equal(d.latest_provider_bar_time, "2026-10-21T04:00:00.000Z");
  assert.equal(d.latest_returned_bar_time, "2026-10-21T00:00:00.000Z");
  assert.deepEqual(d.missing_filtered_times, ["2026-10-21T04:00:00.000Z"]);
  assert.deepEqual(d.current_period.rejected[0].crossed_fields, [{ field: "close", bid: 105, ask: 104 }]);
  assert.equal(d.provider_gap_slots, 0);
  assert.doesNotMatch(JSON.stringify(d), /CST|account|must-not-leak/);
});

test("missing upstream current bar is distinct from filtering, without claiming a market-hours outage", () => {
  const d = diagnose([row("2026-10-21T00:00:00")]);
  assert.equal(d.current_period.status, "not_in_provider_response");
  assert.equal(d.missing_filtered_count, 0);
  assert.equal(d.provider_gap_slots, 1);
  assert.equal(d.gap_interpretation, "nominal_intervals_only_market_hours_not_checked");
});

test("recent retrieval does not claim recent price updates; cache boundary is not a provider omission", () => {
  const d = diagnose([row("2026-10-21T04:00:00")], "H4", fetched + 15_000);
  assert.equal(d.current_period.status, "present");
  assert.equal(d.retrieval_age_seconds, 15);
  assert.equal(d.retrieval_status, "recent");
  assert.equal(d.price_update_freshness, "unknown_bar_start_is_not_last_tick");
  const boundary = diagnose([row("2026-10-21T04:00:00")], "H4", Date.parse("2026-10-21T08:00:01Z"));
  assert.equal(boundary.current_period.status, "not_yet_fetched");
  assert.equal(boundary.retrieval_status, "expired");
});

test("current W1, D1, H4 UTC periods have correct starts and forming bars", () => {
  for (const [timeframe, time] of [["W1", "2026-10-19T00:00:00"], ["D1", "2026-10-21T00:00:00"], ["H4", "2026-10-21T04:00:00"]] as const) {
    const d = diagnose([row(time)], timeframe);
    assert.equal(d.current_period.status, "present");
    assert.equal(d.current_period.time, time + ".000Z");
    assert.deepEqual(d.forming_bars, [time + ".000Z"]);
  }
  assert.equal(new Date(periodStart(Date.parse("2027-01-03T23:59:00Z"), "W1")).toISOString(), "2026-12-28T00:00:00.000Z");
});

test("weekend intervals are grouped and not filled with synthetic candles", () => {
  const prices = [row("2026-10-16T20:00:00"), row("2026-10-19T00:00:00"), row("2026-10-21T04:00:00")];
  const d = diagnose(prices);
  assert.equal(d.provider_gaps[0].count, 12);
  assert.equal(d.provider_gaps[0].reason, "not_in_provider_response");
  assert.equal(normalizeCandles({ prices }, "H4", fetched).candles.length, 3);
});

test("rejected duplicate does not falsely mark an accepted timestamp as missing", () => {
  const d = diagnose([row("2026-10-21T04:00:00", true), row("2026-10-21T04:00:00")]);
  assert.equal(d.current_period.status, "present");
  assert.equal(d.missing_filtered_count, 0);
  assert.equal(d.rejected_rows.length, 1);
});

test("diagnostics stay bounded and focus on the requested window", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(new Date(fetched - (1000 - i) * 4 * 3600_000).toISOString(), true));
  const d = diagnose(rows);
  assert.equal(d.rejected_rows.length, 20);
  assert.equal(d.rejected_rows_omitted, 980);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) < 10_000);
  const narrow = diagnose([row("2026-10-20T00:00:00", true), row("2026-10-21T00:00:00"), row("2026-10-21T04:00:00")], "H4", fetched, 1);
  assert.equal(narrow.rejected_rows.length, 0);
  assert.equal(narrow.provider_gap_slots, 0);
});
