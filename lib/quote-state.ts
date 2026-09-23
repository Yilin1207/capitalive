import "server-only";
import { markQuotesStale } from "@/lib/quote-state-utils";

const processStartedAt = Date.now();

type QuoteRecord = Record<string, unknown>;

type StoredSnapshot = {
  fetchedAt: string;
  quotes: Record<string, QuoteRecord>;
};

let lastSuccessfulSnapshot: StoredSnapshot | null = null;

export function recordSuccessfulQuotes(
  quotes: Record<string, QuoteRecord>,
  fetchedAt: string,
) {
  lastSuccessfulSnapshot = {
    fetchedAt,
    quotes: structuredClone(quotes),
  };
}

export function getLastGood(now = Date.now()) {
  if (!lastSuccessfulSnapshot) return null;
  const fetchedAtMs = Date.parse(lastSuccessfulSnapshot.fetchedAt);
  const quotes = markQuotesStale(lastSuccessfulSnapshot.quotes);

  return {
    stale: true as const,
    ageMs: Number.isFinite(fetchedAtMs) ? Math.max(0, now - fetchedAtMs) : null,
    fetchedAt: lastSuccessfulSnapshot.fetchedAt,
    quotes,
  };
}

export function quoteProcessDiagnostics(now = Date.now()) {
  return {
    lastSuccessfulQuoteAt: lastSuccessfulSnapshot?.fetchedAt ?? null,
    uptime: Math.max(0, Math.floor((now - processStartedAt) / 1000)),
  };
}
