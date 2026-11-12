import type { CapitalSnapshot, CapitalMarketSummary } from './capital';
import type { CapitalStreamingQuote } from './capital-stream';
import { providerTime } from './tick-data';
import { actionableLive, quoteQuality, type QuoteQuality } from './market-semantics';

export type MarketQuote = {
  source_type: "WEBSOCKET" | "REST";
  role?: "tradable" | "context";
  retrieved_at?: string | null;
  live_retrieval?: boolean;
  provider_timestamp_available?: boolean;
  provider_timestamp?: string | null;
  received_at_utc?: string | null;
  fetched_at_utc?: string;
  environment?: "demo" | "live";
  rest_fallback_reason?: string | null;
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
  actionable_live: boolean;
  quote_quality: QuoteQuality;
  timestamp_error?: string;
  error?: string;
};


function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function unavailable(symbol: string, epic: string | null): MarketQuote {
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
    actionable_live: false,
    quote_quality: "unavailable",
    error: "Capital.com quote unavailable",
  };
}

export function normalizeQuote(
  symbol: string,
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
  if (bid === null || ask === null || bid > ask) return null;

  // Timestamp must belong to this exact price response, never another batch snapshot.
  const timestamp = providerTime(snapshot.updateTimeUTC);
  const quoteTime = timestamp ? new Date(timestamp) : null;
  const ageSeconds = quoteTime
    ? (serverTimeMs - quoteTime.getTime()) / 1000
    : null;
  const delaySeconds = finiteNumber(batchMarket?.delayTime);

  const marketStatus =
    typeof snapshot.marketStatus === "string" ? snapshot.marketStatus : null;
  const fresh =
    ageSeconds !== null &&
    ageSeconds >= 0 &&
    ageSeconds <= 300 &&
    delaySeconds === 0;
  const providerTimestampAvailable = quoteTime !== null;

  return {
    source_type: "REST",
    retrieved_at: retrievedAt,
    received_at_utc: retrievedAt,
    live_retrieval: true,
    provider_timestamp_available: providerTimestampAvailable,
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
    market_status: marketStatus,
    high: finiteNumber(snapshot.high),
    low: finiteNumber(snapshot.low),
    net_change: finiteNumber(snapshot.netChange),
    percentage_change: finiteNumber(snapshot.percentageChange),
    fresh,
    actionable_live: actionableLive(marketStatus, fresh),
    quote_quality: quoteQuality("REST", providerTimestampAvailable, fresh),
    ...(timestampError ? { timestamp_error: timestampError } : {}),
  };
}

export function normalizeStreamingQuote(
  symbol: string,
  quote: CapitalStreamingQuote,
  restQuote: MarketQuote | null,
  serverTimeMs: number,
): MarketQuote | null {
  const quoteDate = new Date(quote.timestamp);
  if (Number.isNaN(quoteDate.getTime())) return null;

  const ageSeconds = (serverTimeMs - quote.timestamp) / 1000;
  const fresh = ageSeconds >= 0 && ageSeconds <= 300;
  const marketStatus = restQuote?.market_status ?? null;
  return {
    source_type: "WEBSOCKET",
    retrieved_at: quote.received_at_utc,
    received_at_utc: quote.received_at_utc,
    live_retrieval: true,
    provider_timestamp_available: true,
    epic: quote.epic,
    name: restQuote?.name ?? symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid: (quote.bid + quote.ask) / 2,
    quote_time: quoteDate.toISOString(),
    age_seconds: ageSeconds,
    delay_seconds: null,
    streaming_prices_available: true,
    market_status: marketStatus,
    high: restQuote?.high ?? null,
    low: restQuote?.low ?? null,
    net_change: restQuote?.net_change ?? null,
    percentage_change: restQuote?.percentage_change ?? null,
    fresh,
    actionable_live: actionableLive(marketStatus, fresh),
    quote_quality: quoteQuality("WEBSOCKET", true, fresh),
  };
}

