import { NextResponse } from "next/server";
import {
  CapitalApiError,
  capitalEnvironment,
  createCapitalRequestContext,
  ensureCapitalSession,
  getMarketSummaries,
  getMarketSnapshot,
  PUBLIC_SYMBOLS,
  type CapitalSnapshot,
  type CapitalMarketSummary,
  type CapitalRequestContext,
  type PublicSymbol,
} from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";
import {
  getStreamingQuotes,
  type CapitalStreamingQuote,
} from "@/lib/capital-stream";
import { getLastGood, recordSuccessfulQuotes } from "@/lib/quote-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUOTE_EPICS: Record<PublicSymbol, string> = {
  NAS100: "US100",
  JP225: "J225",
  USDJPY: "USDJPY",
  EURUSD: "EURUSD",
  XAUUSD: "GOLD",
  GER40: "DE40",
  EU50: "EU50",
};

type MarketQuote = {
  source_type: "WEBSOCKET" | "REST";
  retrieved_at?: string | null;
  live_retrieval?: boolean;
  provider_timestamp_available?: boolean;
  epic: string | null;
  name: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  quote_time: string | null;
  age_seconds: number | null;
  delay_seconds: number | null;
  streaming_prices_available: boolean | null;
  market_status: string | null;
  high: number | null;
  low: number | null;
  net_change: number | null;
  percentage_change: number | null;
  fresh: boolean;
  timestamp_error?: string;
  error?: string;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_NO_STORE_HEADERS });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function utcDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unavailable(symbol: PublicSymbol, epic: string | null): MarketQuote {
  return {
    source_type: "REST",
    retrieved_at: null,
    live_retrieval: false,
    provider_timestamp_available: false,
    epic,
    name: null,
    bid: null,
    ask: null,
    mid: null,
    quote_time: null,
    age_seconds: null,
    delay_seconds: null,
    streaming_prices_available: null,
    market_status: null,
    high: null,
    low: null,
    net_change: null,
    percentage_change: null,
    fresh: false,
    error: "Capital.com quote unavailable",
  };
}

function normalizeQuote(
  symbol: PublicSymbol,
  epic: string,
  response: CapitalSnapshot,
  batchMarket: CapitalMarketSummary | undefined,
  retrievedAt: string,
  serverTimeMs: number,
  timestampError?: string,
): MarketQuote | null {
  const snapshot = response.snapshot;
  if (!snapshot) return null;

  const bid = finiteNumber(snapshot.bid);
  const ask = finiteNumber(snapshot.offer);
  if (bid === null || ask === null) return null;

  const quoteTime = utcDate(batchMarket?.updateTimeUTC);
  const ageSeconds = quoteTime
    ? (serverTimeMs - quoteTime.getTime()) / 1000
    : null;
  const delaySeconds = finiteNumber(batchMarket?.delayTime);

  return {
    source_type: "REST",
    retrieved_at: retrievedAt,
    live_retrieval: true,
    provider_timestamp_available: quoteTime !== null,
    epic:
      typeof response.instrument?.epic === "string"
        ? response.instrument.epic
        : epic,
    name:
      typeof response.instrument?.name === "string" ? response.instrument.name : symbol,
    bid,
    ask,
    mid: (bid + ask) / 2,
    quote_time: quoteTime?.toISOString() ?? null,
    age_seconds: ageSeconds,
    delay_seconds: delaySeconds,
    streaming_prices_available:
      typeof batchMarket?.streamingPricesAvailable === "boolean"
        ? batchMarket.streamingPricesAvailable
        : null,
    market_status:
      typeof snapshot.marketStatus === "string" ? snapshot.marketStatus : null,
    high: finiteNumber(snapshot.high),
    low: finiteNumber(snapshot.low),
    net_change: finiteNumber(snapshot.netChange),
    percentage_change: finiteNumber(snapshot.percentageChange),
    fresh:
      ageSeconds !== null &&
      ageSeconds >= 0 &&
      ageSeconds <= 300 &&
      delaySeconds === 0,
    ...(timestampError ? { timestamp_error: timestampError } : {}),
  };
}

function normalizeStreamingQuote(
  symbol: PublicSymbol,
  quote: CapitalStreamingQuote,
  restQuote: MarketQuote | null,
  serverTimeMs: number,
): MarketQuote | null {
  const quoteDate = new Date(quote.timestamp);
  if (Number.isNaN(quoteDate.getTime())) return null;

  const ageSeconds = (serverTimeMs - quote.timestamp) / 1000;
  return {
    source_type: "WEBSOCKET",
    epic: quote.epic,
    name: restQuote?.name ?? symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid: (quote.bid + quote.ask) / 2,
    quote_time: quoteDate.toISOString(),
    age_seconds: ageSeconds,
    delay_seconds: null,
    streaming_prices_available: true,
    market_status: restQuote?.market_status ?? null,
    high: restQuote?.high ?? null,
    low: restQuote?.low ?? null,
    net_change: restQuote?.net_change ?? null,
    percentage_change: restQuote?.percentage_change ?? null,
    fresh: ageSeconds >= 0 && ageSeconds <= 300,
  };
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

  const epics = PUBLIC_SYMBOLS.map((symbol) => QUOTE_EPICS[symbol]);
  const [requests, streamingQuotes, batchResult] = await Promise.all([
    Promise.allSettled(
      PUBLIC_SYMBOLS.map((symbol) => {
        return getMarketSnapshot(QUOTE_EPICS[symbol], context).then((response) => ({
          response,
          retrievedAt: new Date().toISOString(),
        }));
      }),
    ),
    getStreamingQuotes(epics, 2500, context),
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
  const markets = {} as Record<PublicSymbol, MarketQuote>;
  let availableCount = 0;

  PUBLIC_SYMBOLS.forEach((symbol, index) => {
    const epic = QUOTE_EPICS[symbol];
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
    const websocketQuote = streamingQuote
      ? normalizeStreamingQuote(symbol, streamingQuote, restQuote, serverTime.getTime())
      : null;
    markets[symbol] = websocketQuote ?? restQuote ?? unavailable(symbol, epic);
    if (websocketQuote || restQuote) availableCount += 1;
  });

  if (availableCount === 0) {
    const firstFailure = requests.find(
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
    requestId: context.requestId,
    diagnostics: {
      retryCount: context.retryCount,
      sessionRefreshHappened: context.sessionRefreshHappened,
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
