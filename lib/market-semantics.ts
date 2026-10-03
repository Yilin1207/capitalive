export function actionableLive(marketStatus: string | null, fresh: boolean): boolean {
  return marketStatus === "TRADEABLE" && fresh;
}

export function capitalHealthStatus(
  restReady: boolean,
  websocketReady: boolean,
): "ready" | "degraded" {
  return restReady || websocketReady ? "ready" : "degraded";
}

export type QuoteQuality =
  | "provider_timestamp_verified"
  | "provider_timestamp_outside_freshness_window"
  | "live_rest_unverified_timestamp"
  | "unavailable"
  | "stale_last_good";

export function quoteQuality(
  source: "WEBSOCKET" | "REST",
  providerTimestampAvailable: boolean,
  fresh: boolean,
): QuoteQuality {
  if (!providerTimestampAvailable) {
    return source === "REST" ? "live_rest_unverified_timestamp" : "unavailable";
  }
  return fresh
    ? "provider_timestamp_verified"
    : "provider_timestamp_outside_freshness_window";
}

export function hasUsableSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const snapshot = (value as { snapshot?: unknown }).snapshot;
  if (!snapshot || typeof snapshot !== "object") return false;
  const { bid, offer } = snapshot as { bid?: unknown; offer?: unknown };
  return (
    typeof bid === "number" &&
    Number.isFinite(bid) &&
    typeof offer === "number" &&
    Number.isFinite(offer)
  );
}
