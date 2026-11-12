import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { GET as chart, OPTIONS as chartOptions } from "../app/api/chart/route";
import { GET as audit, OPTIONS as auditOptions } from "../app/api/market-audit/route";
import { marketAudit } from "../lib/market-audit";
import { unavailable } from "../lib/quote-normalization";
import { HistoryError } from "../lib/candles";
import type { CandleResponse } from "../lib/candle-data";
import { analyzeSeries } from "../lib/technical-analysis";

test("analysis routes reject unsupported instruments, sides, layers and budgets before any upstream request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("must not fetch"); };
  try {
    for (const query of ["symbol=XAUUSD", "symbol=__proto__", "side=mid", "min_remaining_units=-1", "atr_fraction=2", "atr_fraction=NaN", "symbol="]) {
      assert.equal((await audit(new Request(`http://localhost/api/market-audit?${query}`))).status, 400);
      assert.equal((await chart(new Request(`http://localhost/api/chart?${query}`))).status, 400);
    }
    for (const query of ["timeframe=", "timeframe=M1", "include_candles=true"]) assert.equal((await audit(new Request(`http://localhost/api/market-audit?${query}`))).status, 400);
    for (const query of ["timeframe=M1", "timeframe=", "bars=999999", "bars=1.5", "fvg=true", "fractals="]) assert.equal((await chart(new Request(`http://localhost/api/chart?${query}`))).status, 400);
    assert.equal(chartOptions().status, 204); assert.equal(auditOptions().headers.get("access-control-allow-origin"), "*");
  } finally { globalThis.fetch = original; }
});

