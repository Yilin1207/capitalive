import "server-only";
import WebSocket from "ws";
import { createCapitalRequestContext, getCapitalStreamingSession } from "@/lib/capital";
import { acceptStreamMessage, streamDiagnostics, type StreamDiagnostics, type StreamTick } from "@/lib/tick-data";
export type CapitalStreamingQuote = StreamTick;

export async function streamQuotes(epics: readonly string[], options: {
  durationMs?: number; signal?: AbortSignal; stopAfterFirst?: boolean;
  context?: ReturnType<typeof createCapitalRequestContext>;
  onTick?: (tick: StreamTick) => void;
  onDiagnostics?: (diagnostics: StreamDiagnostics) => void;
  socketFactory?: (url: URL) => WebSocket;
} = {}) {
  const diagnostics = streamDiagnostics(epics);
  const quotes: Record<string, StreamTick> = {};
  let session;
  try { session = await getCapitalStreamingSession(options.context); }
  catch { diagnostics.connection = "failed"; diagnostics.reason = "session_unavailable"; }
  if (!session?.streamEndpoint) {
    for (const item of Object.values(diagnostics.instruments)) item.fallback_reason = diagnostics.reason ?? "stream_endpoint_unavailable";
    options.onDiagnostics?.(diagnostics);
    return { quotes, diagnostics };
  }
  const endpoint = new URL(session.streamEndpoint);
  if (endpoint.protocol !== "wss:") throw new Error("Secure WebSocket required");
  if (endpoint.pathname === "/") endpoint.pathname = "/connect";
  const credentials = { cst: session.cst, securityToken: session.securityToken };
  return new Promise<{ quotes: Record<string, StreamTick>; diagnostics: StreamDiagnostics }>(resolve => {
    const socket = options.socketFactory ? options.socketFactory(endpoint) : new WebSocket(endpoint);
    let finished = false;
    let lastMessage = Date.now();
    let lastPing = 0;
    const emit = () => options.onDiagnostics?.(structuredClone(diagnostics));
    const finish = (reason: string) => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat); clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abort);
      diagnostics.connection = diagnostics.connected_at ? "closed" : "failed";
      diagnostics.disconnected_at = new Date().toISOString(); diagnostics.reason = reason;
      for (const item of Object.values(diagnostics.instruments)) {
        item.fallback_reason = item.last_tick ? null : item.fallback_reason ?? (item.subscription === "confirmed" ? "no_tick_received" : reason);
      }
      emit(); socket.terminate(); resolve({ quotes, diagnostics });
    };
    const abort = () => finish("stopped");
    const deadline = setTimeout(() => finish("collection_timeout"), options.durationMs ?? 24 * 3600_000);
    const heartbeat = setInterval(() => {
      if (Date.now() - lastMessage > 150_000) return finish("heartbeat_timeout");
      if (socket.readyState === WebSocket.OPEN && Date.now() - lastPing >= 60_000) {
        socket.send(JSON.stringify({ destination: "ping", correlationId: "heartbeat", ...credentials }));
        lastPing = Date.now();
      }
    }, 5000);
    options.signal?.addEventListener("abort", abort, { once: true });
    socket.once("open", () => {
      diagnostics.connection = "connected"; diagnostics.connected_at = new Date().toISOString(); emit();
      socket.send(JSON.stringify({ destination: "marketData.subscribe", correlationId: "quotes-1", ...credentials, payload: { epics } }));
    });
    socket.on("message", raw => {
      lastMessage = Date.now();
      const tick = acceptStreamMessage(raw.toString(), diagnostics, lastMessage);
      if (tick) {
        const previous = quotes[tick.epic];
        if (!previous || tick.timestamp >= previous.timestamp) quotes[tick.epic] = tick;
        options.onTick?.(tick);
      }
      emit();
      if (options.stopAfterFirst && Object.keys(quotes).length === epics.length) finish("collection_complete");
    });
    socket.once("error", () => finish("socket_error"));
    socket.once("close", code => finish(`socket_closed_${code}`));
    if (options.signal?.aborted) abort();
  });
}

export async function getStreamingQuotes(epics: readonly string[], timeoutMs = 2500, context = createCapitalRequestContext()) {
  return (await streamQuotes(epics, { durationMs: timeoutMs, stopAfterFirst: true, context })).quotes;
}
