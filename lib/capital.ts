import "server-only";
import { randomUUID } from "node:crypto";
import {
  fetchWithTimeoutRetry,
  isAuthenticationFailure,
  UpstreamFetchError,
  type RetryMetrics,
} from "@/lib/upstream-retry";

// THIS PROJECT IS MARKET-DATA ONLY.
// DO NOT ADD TRADING ENDPOINTS.

export const PUBLIC_SYMBOLS = [
  "NAS100",
  "JP225",
  "USDJPY",
  "EURUSD",
  "XAUUSD",
  "GER40",
  "EU50",
] as const;
export type PublicSymbol = (typeof PUBLIC_SYMBOLS)[number];
export type MarketMapping = { epic: string; name: string };

type CapitalConfig = {
  apiKey: string;
  identifier: string;
  password: string;
  baseUrl: string;
  scope: string;
};

type CapitalSession = {
  cst: string;
  securityToken: string;
  streamEndpoint: string | null;
  createdAt: number;
  lastUsedAt: number;
  scope: string;
};

type SearchMarket = {
  bid?: unknown;
  delayTime?: unknown;
  epic?: unknown;
  expiry?: unknown;
  high?: unknown;
  instrumentName?: unknown;
  instrumentType?: unknown;
  low?: unknown;
  marketStatus?: unknown;
  netChange?: unknown;
  offer?: unknown;
  percentageChange?: unknown;
  streamingPricesAvailable?: unknown;
  symbol?: unknown;
  updateTimeUTC?: unknown;
};

export type CapitalMarketSummary = SearchMarket;

type MarketTarget = {
  instrumentType: "INDICES" | "CURRENCIES" | "COMMODITIES";
  searchTerms: readonly string[];
  aliases: readonly string[];
};

export type CapitalSnapshot = {
  instrument?: { epic?: unknown; name?: unknown };
  snapshot?: {
    bid?: unknown;
    high?: unknown;
    low?: unknown;
    marketStatus?: unknown;
    netChange?: unknown;
    offer?: unknown;
    percentageChange?: unknown;
    updateTimeUTC?: unknown;
  };
};

const DEFAULT_BASE_URL = "https://demo-api-capital.backend-capital.com";
const SESSION_IDLE_LIMIT_MS = 9 * 60 * 1000;
const GET_REQUEST_INTERVAL_MS = 110;
const SESSION_TIMEOUT_MS = 5000;
const MARKET_TIMEOUT_MS = 2500;

const TARGETS: Record<PublicSymbol, MarketTarget> = {
  NAS100: {
    instrumentType: "INDICES",
    searchTerms: ["US Tech 100", "US100", "Nasdaq"],
    aliases: ["US Tech 100", "US100", "Nasdaq", "Nasdaq 100", "NAS100"],
  },
  JP225: {
    instrumentType: "INDICES",
    searchTerms: ["Japan 225", "JP225", "Nikkei"],
    aliases: ["Japan 225", "JP225", "Nikkei", "Nikkei 225"],
  },
  USDJPY: {
    instrumentType: "CURRENCIES",
    searchTerms: ["USD/JPY", "USDJPY"],
    aliases: ["USD/JPY", "USDJPY"],
  },
  EURUSD: {
    instrumentType: "CURRENCIES",
    searchTerms: ["EUR/USD", "EURUSD"],
    aliases: ["EUR/USD", "EURUSD"],
  },
  XAUUSD: {
    instrumentType: "COMMODITIES",
    searchTerms: ["Gold", "XAUUSD"],
    aliases: ["Gold", "XAUUSD"],
  },
  GER40: {
    instrumentType: "INDICES",
    searchTerms: ["Germany 40", "GER40", "DAX", "Germany"],
    aliases: ["Germany 40", "GER40", "DAX", "DAX 40"],
  },
  EU50: {
    instrumentType: "INDICES",
    searchTerms: ["Europe 50", "EU50", "Euro Stoxx 50", "Euro Stoxx"],
    aliases: ["Europe 50", "EU50", "Euro Stoxx 50", "Euro Stoxx"],
  },
};

let cachedSession: CapitalSession | null = null;
let sessionRequest: Promise<CapitalSession> | null = null;
let cacheScope: string | null = null;
const marketCache: Partial<Record<PublicSymbol, MarketMapping>> = {};
const marketRequests: Partial<Record<PublicSymbol, Promise<MarketMapping>>> = {};
let getRequestQueue: Promise<void> = Promise.resolve();
let nextGetRequestAt = 0;

type CapitalRequestStep = "authentication" | "markets_batch" | "single_market";

export type CapitalErrorCode =
  | "CAPITAL_AUTH"
  | "CAPITAL_CONFIG"
  | "CAPITAL_INVALID_RESPONSE"
  | "CAPITAL_RATE_LIMIT"
  | "CAPITAL_TIMEOUT"
  | "CAPITAL_UPSTREAM";