test("audit assembles all four frames, flags unverified tick, retains provenance, bounded symbol scope and PNG URLs", async () => {
  const data: CandleResponse = JSON.parse(readFileSync("tests/fixtures/capital-EURUSD-mn1.json", "utf8"));
  const requested: string[] = [];
  const response = await marketAudit(new Request("https://capitalive.example/api/market-audit?symbol=EURUSD&side=ask&min_remaining_units=0.8"), {
    getCandles: async (symbol, tf) => { requested.push(tf); return { ...data, timeframe: tf, symbol }; },
    getAnalysisQuote: async () => ({ ...unavailable("EURUSD", "EURUSD"), bid: 1.1, ask: 1.1001, cache_hit: false, evaluated_at: data.fetched_at }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(requested, ["MN1", "W1", "D1", "H4"]);
  const body = await response.json();
  assert.equal(body.price_side, "ask"); assert.equal(body.targets.reference_price, 1.1001);
  assert.equal(body.structure.H4.candles, undefined);
  assert.ok(body.structure.H4.candles_url.endsWith("timeframe=H4"));
  assert.equal(body.quote.fresh, false); assert.equal(body.targets.reference_fresh, false);
  assert.ok(body.warnings.some((w: { code: string }) => w.code === "NO_VERIFIED_FRESH_TICK_REDUCED_RELIABILITY"));
  assert.equal(body.structure.H4.materiality.min_remaining_units, 0.8);
  assert.equal(body.charts.MN1.content_type, "image/png");
  assert.match(body.charts.MN1.url, /^https:\/\/capitalive\.example\/api\/chart\?/);
  assert.equal(new URL(body.charts.MN1.url).searchParams.get("side"), "ask");
  assert.equal(body.targets.probability, null); assert.deepEqual(body.targets.hypotheses, []);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("audit can return one timeframe plus all-frame targets, with raw candles explicitly requested", async () => {
  const data: CandleResponse = JSON.parse(readFileSync("tests/fixtures/capital-EURUSD-mn1.json", "utf8"));
  const response = await marketAudit(new Request("https://local/api/market-audit?symbol=EURUSD&timeframe=H4&include_candles=1"), {
    getCandles: async (_symbol, timeframe) => ({ ...data, timeframe }),
    getAnalysisQuote: async () => ({ ...unavailable("EURUSD", "EURUSD"), cache_hit: false, evaluated_at: data.fetched_at }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.structure), ["H4"]);
  assert.equal(body.structure.H4.candles.length, 60);
  assert.deepEqual(body.response_scope.targets_timeframes, ["MN1", "W1", "D1", "H4"]);
  assert.equal(body.targets.above.nearest, null);
});

test("audit explicit H4 IDs propagate to JSON and PNG URL; missing, provisional and wrong-side IDs are rejected", async () => {
  const data: CandleResponse = JSON.parse(readFileSync("tests/fixtures/capital-NAS100-h4.json", "utf8"));
  const auto = analyzeSeries(data, "NAS100"), pair = auto.ranges.alternatives[0];
  const params = new URLSearchParams({ symbol: "NAS100", timeframe: "H4", range_high: pair.high!.id, range_low: pair.low!.id });
  const dependencies = {
    getCandles: async (_symbol: string, timeframe: CandleResponse["timeframe"]) => ({ ...data, timeframe }),
    getAnalysisQuote: async () => ({ ...unavailable("NAS100", "US100"), cache_hit: false, evaluated_at: data.fetched_at }),
  };
  const response = await marketAudit(new Request(`https://local/api/market-audit?${params}`), dependencies);
  assert.equal(response.status, 200);
  const body = await response.json(), selected = body.structure.H4.ranges.selected;
  assert.equal(body.structure.H4.ranges.selection_mode, "explicit_fractals");
  assert.equal(selected.high.id, pair.high!.id); assert.equal(selected.low.id, pair.low!.id);
  assert.equal(selected.equilibrium, (pair.high!.price + pair.low!.price) / 2);
  assert.equal(new URL(body.charts.H4.url).searchParams.get("range_high"), pair.high!.id);
  for (const high of ["H4:bid:high:1900-01-01T00:00:00.000Z", "H4:ask:high:2026-01-01T00:00:00.000Z", ""]) {
    params.set("range_high", high);
    const rejected = await marketAudit(new Request(`https://local/api/market-audit?${params}`), dependencies);
    assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, "INVALID_RANGE_SELECTION");
  }
  params.delete("range_high");
  assert.equal((await audit(new Request(`https://local/api/market-audit?${params}`))).status, 400);
  assert.equal((await chart(new Request(`https://local/api/chart?${params}`))).status, 400);
});

test("audit never returns a complete-looking partial structure; 429 and sanitized failures retain contract", async () => {
  const data: CandleResponse = JSON.parse(readFileSync("tests/fixtures/capital-EURUSD-mn1.json", "utf8"));
  for (const failure of [new HistoryError("CAPITAL_RATE_LIMIT", "Rate limit", 429, 61), new Error("private-password-and-session")]) {
    const response = await marketAudit(new Request("https://capitalive.example/api/market-audit?symbol=EURUSD"), {
      getCandles: async (_symbol, tf) => { if (tf === "D1") throw failure; return { ...data, timeframe: tf }; },
      getAnalysisQuote: async () => { throw new Error("Quote must not load after history failure"); },
    });
    assert.equal(response.status, failure instanceof HistoryError ? 429 : 502);
    if (failure instanceof HistoryError) assert.equal(response.headers.get("retry-after"), "61");
    const raw = await response.text(); assert.doesNotMatch(raw, /private-password|session/);
    assert.equal(JSON.parse(raw).structure, undefined);
  }
});

test("real PNG route uses Capital transport, reuses cached history, handles side/layer toggles and emits only image bytes", async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  process.env.CAPITAL_API_KEY = "test-chart-key"; process.env.CAPITAL_IDENTIFIER = "chart-route"; process.env.CAPITAL_API_PASSWORD = "test-chart-password";
  process.env.CAPITAL_API_BASE_URL = "https://demo-api-capital.backend-capital.com";
  let historyCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/session")) return Response.json({}, { headers: { CST: "private-chart-cst", "X-SECURITY-TOKEN": "private-chart-token" } });
    assert.ok(url.pathname.includes("/prices/")); historyCalls++;
    return Response.json({ prices: Array.from({ length: 30 }, (_, i) => {
      const base = 1.1 + Math.sin(i) * 0.002;
      return { snapshotTimeUTC: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), openPrice: { bid: base, ask: base + 0.0001 },
        highPrice: { bid: base + 0.001, ask: base + 0.0011 }, lowPrice: { bid: base - 0.001, ask: base - 0.0009 }, closePrice: { bid: base + 0.0005, ask: base + 0.0006 } };
    }) });
  };
  try {
    const images: Buffer[] = [];
    for (const extra of ["", "&fractals=0&fvg=0&ranges=0&eq=0", "&side=ask"]) {
      const response = await chart(new Request(`https://local/api/chart?symbol=EURUSD&timeframe=D1${extra}`));
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      const bytes = Buffer.from(await response.arrayBuffer()); images.push(bytes);
      assert.equal(bytes.subarray(1, 4).toString(), "PNG"); assert.equal((await sharp(bytes).metadata()).width, 1400);
      assert.doesNotMatch(bytes.toString(), /test-chart-key|private-chart-cst|test-chart-password/);
    }
    assert.equal(historyCalls, 1); assert.ok(!images[0].equals(images[1])); assert.ok(!images[0].equals(images[2]));
  } finally { process.env = env; globalThis.fetch = original; }
});
