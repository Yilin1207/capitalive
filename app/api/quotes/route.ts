import { NextResponse } from "next/server";
import {
  CapitalApiError,
  capitalEnvironment,
  createCapitalRequestContext,
  ensureCapitalSession,
  getMarketSummaries,
  getMarketSnapshot,
  PUBLIC_SYMBOLS,
  VERIFIED_MARKETS,
  type CapitalMarketSummary,
  type CapitalRequestContext,
  type PublicSymbol,
} from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";
import { liveQuotes } from "@/lib/live-quotes";
import { archiveConfigured, saveQuote } from "@/lib/archive";
import { getLastGood, recordSuccessfulQuotes } from "@/lib/quote-state";
import {
  CONTEXT_MARKETS,
  CONTEXT_SYMBOLS,
  DERIVED,
  RELATIONSHIPS,
  TRADABLE_METADATA,
  UNAVAILABLE_CONTEXT_MARKETS,
  type ContextSymbol,
} from "@/lib/market-context";
import { normalizeQuote, normalizeStreamingQuote, unavailable, type MarketQuote } from "@/lib/quote-normalization";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_NO_STORE_HEADERS });
}

function publicError(error: unknown) {
  const code = error instanceof CapitalApiError ? error.code : "CAPITAL_UPSTREAM";
  const messages: Record<string, string> = {
    CAPITAL_AUTH: "Capital.com authentication failed",
    CAPITAL_CONFIG: "Capital.com is not configured",
    CAPITAL_INVALID_RESPONSE: "Capital.com returned an invalid response",
    CAPITAL_RATE_LIMIT: "Capital.com rate limit reached",
    CAPITAL_TIMEOUT: "Capital.com request timed out",
    CAPITAL_UPSTREAM: "Capital.com upstream unavailable",
  };
  return { code, message: messages[code] ?? messages.CAPITAL_UPSTREAM };
}

function logQuoteRequest(
  context: CapitalRequestContext,
  startedAt: number,
  upstreamStatus: "ok" | "partial" | "failed",
  quotesReturned: number,
) {
  console.info({
    event: "quotes_request",
    requestId: context.requestId,
    upstreamStatus,
    durationMs: Date.now() - startedAt,
    retryCount: context.retryCount,
    sessionRefreshHappened: context.sessionRefreshHappened,
    quotesReturned,
  });
}

function upstreamUnavailable(
  step: "authentication" | "markets_batch" | "single_market",
  error: unknown,
  context: CapitalRequestContext,
  startedAt: number,
) {
  const fetchedAt = new Date().toISOString();
  logQuoteRequest(context, startedAt, "failed", 0);
  return json(
    {
      ok: false,
      server_time: fetchedAt,
      serverTime: fetchedAt,
      fetchedAt,
      source: "Capital.com Public API",
      provider: "Capital.com",
      error: publicError(error),
      step,
      requestId: context.requestId,
      diagnostics: {
        retryCount: context.retryCount,
        sessionRefreshHappened: context.sessionRefreshHappened,
      },
      lastGood: getLastGood(Date.parse(fetchedAt)),
    },
    502,
  );
}

