export function markQuotesStale<T extends Record<string, object>>(quotes: T) {
  return Object.fromEntries(
    Object.entries(quotes).map(([symbol, quote]) => [
      symbol,
      { ...quote, fresh: false, stale: true },
    ]),
  );
}
