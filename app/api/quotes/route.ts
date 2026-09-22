import { NextResponse } from "next/server";
import {
  capitalEnvironment,
  ensureCapitalSession,
  getMarketSummaries,
  PUBLIC_SYMBOLS,
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
  market: CapitalMarketSummary,
  serverTimeMs: number,
): MarketQuote | null {
  const bid = finiteNumber(market.bid);
  const ask = finiteNumber(market.offer);
  if (bid === null || ask === null) return null;

  const quoteTime = utcDate(market.updateTimeUTC);
  const ageSeconds = quoteTime
    ? (serverTimeMs - quoteTime.getTime()) / 1000
    : null;
  const delaySeconds = finiteNumber(market.delayTime);

  return {
    epic: typeof market.epic === "string" ? market.epic : QUOTE_EPICS[symbol],
    name:
      typeof market.instrumentName === "string"
        ? market.instrumentName
        : typeof market.symbol === "string"
          ? market.symbol
          : symbol,
    bid,
    ask,
    mid: (bid + ask) / 2,
    quote_time: quoteTime?.toISOString() ?? null,
    age_seconds: ageSeconds,
    delay_seconds: delaySeconds,
    streaming_prices_available:
      typeof market.streamingPricesAvailable === "boolean"
        ? market.streamingPricesAvailable
        : null,
    market_status:
      typeof market.marketStatus === "string" ? market.marketStatus : null,
    high: finiteNumber(market.high),
    low: finiteNumber(market.low),
    net_change: finiteNumber(market.netChange),
    percentage_change: finiteNumber(market.percentageChange),
    fresh:
      ageSeconds !== null &&
      ageSeconds >= 0 &&
      ageSeconds <= 300 &&
      delaySeconds === 0,
  };
}

function upstreamUnavailable() {
  return json(
    {
      server_time: new Date().toISOString(),
      source: "Capital.com Public API",
      error: "Capital.com upstream unavailable",
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
    return upstreamUnavailable();
  }

  let summaries: Record<string, CapitalMarketSummary>;
  try {
    summaries = await getMarketSummaries(PUBLIC_SYMBOLS.map((symbol) => QUOTE_EPICS[symbol]));
  } catch {
    return upstreamUnavailable();
  }

  const serverTime = new Date();
  const markets = {} as Record<PublicSymbol, MarketQuote>;
  let availableCount = 0;

  PUBLIC_SYMBOLS.forEach((symbol) => {
    const epic = QUOTE_EPICS[symbol];
    const market = summaries[epic];
    const normalized = market ? normalizeQuote(symbol, market, serverTime.getTime()) : null;
    markets[symbol] = normalized ?? unavailable(symbol);
    if (normalized) availableCount += 1;
  });

  if (availableCount === 0) return upstreamUnavailable();

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
