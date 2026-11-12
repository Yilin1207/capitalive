// Verifies the public domain after deployment; stores real, unedited response bodies.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.argv[2] ?? "https://capitalive.vercel.app");
const symbols = ["BRENT", "NAS100", "JP225", "EURUSD", "GER40", "EU50", "UK100"];
const report = { checked_at: new Date().toISOString(), base_url: base.origin, mocked: false, checks: [], archive: null };
await mkdir("verification", { recursive: true });
async function get(path, expected = 200) {
  const url = new URL(path, base);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const body = await response.json();
  assert.equal(response.status, expected, `${url}: ${response.status} ${JSON.stringify(body.error)}`);
  assert.equal(body.ok, expected === 200);
  report.checks.push({ path, http_status: response.status, request_id: response.headers.get("x-vercel-id") });
  return body;
}
const save = async (name, body) => writeFile(`verification/${name}.json`, JSON.stringify(body, null, 2) + "\n");
try {
  for (const timeframe of ["UNKNOWN", "MONTH", "M1", "H1", ""]) {
    const body = await get(`/api/candles?symbol=BRENT&timeframe=${timeframe}`, 400);
    assert.equal(body.error.code, "INVALID_TIMEFRAME");
    assert.equal(body.timeframe, undefined);
    assert.equal(body.candles, undefined);
    if (timeframe === "UNKNOWN") await save("production-invalid-timeframe", body);
  }
  console.log("PASS unsupported/empty timeframes: HTTP 400 INVALID_TIMEFRAME");
  for (const symbol of symbols) {
    const body = await get(`/api/candles?symbol=${symbol}&timeframe=MN1&limit=60`);
    assert.equal(body.timeframe, "MN1");
    assert.equal(body.symbol, symbol);
    assert.equal(body.metadata.requested, 60);
    assert.equal(body.candles.length, 60, `${symbol}: provider history shorter than 60 months`);
    assert.equal(body.metadata.aggregation.source, "Capital.com DAY");
    const fetched = Date.parse(body.fetched_at);
    let previous = "";
    for (const bar of body.candles) {
      assert.ok(bar.time > previous); previous = bar.time;
      const start = new Date(bar.time);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
      assert.equal(start.getUTCDate(), 1);
      assert.equal(bar.start_time, bar.time);
      assert.equal(bar.end_time, end);
      assert.equal(bar.is_closed, Date.parse(end) <= fetched);
      for (const side of ["bid", "ask"]) {
        const values = [bar.open[side], bar.high[side], bar.low[side], bar.close[side]];
        if (values.every(value => value === null)) { assert.equal(bar.history_completeness, "partial_validation"); continue; }
        assert.ok(values.every(Number.isFinite));
        assert.ok(bar.high[side] >= Math.max(bar.open[side], bar.close[side]));
        assert.ok(bar.low[side] <= Math.min(bar.open[side], bar.close[side]));
      }
    }
    report.checks.at(-1).result = { symbol, environment: body.environment, returned: body.candles.length,
      first: body.candles[0].time, last: body.candles.at(-1).time, latest_is_closed: body.candles.at(-1).is_closed,
      rejected_daily_rows: body.metadata.discarded_rows };
    if (symbol === "BRENT") await save("production-mn1", body);
    console.log(`PASS ${symbol}: 60 MN1; latest closed=${body.candles.at(-1).is_closed}`);
  }
  const structure = await get("/api/structure?symbol=BRENT&mn1=60&w1=52&d1=180&h4=120");
  for (const [tf, count] of Object.entries({ MN1: 60, W1: 52, D1: 180, H4: 120 })) {
    assert.equal(structure[tf].length, count); assert.equal(structure.metadata[tf].requested, count);
  }
  report.checks.at(-1).result = { MN1: 60, W1: 52, D1: 180, H4: 120 };
  console.log("PASS structure: MN1=60 W1=52 D1=180 H4=120");
  const historical = await get("/api/quote-at?symbol=BRENT&at=2026-11-05T21:21:30Z");
  assert.equal(historical.requested_at, "2026-11-05T21:21:30.000Z");
  assert.ok(["exact_tick", "interval_estimate", "no_data"].includes(historical.status));
  if (historical.status === "interval_estimate") {
    assert.equal(historical.exact, false); assert.equal(historical.quote, null);
    assert.equal(historical.interval.start, "2026-11-05T21:21:00.000Z");
    assert.equal(historical.interval.end, "2026-11-05T21:22:00.000Z");
    assert.equal(historical.interval.is_exact_tick, false);
  } else if (historical.status === "exact_tick") {
    assert.equal(historical.exact, true);
    assert.equal(historical.quote.provider_timestamp, historical.requested_at);
  } else { assert.equal(historical.exact, false); assert.equal(historical.quote, null); }
  await save("production-quote-at", historical);
  report.checks.at(-1).result = { status: historical.status, exact: historical.exact };
  console.log(`PASS historical BRENT: ${historical.status}, exact=${historical.exact}`);
  const quotes = await get("/api/quotes");
  assert.deepEqual(quotes.quotes, quotes.markets);
  assert.equal(Object.keys(quotes.markets).length, 13);
  for (const symbol of symbols) {
    const q = quotes.markets[symbol];
    assert.ok(Number.isFinite(q.bid) && Number.isFinite(q.ask) && q.bid <= q.ask);
    assert.equal(q.age_seconds, q.provider_timestamp === null ? null : (Date.parse(q.fetched_at_utc) - Date.parse(q.provider_timestamp)) / 1000);
  }
  report.archive = { status: quotes.diagnostics.archive_status, exact_lookup_verified: false, worker: quotes.diagnostics.websocket.worker };
  if (report.archive.status === "ready") {
    let tick = quotes.markets.BRENT;
    // A confirmed subscription can legitimately receive no BRENT tick in a short
    // collection window. Retry boundedly; never invent a timestamp for a REST quote.
    for (let attempt = 0; !tick.provider_timestamp && attempt < 4; attempt++) {
      console.log("BRENT tick not received in this collection window; retrying archive proof");
      tick = (await get("/api/quotes")).markets.BRENT;
    }
    assert.ok(tick.provider_timestamp, "No timestamped BRENT tick received; exact archive proof unavailable");
    const recovered = await get(`/api/quote-at?symbol=BRENT&at=${encodeURIComponent(tick.provider_timestamp)}`);
    assert.equal(recovered.status, "exact_tick");
    assert.equal(recovered.quote.bid, tick.bid); assert.equal(recovered.quote.ask, tick.ask);
    report.archive.exact_lookup_verified = true;
    await save("production-archived-tick", recovered);
    console.log("PASS persistent archive: received BRENT tick recovered by provider timestamp");
  } else console.log(`ARCHIVE ${report.archive.status}: continuous collection/storage not certified`);
  report.api_checks_passed = true;
  report.all_requested_capabilities_verified = report.archive.status === "ready"
    && report.archive.exact_lookup_verified && report.archive.worker?.heartbeat_fresh === true;
} catch (error) {
  report.api_checks_passed = false; report.all_requested_capabilities_verified = false;
  report.failure = error.message; process.exitCode = 1;
  console.error(error.message);
} finally { await save("production-release", report); }
