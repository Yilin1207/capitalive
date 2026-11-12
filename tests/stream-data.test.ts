import assert from "node:assert/strict";
import test from "node:test";
import { acceptStreamMessage, providerTime, streamDiagnostics, tickAge } from "../lib/tick-data";

test("WebSocket acknowledgements are per epic and never manufacture a tick", () => {
  const d = streamDiagnostics(["US100", "OIL_BRENT", "J225"]);
  acceptStreamMessage(JSON.stringify({ destination: "marketData.subscribe", status: "OK", payload: { subscriptions: { US100: "PROCESSED", OIL_BRENT: "REJECTED" } } }), d);
  assert.equal(d.instruments.US100.subscription, "confirmed");
  assert.equal(d.instruments.OIL_BRENT.subscription, "rejected");
  assert.equal(d.instruments.J225.subscription, "pending");
  assert.equal(d.instruments.US100.last_tick, null);
});
test("WebSocket ticks validate prices and milliseconds, retain receipt time, handle reordering", () => {
  const now = Date.parse("2026-11-06T12:00:00Z"), d = streamDiagnostics(["OIL_BRENT"]);
  const msg = (bid: number, ask: number, timestamp: number, epic = "OIL_BRENT") => JSON.stringify({ destination: "quote", status: "OK", payload: { epic, bid, ofr: ask, timestamp } });
  const tick = acceptStreamMessage(msg(70, 70.1, now - 120), d, now)!;
  assert.equal(tick.ask, 70.1);
  assert.equal(tick.received_at_utc, "2026-11-06T12:00:00.000Z");
  assert.equal(tickAge(new Date(tick.timestamp).toISOString(), now), 0.12);
  assert.equal(acceptStreamMessage(msg(71, 70, now), d, now), null);
  assert.equal(acceptStreamMessage(msg(70, 71, now / 1000), d, now), null);
  assert.equal(acceptStreamMessage(msg(70, 71, now + 120_000), d, now), null);
  assert.equal(acceptStreamMessage(msg(70, 71, now, "__proto__"), d, now), null);
  assert.ok(acceptStreamMessage(msg(70, 71, now - 1000), d, now));
  assert.equal(d.instruments.OIL_BRENT.last_tick?.timestamp, now - 120);
  assert.equal(d.invalid_ticks, 3);
});
test("REST timestamp never derives from HTTP retrieval time or a time-of-day", () => {
  for (const value of [undefined, null, "21:21:30", "2026-02-30T00:00:00Z"]) {
    assert.equal(providerTime(value), null);
    assert.equal(tickAge(providerTime(value), Date.now()), null);
  }
  assert.equal(providerTime("2026-11-05T21:21:30.123"), "2026-11-05T21:21:30.123Z");
});
