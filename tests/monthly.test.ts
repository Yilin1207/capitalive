import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCandles } from "../lib/candle-data";
import { aggregateMonths, monthStart } from "../lib/monthly-candles";
import { historyDiagnostics } from "../lib/history-diagnostics";
import { GET as candles } from "../app/api/candles/route";
import { GET as structure } from "../app/api/structure/route";

const now = Date.parse("2026-11-06T12:00:00Z");
function row(time: string, shift = 0) {
  return { snapshotTimeUTC: time, openPrice: { bid: 100 + shift, ask: 102 + shift },
    highPrice: { bid: 110 + shift, ask: 112 + shift }, lowPrice: { bid: 90 + shift, ask: 92 + shift }, closePrice: { bid: 105 + shift, ask: 107 + shift } };
}
test("MN1 calendar aggregation preserves each side, year rollover, gaps and forming month", () => {
  const quality = normalizeCandles({ prices: [row("2025-12-31T00:00:00", 8), row("2025-12-01T00:00:00", 1),
    row("2026-01-02T00:00:00", 10), row("2026-01-30T00:00:00", 5), row("2026-11-05T00:00:00", 30)] }, "D1", now);
  const months = aggregateMonths(quality.candles, now);
  assert.equal(months.length, 3); // Do not fabricate February–October or missing daily sessions.
  assert.equal(months[0].time, "2025-12-01T00:00:00.000Z");
  assert.equal(months[0].end_time, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(months[0].open, { bid: 101, ask: 103 });
  assert.deepEqual(months[0].high, { bid: 118, ask: 120 });
  assert.deepEqual(months[0].low, { bid: 91, ask: 93 });
  assert.deepEqual(months[0].close, { bid: 113, ask: 115 });
  assert.equal(months[0].daily_bars, 2);
  assert.equal(months[0].history_completeness, "unknown_sessions_not_verified");
  assert.equal(months[0].is_closed, true);
  assert.equal(months[2].is_closed, false);
  assert.equal(monthStart(Date.parse("2024-02-29T12:00:00Z"), 1), Date.parse("2024-03-01T00:00:00Z"));
  assert.equal(aggregateMonths(quality.candles, Date.parse("2026-01-01T00:00:00Z"))[0].is_closed, true);
  const diagnostics = historyDiagnostics({ ...quality, provider_times: months.map(c => c.time) }, months, "MN1", now, now, 30);
  assert.equal(diagnostics.provider_gap_slots, 9);
  assert.equal(diagnostics.current_period.status, "present");
});
test("MN1 never hides a missing price side or rejected daily observation", () => {
  const bad = row("2026-01-05T00:00:00"); bad.highPrice.ask = 1;
  const daily = normalizeCandles({ prices: [row("2026-01-02T00:00:00"), bad] }, "D1", now);
  const month = aggregateMonths(daily.candles, now, ["2026-01-06T00:00:00Z"])[0];
  assert.equal(month.open.ask, null);
  assert.equal(month.close.ask, null);
  assert.equal(month.open.bid, 100);
  assert.equal(month.history_completeness, "partial_validation");
});
test("MN1 routes load 60 real calendar months for all seven symbols through bounded DAY windows", async () => {
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch, originalNow = Date.now;
  process.env.CAPITAL_API_KEY = "mock"; process.env.CAPITAL_IDENTIFIER = "mock-monthly"; process.env.CAPITAL_API_PASSWORD = "mock";
  Date.now = () => now;
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/session")) return Response.json({}, { headers: { CST: "mock", "X-SECURITY-TOKEN": "mock" } });
    urls.push(url);
    const from = Date.parse(`${url.searchParams.get("from")}Z`), to = Date.parse(`${url.searchParams.get("to")}Z`);
    if (!Number.isFinite(from)) return Response.json({ prices: [row("2026-11-01T00:00:00")] });
    assert.equal(url.searchParams.get("resolution"), "DAY");
    assert.equal(url.searchParams.get("max"), "1000");
    assert.ok(to - from < 1000 * 86400_000);
    const prices = [];
    // Daily provider fixture: omit weekends; retain no fabricated sessions in the result.
    for (let time = Math.ceil(from / 86400_000) * 86400_000; time <= to; time += 86400_000) {
      const date = new Date(time);
      if (![0, 6].includes(date.getUTCDay())) prices.push(row(date.toISOString(), date.getUTCDate()));
    }
    return Response.json({ prices });
  };
  try {
    for (const symbol of ["BRENT", "NAS100", "JP225", "EURUSD", "GER40", "EU50", "UK100"]) {
      const response = await candles(new Request(`http://local/api/candles?symbol=${symbol}&timeframe=MN1&limit=60`));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.candles.length, 60);
      assert.equal(body.candles[0].time, "2021-12-01T00:00:00.000Z");
      assert.equal(body.candles.at(-1).is_closed, false);
      assert.equal(body.metadata.aggregation.pages, 3);
      assert.equal(body.metadata.aggregation.session_completeness, "unknown");
    }
    const response = await structure(new Request("http://local/api/structure?symbol=BRENT&mn1=60&w1=52&d1=180&h4=120"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.MN1.length, 60);
    assert.equal(body.metadata.W1.requested, 52);
    assert.equal(body.metadata.D1.requested, 180);
    assert.equal(body.metadata.H4.requested, 120);
    const before = urls.length;
    assert.equal((await candles(new Request("http://local/api/candles?timeframe=MN1&limit=61"))).status, 400);
    assert.equal(urls.length, before);
  } finally { process.env = originalEnv; globalThis.fetch = originalFetch; Date.now = originalNow; }
});
