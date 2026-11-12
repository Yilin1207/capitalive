export function markQuotesStale<T extends Record<string, object>>(quotes: T) {
  return Object.fromEntries(
    Object.entries(quotes).map(([symbol, quote]) => [
      symbol,
      {
        ...quote,
        ...("provider_timestamp" in quote ? { age_seconds: typeof quote.provider_timestamp === "string" ? (Date.now() - Date.parse(quote.provider_timestamp)) / 1000 : null } : {}),
        fresh: false,
        stale: true,
        actionable_live: false,
        live_retrieval: false,
        quote_quality: "stale_last_good",
      },
    ]),
  );
}
