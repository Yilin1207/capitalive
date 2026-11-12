import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveConfigured, closeArchive, ensureArchive, findQuote, saveQuote } from "../lib/archive";
import { captureEdge } from "../lib/edge-archive";
import { quoteAt } from "../lib/quote-at";
import { GET as atRoute } from "../app/api/quote-at/route";
import { POST as edgeRoute } from "../app/api/edge/route";
import { providerTime, type ArchivedQuote } from "../lib/tick-data";

test("durable archive, exact/as-of separation, minute estimate and immutable EDGE", async () => {
  const env = { ...process.env }, fetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), "capital-archive-"));
  const path = join(dir, "ticks.sqlite");
  delete process.env.DATABASE_URL; delete process.env.VERCEL;
  process.env.ARCHIVE_SQLITE_PATH = path;
  process.env.CAPITAL_API_KEY = "mock"; process.env.CAPITAL_IDENTIFIER = "archive-test"; process.env.CAPITAL_API_PASSWORD = "mock";
  process.env.CAPITAL_API_BASE_URL = "https://demo-api-capital.backend-capital.com";
  process.env.EDGE_INGEST_TOKEN = "test-private-token";
  const at = "2026-11-05T21:21:30.000Z", atMs = Date.parse(at);
  const base: ArchivedQuote = { symbol: "BRENT", epic: "OIL_BRENT", bid: 70, ask: 70.1, provider_timestamp: at,
    received_at_utc: at, fetched_at_utc: at, source_type: "WEBSOCKET", environment: "demo", market_status: "TRADEABLE", age_seconds: 0 };
  const input = { id: "edge-1", source: "ChatGPT", symbol: "BRENT" as const, original_time: at, direction: "LONG", edge: 0.72 };
  let minuteAvailable = true, calls = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/session")) return Response.json({}, { headers: { CST: "mock", "X-SECURITY-TOKEN": "mock" } });
    calls++;
    assert.equal(url.searchParams.get("resolution"), "MINUTE");
    assert.equal(url.searchParams.get("from"), "2026-11-05T21:21:00");
    return Response.json({ prices: minuteAvailable ? [{ snapshotTimeUTC: "2026-11-05T21:21:00", openPrice: { bid: 70, ask: 70.1 }, highPrice: { bid: 71, ask: 71.1 }, lowPrice: { bid: 69, ask: 69.1 }, closePrice: { bid: 70.5, ask: 70.6 } }] : [] });
  };
  try {
    await ensureArchive();
    const absent = await captureEdge(input, "demo", atMs + 5000);
    assert.equal(absent.event.data_quality, "no_data");
    await saveQuote({ ...base, provider_timestamp: null, age_seconds: 0 });
    assert.equal(await findQuote("BRENT", "demo", atMs, "before"), null);
    const estimate = await quoteAt("BRENT", at);
    assert.equal(estimate.status, "interval_estimate");
    assert.equal(estimate.exact, false);
    assert.equal(estimate.quote, null);
    assert.ok("interval" in estimate && estimate.interval?.includes_prices_after_requested_at);
    minuteAvailable = false;
    assert.equal((await quoteAt("BRENT", at)).status, "no_data");
    await saveQuote({ ...base, provider_timestamp: "2026-11-05T21:21:29.000Z", received_at_utc: "2026-11-05T21:21:29.100Z" });
    await saveQuote({ ...base, provider_timestamp: "2026-11-05T21:21:31.000Z", received_at_utc: "2026-11-05T21:21:31.100Z" });
    const earlier = await captureEdge({ ...input, id: "edge-2" }, "demo", atMs + 10_000);
    assert.equal(earlier.event.temporal_deviation_seconds, -1);
    assert.equal(earlier.event.data_quality, "last_known_before_signal");
    assert.equal(earlier.event.exact_at_signal, false);
    await saveQuote(base);
    await saveQuote(base); // Idempotent write.
    await closeArchive();
    assert.equal((await findQuote("BRENT", "demo", atMs, "exact"))?.bid, 70); // Reopen persisted database.
    assert.equal(await findQuote("BRENT", "live", atMs, "exact"), null);
    const before = calls;
    assert.equal((await quoteAt("BRENT", at)).status, "exact_tick");
    assert.equal(calls, before);
    const duplicate = await captureEdge(input, "demo", atMs + 20_000);
    assert.deepEqual(duplicate.event, absent.event); // Do not rewrite a past missing snapshot with later data.
    assert.equal((await captureEdge({ ...input, edge: 9 }, "demo")).conflict, true);
    const late = { ...base, symbol: "NAS100", epic: "US100", received_at_utc: "2026-11-05T21:21:35.000Z" };
    await saveQuote(late);
    const delayed = await captureEdge({ ...input, symbol: "NAS100", id: "late" }, "demo", atMs + 6000);
    assert.equal(delayed.event.data_quality, "received_after_signal");
    assert.equal(delayed.event.exact_at_signal, false);
    assert.equal(delayed.event.received_after_signal_seconds, 5);
    assert.equal((await atRoute(new Request(`http://local/api/quote-at?symbol=BRENT&at=${at}`))).status, 200);
    assert.equal((await atRoute(new Request("http://local/api/quote-at?at=2026-02-30T00:00:00Z"))).status, 400);
    const post = (body: unknown, token = "test-private-token") => edgeRoute(new Request("http://local/api/edge", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    assert.equal((await post(input, "wrong")).status, 401);
    assert.equal((await post(input)).status, 200);
    assert.equal((await post({ ...input, edge: 123 })).status, 409);
    assert.equal((await post({ ...input, original_time: "21:21:30" })).status, 400);
    assert.equal((await post({ ...input, direction: "x".repeat(9000) })).status, 413);
    await closeArchive();
    process.env.VERCEL = "1";
    assert.equal(archiveConfigured(), false);
    await assert.rejects(ensureArchive(), /ARCHIVE_NOT_CONFIGURED/);
    assert.equal(providerTime("21:21:30"), null);
  } finally {
    await closeArchive(); process.env = env; globalThis.fetch = fetch;
    for (const suffix of ["", "-wal", "-shm"]) await unlink(path + suffix).catch(() => undefined);
    await rmdir(dir);
  }
});
