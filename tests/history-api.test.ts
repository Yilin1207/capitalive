import assert from "node:assert/strict";
import test from "node:test";
import { GET as candles, OPTIONS } from "../app/api/candles/route.ts";
import { GET as structure } from "../app/api/structure/route.ts";
import { GET as quotes } from "../app/api/quotes/route.ts";
import { PUBLIC_SYMBOLS, VERIFIED_MARKETS, createCapitalRequestContext, getHistoricalPrices } from "../lib/capital.ts";
import { HISTORY } from "../lib/candle-data.ts";
const TIMEFRAMES = ["W1", "D1", "H4"] as const;

function row() { return {
  snapshotTimeUTC: "2026-01-05T00:00:00",
  openPrice: { bid: 100, ask: 102 }, highPrice: { bid: 110, ask: 113 },
  lowPrice: { bid: 90, ask: 91 }, closePrice: { bid: 105, ask: 108 },
}; }
const request = (query: string) => new Request(`http://localhost/api/candles?${query}`);

test("real route handlers and shared Capital transport (mock upstream only)", async t => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalEnv = { ...process.env };
  process.env.CAPITAL_API_KEY = "test-key-do-not-expose";
  process.env.CAPITAL_API_PASSWORD = "test-password-do-not-expose";
  process.env.CAPITAL_IDENTIFIER = "test-identifier-do-not-expose";
  process.env.CAPITAL_API_BASE_URL = "https://demo-api-capital.backend-capital.com";
  let sessions = 0, historyCalls = 0;
  let mode: "ok" | "expired" | "rate" | "empty" | "invalid" | "auth" = "ok";
  let rateDelay: string | null = null;
  const historyUrls: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/session") {
      sessions++;
      return Response.json({ streamingHost: "wss://127.0.0.1:1", accounts: [{ secret: "account-must-not-leak" }] }, { headers: { CST: `private-cst-${sessions}`, "X-SECURITY-TOKEN": "private-security" } });
    }
    assert.ok(new Headers(init?.headers).get("CST"));
    if (url.pathname.startsWith("/api/v1/prices/")) {
      historyCalls++; historyUrls.push(url);
      if (mode === "expired") { mode = "ok"; return Response.json({ errorCode: "error.security.client-token-invalid" }, { status: 401 }); }
      if (mode === "auth") return Response.json({ errorCode: "error.security.client-token-invalid" }, { status: 401 });
      if (mode === "rate") return Response.json({ errorCode: "error.too-many-requests" }, { status: 429, headers: rateDelay ? { "Retry-After": rateDelay } : {} });
      if (mode === "empty") return Response.json({ prices: [] });
      if (mode === "invalid") return Response.json({ prices: "bad" });
      return Response.json({ prices: [row()], accounts: [{ secret: "account-must-not-leak" }] });
    }
    if (url.pathname === "/api/v1/markets") return Response.json({ markets: [...PUBLIC_SYMBOLS.map(symbol => ({ epic: VERIFIED_MARKETS[symbol].epic, updateTimeUTC: new Date().toISOString(), delayTime: 0 }))] });
    if (url.pathname.startsWith("/api/v1/markets/")) return Response.json({ instrument: { epic: url.pathname.split("/").at(-1), name: "Mock market" }, snapshot: { bid: 100, offer: 101, marketStatus: "TRADEABLE" } });
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  };
  try {
    await t.test("NAS100, EURUSD, XAUUSD, EU50 × W1/D1/H4; mapping, both sides, defaults and public CORS", async () => {
      for (const symbol of ["NAS100", "EURUSD", "XAUUSD", "EU50"] as const) for (const timeframe of TIMEFRAMES) {
        const response = await candles(request(`symbol=${symbol}&timeframe=${timeframe}`));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
        const body = await response.json();
        assert.equal(body.epic, VERIFIED_MARKETS[symbol].epic);
        assert.equal(body.environment, "demo");
        assert.equal(body.price_side, "bid_ask");
        assert.equal(body.metadata.requested, HISTORY[timeframe].limit);
        assert.equal(body.metadata.insufficient_history, true);
        assert.equal(body.candles[0].time, "2026-01-05T00:00:00.000Z");
        assert.deepEqual(body.candles[0].close, { bid: 105, ask: 108 });
        const url = historyUrls.at(-1)!;
        assert.equal(url.searchParams.get("resolution"), HISTORY[timeframe].resolution);
        assert.equal(url.searchParams.get("max"), String(HISTORY[timeframe].limit + 10));
        assert.equal(url.pathname, `/api/v1/prices/${body.epic}`);
        assert.doesNotMatch(JSON.stringify(body), /private-|test-key|test-password|test-identifier|account-must-not-leak|CST|SECURITY-TOKEN/);
      }
      assert.equal(sessions, 1);
      assert.equal(OPTIONS().status, 204);
    });
    await t.test("structure reuses candle cache and honors each count", async () => {
      const before = historyCalls;
      const response = await structure(request("symbol=NAS100&w1=1&d1=2&h4=3"));
      const body = await response.json();
      assert.equal(response.status, 200);
      for (const [i, timeframe] of TIMEFRAMES.entries()) {
        assert.ok(Array.isArray(body[timeframe]));
        assert.equal(body.metadata[timeframe].requested, i + 1);
        assert.ok(body.metadata[timeframe].fetched_at);
      }
      assert.equal(historyCalls, before);
    });
    await t.test("bad requests never contact upstream", async () => {
      const before = historyCalls;
      for (const query of ["symbol=INVALID", "symbol=__proto__", "timeframe=M1", "limit=1001", "limit=0", "limit=2.2"]) assert.equal((await candles(request(query))).status, 400);
      assert.equal((await structure(request("w1=-2"))).status, 400);
      assert.equal(historyCalls, before);
    });
    await t.test("unsupported and empty timeframes return explicit errors, never H4", async () => {
      const before = historyCalls;
      for (const timeframe of ["", "UNKNOWN", "MONTH", "M1", "H1", "MN2"]) {
        const response = await candles(request(`timeframe=${timeframe}`));
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.equal(body.error.code, "INVALID_TIMEFRAME");
        assert.equal(body.timeframe, undefined);
        assert.equal(body.candles, undefined);
      }
      assert.equal(historyCalls, before);
    });
    await t.test("LIVE uses separate cache and max=1000", async () => {
      process.env.CAPITAL_API_BASE_URL = "https://api-capital.backend-capital.com";
      const response = await candles(request("symbol=NAS100&timeframe=H4&limit=1000"));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).environment, "live");
      assert.equal(historyUrls.at(-1)!.searchParams.get("max"), "1000");
      assert.equal(sessions, 2);
    });
    await t.test("expired session is refreshed once and original prices request retried", async () => {
      const before = sessions;
      mode = "expired";
      const context = createCapitalRequestContext();
      await getHistoricalPrices("US100", "DAY", 2, context);
      assert.equal(sessions, before + 1);
      assert.equal(context.sessionRefreshHappened, true);
      assert.equal(context.retryCount, 1);
    });
    await t.test("idle session is renewed before sending the historical request", async () => {
      const before = sessions;
      // Keep the clock monotonic for the shared GET scheduler until this scenario ends.
      Date.now = () => originalNow() + 10 * 60_000;
      await getHistoricalPrices("US100", "DAY", 2);
      assert.equal(sessions, before + 1);
    });
    await t.test("repeated auth failure stops after one refresh", async () => {
      const before = sessions;
      mode = "auth";
      await assert.rejects(getHistoricalPrices("US100", "DAY", 2), { code: "CAPITAL_AUTH" });
      assert.equal(sessions, before + 1);
      mode = "ok";
    });
    await t.test("empty/invalid data fails explicitly and errors never enter cache", async () => {
      mode = "empty";
      assert.equal((await candles(request("symbol=JP225"))).status, 404);
      mode = "invalid";
      assert.equal((await candles(request("symbol=JP225"))).status, 502);
      mode = "ok";
      assert.equal((await candles(request("symbol=JP225"))).status, 200);
    });
    await t.test("quotes retains its full existing contract and all 13 symbols", async () => {
      const response = await quotes();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.deepEqual(Object.keys(body.markets), [...PUBLIC_SYMBOLS]);
      assert.deepEqual(body.quotes, body.markets);
      assert.ok(body.server_time && body.serverTime && body.fetchedAt && body.metadata && body.context_markets);
      assert.equal(body.markets.NAS100.bid, 100);
      assert.equal(body.markets.NAS100.ask, 101);
      assert.equal(body.markets.NAS100.provider_timestamp, null);
      assert.equal(body.markets.NAS100.age_seconds, null);
      assert.ok(body.markets.NAS100.received_at_utc);
      assert.ok(body.markets.NAS100.fetched_at_utc);
      assert.equal(body.markets.NAS100.source_type, "REST");
      assert.ok(body.markets.NAS100.rest_fallback_reason);
    });
    await t.test("429 retries are bounded, returned publicly with Retry-After and cooldown", async () => {
      mode = "rate";
      const before = historyCalls;
      const response = await candles(request("symbol=GER40"));
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "60");
      assert.equal(historyCalls, before + 3);
      const cooled = await candles(request("symbol=UK100"));
      assert.equal(cooled.status, 429);
      assert.equal(historyCalls, before + 3);
      mode = "ok";
    });
    await t.test("provider Retry-After is retained by the shared transport", async () => {
      mode = "rate";
      rateDelay = "120";
      const before = historyCalls;
      await assert.rejects(getHistoricalPrices("US100", "DAY", 2), { code: "CAPITAL_RATE_LIMIT", retryAfter: 120 });
      assert.equal(historyCalls, before + 1);
      mode = "ok";
    });
    await t.test("public load limit returns JSON 429 with CORS without touching upstream", async () => {
      const before = historyCalls;
      let last: Response | null = null;
      for (let i = 0; i < 65; i++) last = await candles(request("symbol=INVALID"));
      assert.equal(last!.status, 429);
      assert.ok(Number(last!.headers.get("Retry-After")) > 0);
      assert.equal(last!.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal((await last!.json()).error.code, "RATE_LIMIT");
      assert.equal(historyCalls, before);
    });
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; process.env = originalEnv; }
});
