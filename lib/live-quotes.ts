import "server-only";
import { archiveConfigured, findQuote, readWorkerStatus, saveQuote } from "./archive";
import { capitalEnvironment, VERIFIED_MARKETS, type CapitalRequestContext, type PublicSymbol } from "./capital";
import { streamQuotes } from "./capital-stream";
import type { StreamTick } from "./tick-data";

export async function liveQuotes(epics: string[], context: CapitalRequestContext) {
  const environment = capitalEnvironment();
  const cached: Record<string, StreamTick> = {};
  let archiveStatus = archiveConfigured() ? "ready" : "not_configured";
  let worker: unknown = null;
  if (archiveConfigured()) {
    try {
      const status = await readWorkerStatus(environment) as { heartbeat_at?: string } | null;
      const age = status?.heartbeat_at ? (Date.now() - Date.parse(status.heartbeat_at)) / 1000 : null;
      worker = status ? { ...status, heartbeat_age_seconds: age, heartbeat_fresh: age !== null && age >= 0 && age <= 20 } : null;
      for (const [symbol, market] of Object.entries(VERIFIED_MARKETS)) {
        if (!epics.includes(market.epic)) continue;
        const tick = await findQuote(symbol, environment, Date.now(), "latest_ws");
        if (tick && tick.provider_timestamp && Date.now() - Date.parse(tick.received_at_utc) <= 15_000 && Date.now() - Date.parse(tick.provider_timestamp) <= 300_000) {
          cached[market.epic] = { epic: market.epic, bid: tick.bid, ask: tick.ask, timestamp: Date.parse(tick.provider_timestamp), received_at_utc: tick.received_at_utc };
        }
      }
    } catch { archiveStatus = "unavailable"; }
  }
  const pending: Promise<void>[] = [];
  const missing = epics.filter(epic => !cached[epic]);
  const stream = missing.length ? await streamQuotes(missing, { durationMs: 2500, stopAfterFirst: true, context,
    onTick: tick => {
      if (!archiveConfigured()) return;
      const symbol = (Object.keys(VERIFIED_MARKETS) as PublicSymbol[]).find(symbol => VERIFIED_MARKETS[symbol].epic === tick.epic);
      if (!symbol) return;
      pending.push(saveQuote({ symbol, epic: tick.epic, bid: tick.bid, ask: tick.ask,
        provider_timestamp: new Date(tick.timestamp).toISOString(), received_at_utc: tick.received_at_utc, fetched_at_utc: tick.received_at_utc,
        source_type: "WEBSOCKET", environment, market_status: null, age_seconds: (Date.parse(tick.received_at_utc) - tick.timestamp) / 1000,
      }).catch(() => { archiveStatus = "unavailable"; }));
    },
  }) : null;
  await Promise.all(pending);
  return { quotes: { ...cached, ...stream?.quotes }, diagnostics: { request: stream?.diagnostics ?? null, worker, archive_status: archiveStatus, archive_epics: Object.keys(cached) } };
}
