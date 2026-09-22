import { NextResponse } from "next/server";
import {
  capitalEnvironment,
  ensureCapitalSession,
  getMarketSummaries,
  getMarketSnapshot,
  PUBLIC_SYMBOLS,
  resolveMarket,
  type CapitalSnapshot,
  type CapitalMarketSummary,
  type PublicSymbol,
} from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";
import {
  getStreamingQuotes,
  type CapitalStreamingQuote,
} from "@/lib/capital-stream";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUOTE_EPICS: Partial<Record<PublicSymbol, string>> = {
  NAS100: "US100",
  JP225: "J225",
  USDJPY: "USDJPY",
  EURUSD: "EURUSD",
  XAUUSD: "GOLD",
};

async function resolveQuoteEpics(): Promise<Record<PublicSymbol, string | null>> {
  const epics = {} as Record<PublicSymbol, string | null>;
  for (const symbol of PUBLIC_SYMBOLS) {
    const knownEpic = QUOTE_EPICS[symbol];
    if (knownEpic) {
      epics[symbol] = knownEpic;
      continue;
    }

    try {
      epics[symbol] = (await resolveMarket(symbol)).epic;
    } catch {
      epics[symbol] = null;
    }
  }
  return epics;
}

type MarketQuote = {
  source_type: "WEBSOCKET" | "REST";
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

function upstreamUnavailable(step: "authentication" | "markets_batch" | "single_market") {
  return json(
    {
      server_time: new Date().toISOString(),
      source: "Capital.com Public API",
      error: "Capital.com upstream unavailable",
      step,
    },
    502,
  );
}

export async function GET() {
  let environment: "demo" | "live";
  try {
    environment = capitalEnvironment();
    await ensureCapitalSession();
  } catch {
    return upstreamUnavailable("authentication");
  }

  const quoteEpics = await resolveQuoteEpics();
  const epics = PUBLIC_SYMBOLS.flatMap((symbol) => {
    const epic = quoteEpics[symbol];
    return epic ? [epic] : [];
  });
  const [requests, streamingQuotes, batchResult] = await Promise.all([
    Promise.allSettled(
      PUBLIC_SYMBOLS.map((symbol) => {
        const epic = quoteEpics[symbol];
        return epic ? getMarketSnapshot(epic) : Promise.reject(new Error("No epic"));
      }),
    ),
    getStreamingQuotes(epics, 2500),
    getMarketSummaries(epics)
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
    const epic = quoteEpics[symbol];
    const request = requests[index];
    const restQuote =
      epic && request.status === "fulfilled"
        ? normalizeQuote(
            symbol,
            epic,
            request.value,
            batchResult.summaries[epic],
            serverTime.getTime(),
            batchResult.timestampError,
          )
        : null;
    const streamingQuote = epic ? streamingQuotes[epic] : undefined;
    const websocketQuote = streamingQuote
      ? normalizeStreamingQuote(symbol, streamingQuote, restQuote, serverTime.getTime())
      : null;
    markets[symbol] = websocketQuote ?? restQuote ?? unavailable(symbol, epic);
    if (websocketQuote || restQuote) availableCount += 1;
  });

  if (availableCount === 0) return upstreamUnavailable("single_market");

  return json({
    server_time: serverTime.toISOString(),
    source: "Capital.com Public API",
    environment,
    markets,
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
