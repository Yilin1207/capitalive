import { NextResponse } from "next/server";
import {
  CapitalApiError,
  capitalEnvironment,
  createCapitalRequestContext,
  ensureCapitalSession,
  getMarketSnapshot,
} from "@/lib/capital";
import { getStreamingQuotes } from "@/lib/capital-stream";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";
import {
  capitalHealthStatus,
  hasUsableSnapshot,
} from "@/lib/market-semantics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeHealthError(error: unknown) {
  return {
    code: error instanceof CapitalApiError ? error.code : "CAPITAL_UNAVAILABLE",
    message: "Capital.com market data self-check failed",
  };
}

export async function GET() {
  const context = createCapitalRequestContext();
  const checkedAt = new Date().toISOString();
  let environment: "demo" | "live" | null = null;
  let sessionReady = false;

  try {
    environment = capitalEnvironment();
    await ensureCapitalSession(context);
    sessionReady = true;

    const [restResult, websocketResult] = await Promise.allSettled([
      getMarketSnapshot("US100", context),
      getStreamingQuotes(["US100"], 1200, context),
    ]);
    const restReady =
      restResult.status === "fulfilled" && hasUsableSnapshot(restResult.value);
    const websocketQuote =
      websocketResult.status === "fulfilled" ? websocketResult.value.US100 : undefined;
    const websocketReady = Boolean(websocketQuote);
    const capitalStatus = capitalHealthStatus(restReady, websocketReady);

    if (capitalStatus === "degraded") {
      throw new Error("No usable Capital.com quote received");
    }

    const completedAt = new Date().toISOString();
    return NextResponse.json(
      {
        ok: true,
        service: "capitalive",
        serviceStatus: "ready",
        capitalStatus,
        capitalSession: "ready",
        quoteProvider: "Capital.com",
        environment,
        checkedAt,
        diagnosticScope: "active_self_check",
        lastSuccessfulQuoteAt: completedAt,
        lastSuccessfulWebSocketAt: websocketQuote
          ? new Date(websocketQuote.timestamp).toISOString()
          : null,
        lastSuccessfulRestAt: restReady ? completedAt : null,
        lastSessionRefreshAt: context.sessionRefreshHappened ? completedAt : null,
        diagnostics: {
          retryCount: context.retryCount,
          sessionRefreshHappened: context.sessionRefreshHappened,
          restReady,
          websocketReady,
        },
      },
      { headers: PUBLIC_NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: true,
        service: "capitalive",
        serviceStatus: "ready",
        capitalStatus: "degraded",
        capitalSession: "degraded",
        quoteProvider: "Capital.com",
        environment,
        checkedAt,
        diagnosticScope: "active_self_check",
        lastSuccessfulQuoteAt: null,
        lastSuccessfulWebSocketAt: null,
        lastSuccessfulRestAt: null,
        lastSessionRefreshAt:
          sessionReady && context.sessionRefreshHappened ? checkedAt : null,
        error: safeHealthError(error),
        diagnostics: {
          retryCount: context.retryCount,
          sessionRefreshHappened: context.sessionRefreshHappened,
          restReady: false,
          websocketReady: false,
        },
      },
      { headers: PUBLIC_NO_STORE_HEADERS },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...PUBLIC_NO_STORE_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
