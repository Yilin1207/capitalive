// Run after deployment: npm run test:public -- https://capitalive.vercel.app
// Uses unauthenticated HTTP only. Never prints upstream credentials or account data.
import assert from "node:assert/strict";
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error("Provide the deployment URL");
let failed = 0;
async function check(path, verify) {
  try {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(60_000) });
    assert.equal(response.status, 200, `HTTP ${response.status}`);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const body = await response.json();
    assert.equal(body.ok, true);
    await verify(body, response);
    console.log(`PASS ${path}`);
  } catch (error) { failed++; console.error(`FAIL ${path}: ${error.message}`); }
}
function verifyCandles(candles) {
  assert.ok(Array.isArray(candles) && candles.length > 0);
  let previous = "";
  for (const c of candles) {
    assert.equal(new Date(c.time).toISOString(), c.time);
    assert.ok(c.time > previous); previous = c.time;
    assert.equal(typeof c.is_closed, "boolean");
    let available = 0;
    for (const side of ["bid", "ask"]) {
      const values = [c.open[side], c.high[side], c.low[side], c.close[side]];
      if (values.every(v => v === null)) continue;
      assert.ok(values.every(Number.isFinite));
      assert.ok(c.high[side] >= Math.max(c.open[side], c.close[side]));
      assert.ok(c.low[side] <= Math.min(c.open[side], c.close[side]));
      available++;
    }
    assert.ok(available > 0);
  }
}
for (const symbol of ["NAS100", "EURUSD", "XAUUSD", "EU50"]) {
  for (const timeframe of ["W1", "D1", "H4"]) {
    await check(`/api/candles?symbol=${symbol}&timeframe=${timeframe}&limit=3`, (body, response) => {
      assert.equal(body.symbol, symbol); assert.equal(body.timeframe, timeframe);
      assert.ok(["demo", "live"].includes(body.environment)); assert.equal(body.price_side, "bid_ask");
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
      assert.ok(body.candles.length <= 3); verifyCandles(body.candles);
      console.log(`  ${body.environment} ${body.epic}: ${body.candles.length} candles`);
    });
  }
}
await check("/api/structure?symbol=NAS100&w1=2&d1=3&h4=4", body => {
  for (const [timeframe, count] of [["W1", 2], ["D1", 3], ["H4", 4]]) {
    verifyCandles(body[timeframe]); assert.ok(body[timeframe].length <= count);
    assert.equal(body.metadata[timeframe].requested, count);
  }
});
await check("/api/quotes", body => {
  assert.equal(Object.keys(body.markets).length, 13);
  assert.deepEqual(body.quotes, body.markets);
});
process.exitCode = failed ? 1 : 0;