export type CapitalRequestContext = RetryMetrics & {
  requestId: string;
  sessionRefreshHappened: boolean;
};

export function createCapitalRequestContext(requestId = randomUUID()): CapitalRequestContext {
  return { requestId, retryCount: 0, sessionRefreshHappened: false };
}

export class CapitalApiError extends Error {
  constructor(
    public readonly code: CapitalErrorCode,
    message: string,
    public readonly step: CapitalRequestStep,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "CapitalApiError";
  }
}

function logCapitalError(
  step: CapitalRequestStep,
  context: CapitalRequestContext,
  details: {
    status?: number | null;
    statusText?: string | null;
    capitalErrorCode?: string | null;
  },
) {
  console.error({
    requestId: context.requestId,
    step,
    status: details.status ?? null,
    statusText: details.statusText ?? null,
    capitalErrorCode: details.capitalErrorCode ?? null,
    retryCount: context.retryCount,
    sessionRefreshHappened: context.sessionRefreshHappened,
  });
}

function config(): CapitalConfig {
  const apiKey = process.env.CAPITAL_API_KEY?.trim();
  const identifier = process.env.CAPITAL_IDENTIFIER?.trim();
  const password = process.env.CAPITAL_API_PASSWORD;
  const rawBaseUrl = process.env.CAPITAL_API_BASE_URL?.trim() || DEFAULT_BASE_URL;

  if (!apiKey || !identifier || !password) {
    throw new CapitalApiError(
      "CAPITAL_CONFIG",
      "Capital.com is not configured",
      "authentication",
    );
  }

  let baseUrl: string;
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    throw new CapitalApiError(
      "CAPITAL_CONFIG",
      "Capital.com base URL is invalid",
      "authentication",
    );
  }

  return {
    apiKey,
    identifier,
    password,
    baseUrl,
    scope: `${baseUrl}\n${identifier}\n${apiKey}`,
  };
}

function resetScopedCaches(scope: string) {
  if (cacheScope === scope) return;
  cachedSession = null;
  sessionRequest = null;
  for (const symbol of PUBLIC_SYMBOLS) {
    delete marketCache[symbol];
    delete marketRequests[symbol];
  }
  cacheScope = scope;
}

async function createSession(
  settings: CapitalConfig,
  context: CapitalRequestContext,
): Promise<CapitalSession> {
  let response: Response;
  try {
    response = await fetchWithTimeoutRetry(
      `${settings.baseUrl}/api/v1/session`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CAP-API-KEY": settings.apiKey,
        },
        body: JSON.stringify({
          identifier: settings.identifier,
          password: settings.password,
          encryptedPassword: false,
        }),
      },
      {
        timeoutMs: SESSION_TIMEOUT_MS,
        maxAttempts: 3,
        baseDelayMs: 1000,
        metrics: context,
        onFailure: ({ status, statusText, timedOut }) =>
          logCapitalError("authentication", context, {
            status,
            statusText: timedOut ? "Request timed out" : statusText,
          }),
      },
    );
  } catch (error) {
    const code =
      error instanceof UpstreamFetchError && error.code === "TIMEOUT"
        ? "CAPITAL_TIMEOUT"
        : "CAPITAL_UPSTREAM";
    logCapitalError("authentication", context, {
      statusText: code === "CAPITAL_TIMEOUT" ? "Request timed out" : "Network error",
    });
    throw new CapitalApiError(code, (error as Error).message, "authentication");
  }

  const cst = response.headers.get("CST");
  const securityToken = response.headers.get("X-SECURITY-TOKEN");
  if (!response.ok || !cst || !securityToken) {
    const code = response.ok ? "missing-session-token" : await errorCode(response);
    logCapitalError("authentication", context, {
      status: response.status,
      statusText: response.statusText,
      capitalErrorCode: code,
    });
    const failureCode =
      response.status === 429
        ? "CAPITAL_RATE_LIMIT"
        : response.status >= 500
          ? "CAPITAL_UPSTREAM"
          : "CAPITAL_AUTH";
    throw new CapitalApiError(
      failureCode,
      "Capital.com authentication failed",
      "authentication",
      response.status,
    );
  }

  let streamEndpoint: string | null = null;
  try {
    const body = (await response.json()) as {
      streamEndpoint?: unknown;
      streamingHost?: unknown;
    };
    const endpoint = body.streamEndpoint ?? body.streamingHost;
    if (typeof endpoint === "string" && endpoint.startsWith("wss://")) {
      streamEndpoint = endpoint;
    }
  } catch {
    // REST remains fully functional when streaming metadata is unavailable.
  }

  const now = Date.now();
  return {
    cst,
    securityToken,
    streamEndpoint,
    createdAt: now,
    lastUsedAt: now,
    scope: settings.scope,
  };
}