export async function GET() {
  const startedAt = Date.now();
  const context = createCapitalRequestContext();
  let environment: "demo" | "live";
  try {
    environment = capitalEnvironment();
    await ensureCapitalSession(context);
  } catch (error) {
    return upstreamUnavailable("authentication", error, context, startedAt);
  }

  const instruments = [
    ...PUBLIC_SYMBOLS.map((symbol) => ({
      symbol,
      epic: VERIFIED_MARKETS[symbol].epic,
      role: TRADABLE_METADATA[symbol].role,
    })),
    ...CONTEXT_SYMBOLS.map((symbol) => ({
      symbol,
      epic: CONTEXT_MARKETS[symbol].epic,
      role: "context" as const,
    })),
  ];
  const epics = instruments.map(({ epic }) => epic);
  const [requests, streamingResult, batchResult] = await Promise.all([
    Promise.allSettled(
      instruments.map(({ epic }) => {
        return getMarketSnapshot(epic, context).then((response) => ({
          response,
          retrievedAt: new Date().toISOString(),
        }));
      }),
    ),
    liveQuotes(epics, context),
    getMarketSummaries(epics, context)
      .then((summaries) => ({ summaries, timestampError: undefined }))
      .catch(
        (): {
          summaries: Record<string, CapitalMarketSummary>;
          timestampError: string;
        } => ({
          summaries: {},
          timestampError: "Capital.com timestamp unavailable",
        }),
      ),
  ]);

  const serverTime = new Date();
  const streamingQuotes = streamingResult.quotes;
  const archiveWrites: Promise<void>[] = [];
  let archiveStatus = streamingResult.diagnostics.archive_status;
  const enrich = (quote: MarketQuote, symbol: string): MarketQuote => {
    quote.provider_timestamp = quote.quote_time;
    quote.received_at_utc ??= quote.retrieved_at ?? null;
    quote.fetched_at_utc = serverTime.toISOString();
    quote.environment = environment;
    quote.rest_fallback_reason = quote.source_type === "REST"
      ? streamingResult.diagnostics.request?.instruments[quote.epic ?? ""]?.fallback_reason ?? "no_recent_archived_tick" : null;
    if (archiveConfigured() && quote.bid !== null && quote.ask !== null && quote.epic && quote.received_at_utc) {
      archiveWrites.push(saveQuote({ symbol, epic: quote.epic, bid: quote.bid, ask: quote.ask,
        provider_timestamp: quote.quote_time, received_at_utc: quote.received_at_utc, fetched_at_utc: quote.fetched_at_utc,
        environment, source_type: quote.source_type, market_status: quote.market_status, age_seconds: quote.age_seconds,
      }).catch(() => { archiveStatus = "unavailable"; }));
    }
    return quote;
  };
  const markets = {} as Record<PublicSymbol, MarketQuote>;
  const contextMarkets = {} as Record<ContextSymbol, MarketQuote>;
  let availableCount = 0;

  PUBLIC_SYMBOLS.forEach((symbol, index) => {
    const epic = VERIFIED_MARKETS[symbol].epic;
    const request = requests[index];
    const restQuote =
      request.status === "fulfilled"
        ? normalizeQuote(
            symbol,
            epic,
            request.value.response,
            batchResult.summaries[epic],
            request.value.retrievedAt,
            serverTime.getTime(),
            batchResult.timestampError,
          )
        : null;
    const streamingQuote = streamingQuotes[epic];
    if (restQuote) enrich(restQuote, symbol);
    const websocketQuote = streamingQuote
      ? normalizeStreamingQuote(symbol, streamingQuote, restQuote, serverTime.getTime())
      : null;
    markets[symbol] = {
      ...enrich(websocketQuote ?? restQuote ?? unavailable(symbol, epic), symbol),
      role: TRADABLE_METADATA[symbol].role,
    };
    if (websocketQuote || restQuote) availableCount += 1;
  });

  CONTEXT_SYMBOLS.forEach((symbol, contextIndex) => {
    const index = PUBLIC_SYMBOLS.length + contextIndex;
    const epic = CONTEXT_MARKETS[symbol].epic;
    const request = requests[index];
    const restQuote =
      request.status === "fulfilled"
        ? normalizeQuote(
            symbol,
            epic,
            request.value.response,
            batchResult.summaries[epic],
            request.value.retrievedAt,
            serverTime.getTime(),
            batchResult.timestampError,
          )
        : null;
    const streamingQuote = streamingQuotes[epic];
    if (restQuote) enrich(restQuote, symbol);
    const websocketQuote = streamingQuote
      ? normalizeStreamingQuote(symbol, streamingQuote, restQuote, serverTime.getTime())
      : null;
    contextMarkets[symbol] = {
      ...enrich(websocketQuote ?? restQuote ?? unavailable(symbol, epic), symbol),
      role: "context",
    };
  });

  await Promise.all(archiveWrites);
  if (availableCount === 0) {
    const firstFailure = requests.slice(0, PUBLIC_SYMBOLS.length).find(
      (request): request is PromiseRejectedResult => request.status === "rejected",
    );
    return upstreamUnavailable(
      "single_market",
      firstFailure?.reason,
      context,
      startedAt,
    );
  }

  const fetchedAt = serverTime.toISOString();
  recordSuccessfulQuotes(markets, fetchedAt);
  logQuoteRequest(
    context,
    startedAt,
    availableCount === PUBLIC_SYMBOLS.length ? "ok" : "partial",
    availableCount,
  );
  return json({
    ok: true,
    server_time: fetchedAt,
    serverTime: fetchedAt,
    fetchedAt,
    source: "Capital.com Public API",
    provider: "Capital.com",
    environment,
    markets,
    quotes: markets,
    context_markets: contextMarkets,
    metadata: {
      schema_version: 2,
      instruments: {
        ...TRADABLE_METADATA,
        ...CONTEXT_MARKETS,
      },
      unavailable_context_markets: UNAVAILABLE_CONTEXT_MARKETS,
      semantics: {
        fresh: "Provider-timestamp freshness only; REST without a provider timestamp remains false.",
        live_retrieval: "The quote was actively retrieved during this request.",
        actionable_live: "True only for a TRADEABLE market with a provider-fresh quote.",
        inverse_to_yield: "A rising bond price or bond-future price generally implies a falling yield.",
      },
    },
    relationships: RELATIONSHIPS,
    derived: DERIVED,
    requestId: context.requestId,
    diagnostics: {
      retryCount: context.retryCount,
      sessionRefreshHappened: context.sessionRefreshHappened,
      websocket: streamingResult.diagnostics,
      archive_status: archiveStatus,
    },
  });
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
