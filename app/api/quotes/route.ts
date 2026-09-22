import { NextResponse } from "next/server";
import {
  capitalEnvironment,
  ensureCapitalSession,
  getMarketSummaries,
  getMarketSnapshot,
  PUBLIC_SYMBOLS,
  resolveAllMarkets,
  type CapitalSnapshot,
  type CapitalMarketSummary,
  type MarketMapping,
  type PublicSymbol,
} from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MarketQuote = {
  epic: string | null;
  name: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  quote_time: string | null;
  age_seconds: number | null;
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

function unavailable(mapping: MarketMapping | null): MarketQuote {
  return {
    epic: mapping?.epic ?? null,
    name: mapping?.name ?? null,
    bid: null,
    ask: null,
    mid: null,
    quote_time: null,
    age_seconds: null,
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
  mapping: MarketMapping,
  response: CapitalSnapshot,
  summary: CapitalMarketSummary | undefined,
  serverTimeMs: number,
): MarketQuote | null {
  const snapshot = response.snapshot;
  if (!snapshot) return null;

  const bid = finiteNumber(snapshot.bid);
  const ask = finiteNumber(snapshot.offer);
  if (bid === null || ask === null) return null;

  const quoteTime = utcDate(snapshot.updateTimeUTC ?? summary?.updateTimeUTC);
  const ageSeconds = quoteTime
    ? Math.round(((serverTimeMs - quoteTime.getTime()) / 1000) * 1000) / 1000
    : null;

  return {
    epic:
      typeof response.instrument?.epic === "string" ? response.instrument.epic : mapping.epic,
    name:
      typeof response.instrument?.name === "string" ? response.instrument.name : mapping.name,
    bid,
    ask,
    mid: (bid + ask) / 2,
    quote_time: quoteTime?.toISOString() ?? null,
    age_seconds: ageSeconds,
    market_status:
      typeof snapshot.marketStatus === "string" ? snapshot.marketStatus : null,
    high: finiteNumber(snapshot.high),
    low: finiteNumber(snapshot.low),
    net_change: finiteNumber(snapshot.netChange),
    percentage_change: finiteNumber(snapshot.percentageChange),
    fresh: ageSeconds !== null && ageSeconds >= 0 && ageSeconds <= 300,
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

  const mappings = await resolveAllMarkets();
  const epics = PUBLIC_SYMBOLS.flatMap((symbol) =>
    mappings[symbol] ? [mappings[symbol].epic] : [],
  );
  const [requests, summaries] = await Promise.all([
    Promise.allSettled(PUBLIC_SYMBOLS.map((symbol) => {
      const mapping = mappings[symbol];
      return mapping ? getMarketSnapshot(mapping.epic) : Promise.reject(new Error("No epic"));
    })),
    epics.length > 0
      ? getMarketSummaries(epics).catch(
          (): Record<string, CapitalMarketSummary> => ({}),
        )
      : Promise.resolve<Record<string, CapitalMarketSummary>>({}),
  ]);

  const serverTime = new Date();
  const markets = {} as Record<PublicSymbol, MarketQuote>;
  let availableCount = 0;

  PUBLIC_SYMBOLS.forEach((symbol, index) => {
    const mapping = mappings[symbol];
    const request = requests[index];
    const normalized =
      mapping && request.status === "fulfilled"
        ? normalizeQuote(
            mapping,
            request.value,
            summaries[mapping.epic],
            serverTime.getTime(),
          )
        : null;
    markets[symbol] = normalized ?? unavailable(mapping);
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
