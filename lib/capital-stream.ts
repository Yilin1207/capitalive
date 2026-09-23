import "server-only";

import WebSocket, { type RawData } from "ws";
import {
  createCapitalRequestContext,
  getCapitalStreamingSession,
  type CapitalRequestContext,
} from "@/lib/capital";

export type CapitalStreamingQuote = {
  epic: string;
  bid: number;
  ask: number;
  timestamp: number;
};

type QuoteMessage = {
  status?: unknown;
  destination?: unknown;
  payload?: {
    epic?: unknown;
    bid?: unknown;
    ofr?: unknown;
    timestamp?: unknown;
  };
};

function connectUrl(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "wss:") return null;
    if (url.pathname === "" || url.pathname === "/") url.pathname = "/connect";
    return url.toString();
  } catch {
    return null;
  }
}

function safeStreamingLog(event: string, context: CapitalRequestContext) {
  console.error({
    requestId: context.requestId,
    step: "websocket",
    event,
    retryCount: context.retryCount,
    sessionRefreshHappened: context.sessionRefreshHappened,
  });
}

export async function getStreamingQuotes(
  epics: readonly string[],
  timeoutMs = 2500,
  context = createCapitalRequestContext(),
): Promise<Record<string, CapitalStreamingQuote>> {
  let session: Awaited<ReturnType<typeof getCapitalStreamingSession>>;
  try {
    session = await getCapitalStreamingSession(context);
  } catch {
    safeStreamingLog("session_unavailable", context);
    return {};
  }

  if (!session.streamEndpoint) {
    safeStreamingLog("stream_endpoint_unavailable", context);
    return {};
  }

  const url = connectUrl(session.streamEndpoint);
  if (!url) {
    safeStreamingLog("invalid_stream_endpoint", context);
    return {};
  }

  return new Promise((resolve) => {
    const quotes: Record<string, CapitalStreamingQuote> = {};
    const expected = new Set(epics);
    let settled = false;
    let socket: WebSocket;

    const finish = (terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (terminate) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      resolve(quotes);
    };

    const timeout = setTimeout(() => finish(true), timeoutMs);

    try {
      socket = new WebSocket(url);
    } catch {
      safeStreamingLog("connection_failed", context);
      clearTimeout(timeout);
      resolve(quotes);
      return;
    }

    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          destination: "marketData.subscribe",
          correlationId: "quotes-1",
          cst: session.cst,
          securityToken: session.securityToken,
          payload: { epics },
        }),
      );
    });

    socket.on("message", (raw: RawData) => {
      let message: QuoteMessage;
      try {
        message = JSON.parse(raw.toString()) as QuoteMessage;
      } catch {
        return;
      }

      const payload = message.payload;
      if (message.status !== "OK" || message.destination !== "quote" || !payload) return;
      if (
        typeof payload.epic !== "string" ||
        !expected.has(payload.epic) ||
        typeof payload.bid !== "number" ||
        !Number.isFinite(payload.bid) ||
        typeof payload.ofr !== "number" ||
        !Number.isFinite(payload.ofr) ||
        typeof payload.timestamp !== "number" ||
        !Number.isFinite(payload.timestamp)
      ) {
        return;
      }

      quotes[payload.epic] = {
        epic: payload.epic,
        bid: payload.bid,
        ask: payload.ofr,
        timestamp: payload.timestamp,
      };

      if (expected.size === Object.keys(quotes).length) finish();
    });

    socket.once("error", () => {
      safeStreamingLog("socket_error", context);
      finish(true);
    });

    socket.once("close", () => finish());
  });
}
