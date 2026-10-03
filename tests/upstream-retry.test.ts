import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithTimeoutRetry,
  isAuthenticationFailure,
  type RetryMetrics,
  UpstreamFetchError,
} from "../lib/upstream-retry.ts";
import { markQuotesStale } from "../lib/quote-state-utils.ts";
import { actionableLive } from "../lib/market-semantics.ts";
import {
  CONTEXT_MARKETS,
  DERIVED,
  UNAVAILABLE_CONTEXT_MARKETS,
} from "../lib/market-context.ts";

const noSleep = async () => undefined;

test("returns a normal response without retry", async () => {
  const metrics: RetryMetrics = { retryCount: 0 };
  const response = await fetchWithTimeoutRetry("https://capital.test", {}, {
    timeoutMs: 50,
    metrics,
    sleepImpl: noSleep,
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(response.status, 200);
  assert.equal(metrics.retryCount, 0);
});

test("retries 429 and 500 responses", async () => {
  const statuses = [429, 500, 200];
  const metrics: RetryMetrics = { retryCount: 0 };
  const response = await fetchWithTimeoutRetry("https://capital.test", {}, {
    timeoutMs: 50,
    metrics,
    sleepImpl: noSleep,
    fetchImpl: async () => new Response("{}", { status: statuses.shift() ?? 500 }),
  });
  assert.equal(response.status, 200);
  assert.equal(metrics.retryCount, 2);
});

test("does not retry a permanent 400 response", async () => {
  let attempts = 0;
  const response = await fetchWithTimeoutRetry("https://capital.test", {}, {
    timeoutMs: 50,
    sleepImpl: noSleep,
    fetchImpl: async () => {
      attempts += 1;
      return new Response("{}", { status: 400 });
    },
  });
  assert.equal(response.status, 400);
  assert.equal(attempts, 1);
});

test("aborts timeout and stops after configured attempts", async () => {
  const metrics: RetryMetrics = { retryCount: 0 };
  await assert.rejects(
    fetchWithTimeoutRetry("https://capital.test", {}, {
      timeoutMs: 5,
      maxAttempts: 2,
      metrics,
      sleepImpl: noSleep,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    }),
    (error: unknown) => error instanceof UpstreamFetchError && error.code === "TIMEOUT",
  );
  assert.equal(metrics.retryCount, 1);
});

test("recognizes an expired session response", () => {
  assert.equal(isAuthenticationFailure(401, ""), true);
  assert.equal(isAuthenticationFailure(400, "error.security.client-token-invalid"), true);
  assert.equal(isAuthenticationFailure(400, "validation.invalid-epic"), false);
});

test("a last-good snapshot stays stale when one symbol is unavailable", () => {
  const quotes = markQuotesStale({
    NAS100: { bid: 100, ask: 101, fresh: true },
    EU50: { bid: null, ask: null, fresh: false, error: "Quote unavailable" },
  });
  assert.equal(quotes.NAS100.fresh, false);
  assert.equal(quotes.NAS100.stale, true);
  assert.equal(quotes.NAS100.actionable_live, false);
  assert.equal(quotes.NAS100.live_retrieval, false);
  assert.equal(quotes.EU50.fresh, false);
  assert.equal(quotes.EU50.stale, true);
  assert.equal((quotes.EU50 as { error?: string }).error, "Quote unavailable");
});

test("actionable live requires both an open market and provider freshness", () => {
  assert.equal(actionableLive("TRADEABLE", true), true);
  assert.equal(actionableLive("CLOSED", true), false);
  assert.equal(actionableLive("TRADEABLE", false), false);
  assert.equal(actionableLive(null, true), false);
});

test("context does not expose unavailable futures or fake yield spreads", () => {
  assert.deepEqual(Object.keys(CONTEXT_MARKETS), ["VIX"]);
  assert.equal(CONTEXT_MARKETS.VIX.representation, "volatility_index");
  assert.equal(DERIVED.yield_spreads.available, false);
});

test("unconfirmed requested tenors stay explicitly unavailable", () => {
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.US2Y);
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.DE2Y);
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.DE10Y);
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.UK2Y);
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.UK10Y);
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.JP2Y);
  assert.ok(UNAVAILABLE_CONTEXT_MARKETS.JP10Y);
});
