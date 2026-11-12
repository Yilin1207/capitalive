import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const read = async name => JSON.parse(await readFile(`data/${name}`, "utf8"));
const symbols = ["BRENT", "NAS100", "JP225", "EURUSD", "GER40", "EU50", "UK100"];
const quotes = await read("staged-quotes.json");
assert.equal(quotes.ok, true);
const report = {
  verified_at: new Date().toISOString(), environment: quotes.environment, mocked: false,
  deployment: "https://capitalive-m0rxa63jb-yilin1207s-projects.vercel.app",
  production_domain_promoted: false,
  quotes: {}, months: {}, closed_month_daily_comparisons: [],
  archive_status: quotes.diagnostics.archive_status,
  continuous_worker_verified: false,
};
for (const symbol of symbols) {
  const q = quotes.markets[symbol];
  const d = quotes.diagnostics.websocket.request.instruments[q.epic];
  assert.equal(q.source_type, "WEBSOCKET");
  assert.equal(d.subscription, "confirmed");
  assert.ok(d.last_tick);
  assert.ok(q.bid <= q.ask);
  assert.equal(q.age_seconds, (Date.parse(q.fetched_at_utc) - Date.parse(q.provider_timestamp)) / 1000);
  report.quotes[symbol] = { bid: q.bid, ask: q.ask, provider_timestamp: q.provider_timestamp,
    received_at_utc: q.received_at_utc, fetched_at_utc: q.fetched_at_utc, age_seconds: q.age_seconds,
    source_type: q.source_type, market_status: q.market_status, subscription: d.subscription };
  const m = await read(`staged-${symbol.toLowerCase() === "brent" ? "brent" : symbol}-mn1.json`);
  assert.equal(m.ok, true);
  assert.equal(m.candles.length, 60);
  assert.equal(m.candles[0].time, "2021-12-01T00:00:00.000Z");
  assert.equal(m.candles.at(-1).time, "2026-11-01T00:00:00.000Z");
  assert.equal(m.candles.at(-1).is_closed, false);
  assert.ok(m.candles.slice(0, -1).every(bar => bar.is_closed));
  report.months[symbol] = { returned: m.candles.length, first: m.candles[0].time, last: m.candles.at(-1).time,
    current_is_closed: m.candles.at(-1).is_closed, provider_daily_rows: m.metadata.diagnostics.provider_rows,
    rejected_daily_rows: m.metadata.discarded_rows, rejected_sides: m.metadata.discarded_sides,
    partial_months: m.candles.filter(bar => bar.history_completeness === "partial_validation").map(bar => bar.time),
    session_completeness: m.metadata.aggregation.session_completeness };
  if (["BRENT", "NAS100"].includes(symbol)) {
    const daily = await read(`staged-${symbol}-d1.json`);
    assert.equal(daily.ok, true);
    for (const month of ["2025-12", "2026-01", "2026-10"]) {
      const bars = daily.candles.filter(bar => bar.time.startsWith(month));
      assert.ok(bars.length > 15);
      const monthly = m.candles.find(bar => bar.time.startsWith(month));
      for (const side of ["bid", "ask"]) {
        const expected = bars.some(bar => ["open", "high", "low", "close"].some(field => bar[field][side] === null))
          ? { open: null, high: null, low: null, close: null }
          : { open: bars[0].open[side], high: Math.max(...bars.map(bar => bar.high[side])),
            low: Math.min(...bars.map(bar => bar.low[side])), close: bars.at(-1).close[side] };
        for (const field of ["open", "high", "low", "close"]) assert.equal(monthly[field][side], expected[field], `${symbol} ${month} ${side} ${field}`);
      }
      report.closed_month_daily_comparisons.push({ symbol, month, daily_bars: bars.length, both_sides_match: true });
    }
  }
}
const historical = await read("staged-quote-at.json");
assert.equal(historical.requested_at, "2026-11-05T21:21:30.000Z");
assert.equal(historical.status, "interval_estimate");
assert.equal(historical.exact, false);
assert.equal(historical.quote, null);
report.quote_at = historical;
const structure = await read("staged-structure.json");
assert.equal(structure.ok, true);
report.structure_counts = Object.fromEntries(["MN1", "W1", "D1", "H4"].map(tf => [tf, structure[tf].length]));
assert.deepEqual(report.structure_counts, { MN1: 60, W1: 52, D1: 180, H4: 120 });
await mkdir("verification", { recursive: true });
await writeFile("verification/capital-demo-2026-11-06.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: true, websocket_symbols: symbols.length, months_each: 60,
  daily_comparisons: report.closed_month_daily_comparisons.length, historical_status: historical.status,
  archive_status: report.archive_status }, null, 2));
