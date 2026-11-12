// Anonymous external HTTP verification. Never uses Vercel bypass or provider credentials.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const base = new URL(process.argv[2] ?? "https://capitalive.vercel.app");
const output = "verification/capitalive-v2-release";
await mkdir(output, { recursive: true });
const report = { checked_at: new Date().toISOString(), base_url: base.origin, anonymous_http: true, mocked: false, checks: [], success: false };
const save = (name, body) => writeFile(`${output}/${name}.json`, JSON.stringify(body, null, 2) + "\n");
async function get(path, expected = 200, format = "json", name) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin, "Verification follows only same-origin routes");
  const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const check = { url: url.href, status: response.status, content_type: response.headers.get("content-type"),
    bytes: bytes.length, request_id: response.headers.get("x-vercel-id"), sha256: createHash("sha256").update(bytes).digest("hex") };
  report.checks.push(check);
  assert.equal(response.status, expected, `${url}: HTTP ${response.status} ${bytes.toString().slice(0, 180)}`);
  if (format === "png") {
    assert.match(check.content_type, /^image\/png/);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const decoded = await sharp(bytes).metadata();
    assert.equal(decoded.width, 1400); assert.equal(decoded.height, 1000);
    const stats = await sharp(bytes).stats();
    assert.ok(stats.channels.some(c => c.stdev > 10), "Image is not a blank placeholder");
    check.width = decoded.width; check.height = decoded.height;
    if (name) await writeFile(`${output}/${name}.png`, bytes);
    return bytes;
  }
  assert.match(check.content_type, /^application\/json/);
  const body = JSON.parse(bytes.toString());
  if (expected === 200 && url.pathname !== "/api/markets") assert.equal(body.ok, true);
  if (name) await save(name, body);
  return body;
}
try {
  const audit = await get("/api/market-audit?symbol=EURUSD", 200, "json", "production-audit");
  assert.equal(audit.symbol, "EURUSD"); assert.equal(audit.schema_version, "2.0");
  assert.deepEqual(Object.keys(audit.structure), ["MN1", "W1", "D1", "H4"]);
  for (const tf of ["MN1", "W1", "D1", "H4"]) {
    assert.ok(audit.structure[tf].fractals.length > 0);
    assert.match(audit.structure[tf].rules.sweep, /^strict_cross/);
  }
  const png = await get("/api/chart?symbol=EURUSD&timeframe=H4", 200, "png", "production-EURUSD-H4");
  const full = await get("/api/market-audit?symbol=EURUSD&include_candles=1", 200, "json", "production-audit-with-candles");
  const lifecycle = { checked_fractals: 0, equality_events: 0, touched_only: 0, swept: 0, untouched: 0, forming_sweeps: 0 };
  for (const s of Object.values(full.structure)) {
    for (const f of s.fractals) {
      const index = s.candles.findIndex(c => c.time === f.time), window = s.candles.slice(index - 2, index + 3);
      assert.equal(window.length, 5); assert.ok(window.every(c => c.is_closed));
      const later = s.candles.slice(index + 3);
      const touch = later.find(c => c[f.kind][f.side] === f.price);
      const sweep = later.find(c => c[f.kind][f.side] !== null && (f.kind === "high" ? c.high[f.side] > f.price : c.low[f.side] < f.price));
      assert.equal(f.touched_at, touch?.time ?? null); assert.equal(f.swept_at, sweep?.time ?? null);
      assert.equal(f.liquidity_status, sweep ? "swept" : touch ? "touched" : "untouched");
      lifecycle.checked_fractals++;
      if (touch) lifecycle.equality_events++;
      if (sweep) { lifecycle.swept++; if (!sweep.is_closed) lifecycle.forming_sweeps++; }
      else if (touch) lifecycle.touched_only++;
      else lifecycle.untouched++;
    }
  }
  report.fractal_lifecycle = lifecycle;
  const pair = full.structure.H4.ranges.alternatives.find(r => r.high && r.low && r.status === "confirmed");
  assert.ok(pair, "Need a non-default confirmed pair for explicit-selection verification");
  const params = new URLSearchParams({ symbol: "EURUSD", timeframe: "H4", range_high: pair.high.id, range_low: pair.low.id });
  const selected = await get(`/api/market-audit?${params}`, 200, "json", "production-explicit-range");
  const r = selected.structure.H4.ranges.selected;
  assert.equal(selected.structure.H4.ranges.selection_mode, "explicit_fractals");
  assert.equal(r.high.id, pair.high.id); assert.equal(r.low.id, pair.low.id);
  assert.equal(r.equilibrium, (pair.high.price + pair.low.price) / 2);
  assert.notEqual(r.id, full.structure.H4.ranges.selected.id);
  const chartUrl = new URL(selected.charts.H4.url);
  assert.equal(chartUrl.searchParams.get("range_high"), pair.high.id);
  assert.equal(chartUrl.searchParams.get("range_low"), pair.low.id);
  const selectedPng = await get(chartUrl.href, 200, "png", "production-explicit-range");
  assert.ok(!selectedPng.equals(png));
  report.explicit_range = { high: { id: pair.high.id, price: pair.high.price }, low: { id: pair.low.id, price: pair.low.price },
    equilibrium: r.equilibrium, audit_url: new URL(`/api/market-audit?${params}`, base).href, chart_url: chartUrl.href };
  params.set("range_high", "H4:bid:high:1900-01-01T00:00:00.000Z");
  const invalid = await get(`/api/market-audit?${params}`, 400);
  assert.equal(invalid.error.code, "INVALID_RANGE_SELECTION");
  const quotes = await get("/api/quotes", 200, "json", "production-quotes");
  assert.deepEqual(quotes.markets, quotes.quotes); assert.equal(Object.keys(quotes.markets).length, 13);
  assert.ok(quotes.server_time && quotes.serverTime && quotes.fetchedAt);
  const markets = await get("/api/markets", 200, "json", "production-markets");
  assert.equal(Object.keys(markets).length, 13); assert.equal(markets.EURUSD.epic, "EURUSD");
  const structure = await get("/api/structure?symbol=EURUSD&mn1=60&w1=20&d1=30&h4=40", 200, "json", "production-legacy-structure");
  for (const tf of ["MN1", "W1", "D1", "H4"]) assert.ok(Array.isArray(structure[tf]) && structure[tf].length > 0);
  await get("/api/candles?symbol=EURUSD&timeframe=H4&limit=20", 200, "json", "production-legacy-candles");
  const historical = await get("/api/quote-at?symbol=BRENT&at=2026-11-05T21:21:30Z", 200, "json", "production-legacy-quote-at");
  assert.ok(["exact_tick", "interval_estimate", "no_data"].includes(historical.status));
  // GET cannot ingest an EDGE observation; preserve the write route's method boundary.
  const edge = await fetch(new URL("/api/edge", base), { redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.equal(edge.status, 405);
  report.checks.push({ url: new URL("/api/edge", base).href, status: edge.status, method: "GET", meaning: "POST-only route retained; no data written" });
  report.environment = audit.environment;
  report.quote_fresh = audit.quote.fresh;
  report.warnings = audit.warnings;
  report.success = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await save("public-http-verification", report);
  console.log(JSON.stringify(report, null, 2));
}
