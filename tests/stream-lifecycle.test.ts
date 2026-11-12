import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type WebSocket from "ws";
import { streamQuotes } from "../lib/capital-stream";

class FakeSocket extends EventEmitter {
  readyState = 1;
  terminated = false;
  sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  terminate() { this.terminated = true; this.emit("close", 1000); }
}
test("stream lifecycle uses documented URL without session metadata, confirms subscription, records ticks, closes and supports abort", async () => {
  const env = { ...process.env }, fetch = globalThis.fetch;
  process.env.CAPITAL_API_KEY = "mock"; process.env.CAPITAL_IDENTIFIER = "lifecycle"; process.env.CAPITAL_API_PASSWORD = "mock";
  globalThis.fetch = async () => Response.json({}, { headers: { CST: "mock", "X-SECURITY-TOKEN": "mock" } });
  try {
    let socket: FakeSocket;
    const ticks: unknown[] = [];
    const result = await streamQuotes(["OIL_BRENT", "US100"], { durationMs: 1000, stopAfterFirst: true,
      onTick: tick => ticks.push(tick), socketFactory: url => {
        assert.equal(url.href, "wss://api-streaming-capital.backend-capital.com/connect");
        socket = new FakeSocket();
        setImmediate(() => {
          socket.emit("open");
          socket.emit("message", Buffer.from(JSON.stringify({ destination: "marketData.subscribe", status: "OK", payload: { subscriptions: { OIL_BRENT: "PROCESSED", US100: "PROCESSED" } } })));
          for (const epic of ["OIL_BRENT", "US100"]) socket.emit("message", Buffer.from(JSON.stringify({ destination: "quote", status: "OK", payload: { epic, bid: 70, ofr: 71, timestamp: Date.now() } })));
        });
        return socket as unknown as WebSocket;
      },
    });
    assert.equal(result.diagnostics.reason, "collection_complete");
    assert.equal(result.diagnostics.instruments.OIL_BRENT.subscription, "confirmed");
    assert.equal(result.diagnostics.instruments.OIL_BRENT.fallback_reason, null);
    assert.equal(ticks.length, 2);
    assert.equal(socket!.terminated, true);
    assert.equal(socket!.sent[0].destination, "marketData.subscribe");
    const noTicks = await streamQuotes(["US100"], { durationMs: 10, socketFactory: () => {
      const socket = new FakeSocket();
      setImmediate(() => {
        socket.emit("open");
        socket.emit("message", Buffer.from(JSON.stringify({ destination: "marketData.subscribe", status: "OK", payload: { subscriptions: { US100: "PROCESSED" } } })));
      });
      return socket as unknown as WebSocket;
    } });
    assert.equal(noTicks.diagnostics.instruments.US100.fallback_reason, "no_tick_received");
    assert.deepEqual(noTicks.quotes, {});
    const controller = new AbortController(); controller.abort();
    const aborted = await streamQuotes(["US100"], { signal: controller.signal, socketFactory: () => new FakeSocket() as unknown as WebSocket });
    assert.equal(aborted.diagnostics.reason, "stopped");
  } finally { process.env = env; globalThis.fetch = fetch; }
});