export async function ensureCapitalSession(
  context = createCapitalRequestContext(),
): Promise<void> {
  await getSession(context);
}

export async function getCapitalStreamingSession(
  context = createCapitalRequestContext(),
): Promise<{
  cst: string;
  securityToken: string;
  streamEndpoint: string | null;
}> {
  const session = await getSession(context);
  return {
    cst: session.cst,
    securityToken: session.securityToken,
    streamEndpoint: session.streamEndpoint,
  };
}

export function capitalSessionStatus(): "ready" | "not_ready" {
  return cachedSession && Date.now() - cachedSession.lastUsedAt < SESSION_IDLE_LIMIT_MS
    ? "ready"
    : "not_ready";
}

async function getSession(context: CapitalRequestContext): Promise<CapitalSession> {
  const settings = config();
  resetScopedCaches(settings.scope);

  if (
    cachedSession?.scope === settings.scope &&
    Date.now() - cachedSession.lastUsedAt < SESSION_IDLE_LIMIT_MS
  ) {
    return cachedSession;
  }

  if (!sessionRequest) {
    context.sessionRefreshHappened = true;
    sessionRequest = createSession(settings, context)
      .then((session) => {
        cachedSession = session;
        return session;
      })
      .finally(() => {
        sessionRequest = null;
      });
  }

  if (!cachedSession) context.sessionRefreshHappened = true;

  return sessionRequest;
}

function invalidateSession(session: CapitalSession) {
  if (cachedSession === session) cachedSession = null;
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errorCode?: unknown };
    return typeof body.errorCode === "string" ? body.errorCode.toLowerCase() : "";
  } catch {
    return "";
  }
}

