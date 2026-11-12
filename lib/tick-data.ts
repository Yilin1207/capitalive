export type ArchivedQuote = {
  symbol: string; epic: string; bid: number; ask: number;
  provider_timestamp: string | null; received_at_utc: string; fetched_at_utc: string;
  source_type: "WEBSOCKET" | "REST"; environment: "demo" | "live";
  market_status: string | null; age_seconds: number | null;
};

export function providerTime(value: unknown): string | null {
  // A time-of-day alone has no unambiguous date. Never attach today's date.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)?$/.test(value)) return null;
  const time = new Date(/(?:Z|\+00:00)$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return time.toISOString();
}
export function tickAge(timestamp: string | null, at: number): number | null {
  return timestamp === null ? null : (at - Date.parse(timestamp)) / 1000;
}
export type StreamTick = { epic: string; bid: number; ask: number; timestamp: number; received_at_utc: string };
export type StreamDiagnostics = {
  connection: "connecting" | "connected" | "closed" | "failed";
  connected_at: string | null; disconnected_at: string | null;
  reason: string | null; invalid_ticks: number;
  instruments: Record<string, { subscription: "pending" | "confirmed" | "rejected"; last_tick: StreamTick | null; fallback_reason: string | null }>;
};
export function streamDiagnostics(epics: readonly string[]): StreamDiagnostics {
  return { connection: "connecting", connected_at: null, disconnected_at: null, reason: null, invalid_ticks: 0,
    instruments: Object.fromEntries(epics.map(epic => [epic, { subscription: "pending", last_tick: null, fallback_reason: null }])) };
}
export function acceptStreamMessage(raw: string, diagnostics: StreamDiagnostics, receivedAt = Date.now()): StreamTick | null {
  let message;
  try { message = JSON.parse(raw); } catch { return null; }
  if (!message || typeof message !== "object") return null;
  if (message.destination === "marketData.subscribe") {
    for (const [epic, item] of Object.entries(diagnostics.instruments)) {
      if (message.status !== "OK" && item.subscription === "pending") {
        item.subscription = "rejected"; item.fallback_reason = "subscription_rejected";
      }
      const status = message.payload?.subscriptions?.[epic];
      if (status !== undefined) {
        item.subscription = message.status === "OK" && status === "PROCESSED" ? "confirmed" : "rejected";
        if (item.subscription === "rejected") item.fallback_reason = "subscription_rejected";
      }
    }
    return null;
  }
  const p = message.payload;
  if (message.destination !== "quote" || message.status !== "OK" || !p || !Object.hasOwn(diagnostics.instruments, p.epic)) return null;
  if (![p.bid, p.ofr, p.timestamp].every(value => typeof value === "number" && Number.isFinite(value))
    || p.bid > p.ofr || p.timestamp < 1_000_000_000_000 || p.timestamp > receivedAt + 60_000) {
    diagnostics.invalid_ticks++;
    return null;
  }
  const tick = { epic: p.epic as string, bid: p.bid as number, ask: p.ofr as number, timestamp: p.timestamp as number, received_at_utc: new Date(receivedAt).toISOString() };
  const previous = diagnostics.instruments[p.epic].last_tick;
  // Persist out-of-order events, but do not regress the latest provider timestamp.
  if (!previous || tick.timestamp >= previous.timestamp) diagnostics.instruments[p.epic].last_tick = tick;
  return tick;
}
