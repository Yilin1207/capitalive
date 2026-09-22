import { NextResponse } from "next/server";
import {
  capitalEnvironment,
  ensureCapitalSession,
  getMarketSummaries,
  getMarketSnapshot,
  PUBLIC_SYMBOLS,
  type CapitalSnapshot,
  type CapitalMarketSummary,
  type PublicSymbol,
} from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUOTE_EPICS: Record<PublicSymbol, string> = {
  NAS100: "US100",
  JP225: "J225",
  USDJPY: "USDJPY",
  EURUSD: "EURUSD",
  XAUUSD: "GOLD",
};

type MarketQuote = {
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

function unavailable(symbol: PublicSymbol): MarketQuote {
  return {
    epic: QUOTE_EPICS[symbol],
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
    epic:
      typeof response.instrument?.epic === "string"
        ? response.instrument.epic
        : QUOTE_EPICS[symbol],
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

  const requests = await Promise.allSettled(
    PUBLIC_SYMBOLS.map((symbol) => getMarketSnapshot(QUOTE_EPICS[symbol])),
  );

  let summaries: Record<string, CapitalMarketSummary> = {};
  let timestampError: string | undefined;
  try {
    summaries = await getMarketSummaries(PUBLIC_SYMBOLS.map((symbol) => QUOTE_EPICS[symbol]));
  } catch {
    timestampError = "Capital.com timestamp unavailable";
  }

  const serverTime = new Date();
  const markets = {} as Record<PublicSymbol, MarketQuote>;
  let availableCount = 0;

  PUBLIC_SYMBOLS.forEach((symbol, index) => {
    const epic = QUOTE_EPICS[symbol];
    const request = requests[index];
    const normalized =
      request.status === "fulfilled"
        ? normalizeQuote(
            symbol,
            request.value,
            summaries[epic],
            serverTime.getTime(),
            timestampError,
          )
        : null;
    markets[symbol] = normalized ?? unavailable(symbol);
    if (normalized) availableCount += 1;
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