async function waitForGetRequestSlot(): Promise<void> {
  const scheduled = getRequestQueue.then(async () => {
    const waitMs = Math.max(0, nextGetRequestAt - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    nextGetRequestAt = Date.now() + GET_REQUEST_INTERVAL_MS;
  });
  getRequestQueue = scheduled.catch(() => undefined);
  await scheduled;
}

async function capitalGet(
  path: string,
  step: CapitalRequestStep,
  context: CapitalRequestContext,
): Promise<unknown> {
  const settings = config();

  for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
    const session = await getSession(context);
    let response: Response;
    try {
      response = await fetchWithTimeoutRetry(
        `${settings.baseUrl}${path}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            CST: session.cst,
            "X-SECURITY-TOKEN": session.securityToken,
          },
        },
        {
          timeoutMs: MARKET_TIMEOUT_MS,
          maxAttempts: 3,
          metrics: context,
          beforeAttempt: waitForGetRequestSlot,
          onFailure: ({ status, statusText, timedOut }) =>
            logCapitalError(step, context, {
              status,
              statusText: timedOut ? "Request timed out" : statusText,
            }),
        },
      );
    } catch (error) {
      const code =
        error instanceof UpstreamFetchError && error.code === "TIMEOUT"
          ? "CAPITAL_TIMEOUT"
          : "CAPITAL_UPSTREAM";
      logCapitalError(step, context, {
        statusText: code === "CAPITAL_TIMEOUT" ? "Request timed out" : "Network error",
      });
      throw new CapitalApiError(code, (error as Error).message, step);
    }

    if (response.ok) {
      session.lastUsedAt = Date.now();
      try {
        return await response.json();
      } catch {
        logCapitalError(step, context, {
          status: response.status,
          statusText: response.statusText,
        });
        throw new CapitalApiError(
          "CAPITAL_INVALID_RESPONSE",
          "Capital.com returned invalid JSON",
          step,
          response.status,
        );
      }
    }

    const code = await errorCode(response);
    logCapitalError(step, context, {
      status: response.status,
      statusText: response.statusText,
      capitalErrorCode: code,
    });
    if (authAttempt === 0 && isAuthenticationFailure(response.status, code)) {
      invalidateSession(session);
      context.retryCount += 1;
      continue;
    }

    const failureCode =
      response.status === 429
        ? "CAPITAL_RATE_LIMIT"
        : response.status >= 500
          ? "CAPITAL_UPSTREAM"
          : isAuthenticationFailure(response.status, code)
            ? "CAPITAL_AUTH"
            : "CAPITAL_UPSTREAM";
    throw new CapitalApiError(
      failureCode,
      "Capital.com request was rejected",
      step,
      response.status,
    );
  }

  throw new CapitalApiError("CAPITAL_AUTH", "Capital.com session refresh failed", step);
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function candidateScore(candidate: SearchMarket, target: MarketTarget, term: string): number {
  if (candidate.instrumentType !== target.instrumentType || typeof candidate.epic !== "string") {
    return -1;
  }

  const fields = [candidate.epic, candidate.symbol, candidate.instrumentName]
    .map(normalized)
    .filter(Boolean);
  const aliases = target.aliases.map(normalized);
  const normalizedTerm = normalized(term);
  let score = 100;

  for (const field of fields) {
    if (aliases.includes(field)) score += 100;
    else if (aliases.some((alias) => alias.length >= 4 && field.includes(alias))) score += 40;

    if (field === normalizedTerm) score += 80;
    else if (normalizedTerm.length >= 4 && field.includes(normalizedTerm)) score += 30;
  }

  if (candidate.expiry === "-") score += 5;
  return score;
}

async function discoverMarket(
  symbol: PublicSymbol,
  context: CapitalRequestContext,
): Promise<MarketMapping> {
  const target = TARGETS[symbol];

  for (const term of target.searchTerms) {
    const query = new URLSearchParams({ searchTerm: term });
    const payload = (await capitalGet(
      `/api/v1/markets?${query}`,
      "single_market",
      context,
    )) as { markets?: unknown };
    if (!Array.isArray(payload.markets)) continue;

    const ranked = payload.markets
      .filter((market): market is SearchMarket => Boolean(market) && typeof market === "object")
      .map((market) => ({ market, score: candidateScore(market, target, term) }))
      .filter(({ score }) => score >= 180)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.market;

    if (typeof best?.epic === "string") {
      const name =
        typeof best.instrumentName === "string"
          ? best.instrumentName
          : typeof best.symbol === "string"
            ? best.symbol
            : symbol;
      return { epic: best.epic, name };
    }
  }

  throw new CapitalApiError(
    "CAPITAL_INVALID_RESPONSE",
    `Capital.com market not found: ${symbol}`,
    "single_market",
  );
}

export async function resolveMarket(
  symbol: PublicSymbol,
  context = createCapitalRequestContext(),
): Promise<MarketMapping> {
  const settings = config();
  resetScopedCaches(settings.scope);
  if (marketCache[symbol]) return marketCache[symbol];

  if (!marketRequests[symbol]) {
    marketRequests[symbol] = discoverMarket(symbol, context)
      .then((mapping) => {
        marketCache[symbol] = mapping;
        return mapping;
      })
      .finally(() => {
        delete marketRequests[symbol];
      });
  }

  return marketRequests[symbol];
}

export async function resolveAllMarkets(
  context = createCapitalRequestContext(),
): Promise<Record<PublicSymbol, MarketMapping | null>> {
  const result = {} as Record<PublicSymbol, MarketMapping | null>;

  // Sequential discovery avoids bursting through Capital.com's request limit.
  for (const symbol of PUBLIC_SYMBOLS) {
    try {
      result[symbol] = await resolveMarket(symbol, context);
    } catch {
      result[symbol] = null;
    }
  }

  return result;
}

export async function getMarketSnapshot(
  epic: string,
  context = createCapitalRequestContext(),
): Promise<CapitalSnapshot> {
  const encodedEpic = encodeURIComponent(epic);
  const payload = await capitalGet(
    `/api/v1/markets/${encodedEpic}`,
    "single_market",
    context,
  );
  if (!payload || typeof payload !== "object") {
    logCapitalError("single_market", context, {
      status: 200,
      statusText: "Invalid response schema",
    });
    throw new CapitalApiError(
      "CAPITAL_INVALID_RESPONSE",
      "Capital.com market response is invalid",
      "single_market",
      200,
    );
  }
  return payload as CapitalSnapshot;
}

export async function getMarketSummaries(
  epics: readonly string[],
  context = createCapitalRequestContext(),
): Promise<Record<string, CapitalMarketSummary>> {
  const query = new URLSearchParams({ epics: epics.join(",") });
  const payload = (await capitalGet(
    `/api/v1/markets?${query}`,
    "markets_batch",
    context,
  )) as { markets?: unknown };
  if (!Array.isArray(payload.markets)) {
    logCapitalError("markets_batch", context, {
      status: 200,
      statusText: "Invalid response schema",
    });
    throw new CapitalApiError(
      "CAPITAL_INVALID_RESPONSE",
      "Capital.com markets response is invalid",
      "markets_batch",
      200,
    );
  }

  const summaries: Record<string, CapitalMarketSummary> = {};
  for (const market of payload.markets) {
    if (!market || typeof market !== "object") continue;
    const summary = market as CapitalMarketSummary;
    if (typeof summary.epic === "string") summaries[summary.epic] = summary;
  }
  return summaries;
}

export function capitalEnvironment(): "demo" | "live" {
  const hostname = new URL(config().baseUrl).hostname;
  return hostname.startsWith("demo-") ? "demo" : "live";
}
