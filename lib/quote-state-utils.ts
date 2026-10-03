export function markQuotesStale<T extends Record<string, object>>(quotes: T) {
  return Object.fromEntries(
    Object.entries(quotes).map(([symbol, quote]) => [
      symbol,
      {
        ...quote,
        fresh: false,
        stale: true,
        actionable_live: false,
        live_retrieval: false,
        quote_quality: "stale_last_good",
      },
    ]),
  );
}
