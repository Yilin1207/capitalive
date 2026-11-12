import { setTimeout as delay } from "node:timers/promises";
import { archiveConfigured, closeArchive, ensureArchive, saveQuote, saveWorkerStatus } from "../lib/archive";
import { capitalEnvironment, getMarketSummaries, VERIFIED_MARKETS, type CapitalMarketSummary } from "../lib/capital";
import { streamQuotes } from "../lib/capital-stream";
import { providerTime, type StreamDiagnostics, type StreamTick } from "../lib/tick-data";

const symbols = ["NAS100", "JP225", "EURUSD", "GER40", "EU50", "UK100", "BRENT"] as const;
const byEpic = Object.fromEntries(symbols.map(symbol => [VERIFIED_MARKETS[symbol].epic, symbol]));
const epics = Object.keys(byEpic);

async function main() {
  if (!archiveConfigured()) throw new Error("Configure DATABASE_URL or persistent ARCHIVE_SQLITE_PATH before starting the worker");
  await ensureArchive();
  const environment = capitalEnvironment();
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const secondsArg = process.argv.find(arg => arg.startsWith("--seconds="));
  const seconds = secondsArg ? Number(secondsArg.split("=")[1]) : 0;
  if (secondsArg && (!Number.isFinite(seconds) || seconds <= 0)) throw new Error("Invalid --seconds");
  const deadline = seconds ? setTimeout(() => controller.abort(), seconds * 1000) : undefined;
  let diagnostics: StreamDiagnostics | null = null;
  let summaries: Record<string, CapitalMarketSummary> = {};
  const latest: Record<string, StreamTick> = {};
  let pending = 0, written = 0, reconnects = 0, archiveFailed = false;
  let queue = Promise.resolve();
  let statusWriting = false;
  const heartbeat = async () => {
    if (statusWriting) return;
    statusWriting = true;
    try { await saveWorkerStatus(environment, { heartbeat_at: new Date().toISOString(), running: !controller.signal.aborted,
      written_ticks: written, pending_writes: pending, reconnects, archive_failed: archiveFailed, websocket: diagnostics }); }
    catch { archiveFailed = true; controller.abort(); console.error({ event: "worker_archive_status_failed" }); }
    finally { statusWriting = false; }
  };
  const statusTimer = setInterval(() => { void heartbeat(); }, 5000);
  const enqueue = (write: () => Promise<void>) => {
    if (pending >= 10_000) {
      archiveFailed = true; controller.abort();
      console.error({ event: "worker_archive_backpressure_gap", at: new Date().toISOString() });
      return;
    }
    pending++;
    queue = queue.then(write).catch(() => {
      archiveFailed = true; controller.abort(); console.error({ event: "worker_archive_write_failed", at: new Date().toISOString() });
    }).finally(() => { pending--; });
  };
  let restRunning = false;
  const refreshRest = async () => {
    if (restRunning || controller.signal.aborted) return;
    restRunning = true;
    try {
      summaries = await getMarketSummaries(epics);
      const now = new Date().toISOString();
      for (const epic of epics) {
        const summary = summaries[epic];
        if (!summary || typeof summary.bid !== "number" || typeof summary.offer !== "number" || summary.bid > summary.offer) continue;
        const timestamp = providerTime(summary.updateTimeUTC);
        enqueue(() => saveQuote({ symbol: byEpic[epic], epic, bid: summary.bid as number, ask: summary.offer as number,
          provider_timestamp: timestamp, received_at_utc: now, fetched_at_utc: now, source_type: "REST", environment,
          market_status: typeof summary.marketStatus === "string" ? summary.marketStatus : null,
          age_seconds: timestamp ? (Date.parse(now) - Date.parse(timestamp)) / 1000 : null }));
        const tick = latest[epic];
        if (diagnostics?.instruments[epic]) diagnostics.instruments[epic].fallback_reason = !tick || Date.now() - Date.parse(tick.received_at_utc) > 15_000 ? "no_recent_websocket_tick" : null;
      }
    } catch { console.error({ event: "worker_rest_unavailable" }); }
    finally { restRunning = false; }
  };
  const restTimer = setInterval(() => { void refreshRest(); }, 60_000);
  try {
    await refreshRest();
    while (!controller.signal.aborted) {
      console.info({ event: "worker_connecting", environment, symbols });
      const started = Date.now();
      const result = await streamQuotes(epics, { signal: controller.signal,
        onDiagnostics: value => { diagnostics = value; },
        onTick: tick => {
          latest[tick.epic] = tick;
          const summary = summaries[tick.epic];
          enqueue(async () => {
            await saveQuote({ symbol: byEpic[tick.epic], epic: tick.epic, bid: tick.bid, ask: tick.ask,
              provider_timestamp: new Date(tick.timestamp).toISOString(), received_at_utc: tick.received_at_utc, fetched_at_utc: tick.received_at_utc,
              source_type: "WEBSOCKET", environment, market_status: typeof summary?.marketStatus === "string" ? summary.marketStatus : null,
              age_seconds: (Date.parse(tick.received_at_utc) - tick.timestamp) / 1000 });
            written++;
          });
        },
      });
      diagnostics = result.diagnostics;
      await queue;
      await heartbeat();
      console.info({ event: "worker_disconnected", reason: diagnostics.reason, written_ticks: written, diagnostics });
      if (!controller.signal.aborted) {
        reconnects++;
        const backoff = Date.now() - started > 60_000 ? 1000 : Math.min(30_000, 1000 * 2 ** Math.min(reconnects, 5));
        await delay(backoff, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    }
  } finally {
    clearInterval(restTimer); clearInterval(statusTimer); clearTimeout(deadline);
    // Wait for in-flight REST/status work before closing the connection.
    while (restRunning || statusWriting) await delay(25);
    await queue; await heartbeat(); await closeArchive();
  }
  if (archiveFailed) throw new Error("Archive write failed; supervision must restart the worker and investigate the gap");
}
main().catch(error => { console.error({ event: "worker_stopped", reason: error instanceof Error && error.message.startsWith("Configure") ? error.message : "worker_failure" }); process.exitCode = 1; });
