import "server-only";
import { createHash } from "node:crypto";
import { CapitalApiError, PUBLIC_SYMBOLS, type PublicSymbol } from "@/lib/capital";
import { HistoryError } from "@/lib/candles";
import { WindowLimit } from "@/lib/history-cache";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";
import { RangeSelectionError } from "@/lib/technical-analysis";

const clients = new WindowLimit(60, 60_000);
const requests = new WindowLimit(240, 60_000);
export const HISTORY_HEADERS = { ...PUBLIC_NO_STORE_HEADERS, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Expose-Headers": "Retry-After" };

export function historyJson(body: unknown, status = 200, retryAfter = 0) {
  return Response.json(body, { status, headers: { ...HISTORY_HEADERS, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

export function checkHistoryRequest(request: Request) {
  const globalWait = requests.take("all");
  if (globalWait) throw new HistoryError("RATE_LIMIT", "Too many history requests", 429, globalWait);
  // Vercel overwrites x-vercel-forwarded-for. Never trust a client-supplied x-forwarded-for.
  const address = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") ?? "unknown" : "local";
  const key = createHash("sha256").update(address).digest("hex");
  const wait = clients.take(key);
  if (wait) throw new HistoryError("RATE_LIMIT", "Too many history requests", 429, wait);
}

export function historySymbol(params: URLSearchParams): PublicSymbol {
  const symbol = (params.get("symbol") ?? "NAS100").toUpperCase();
  if (!(PUBLIC_SYMBOLS as readonly string[]).includes(symbol)) throw new HistoryError("INVALID_SYMBOL", "Unsupported symbol; see /api/markets", 400);
  return symbol as PublicSymbol;
}

export function historyFailure(error: unknown) {
  if (error instanceof RangeSelectionError) return historyJson({ ok: false, provider: "Capital.com", error: { code: error.code, message: error.message } }, 400);
  if (error instanceof HistoryError) return historyJson({ ok: false, provider: "Capital.com", error: { code: error.code, message: error.message },
    ...(error.diagnostics ? { metadata: { diagnostics: error.diagnostics } } : {}),
  }, error.status, error.retryAfter);
  const code = error instanceof CapitalApiError ? error.code : "CAPITAL_UPSTREAM";
  const status = code === "CAPITAL_RATE_LIMIT" ? 429 : code === "CAPITAL_CONFIG" ? 503 : code === "CAPITAL_TIMEOUT" ? 504 : 502;
  const messages: Record<string, string> = {
    CAPITAL_CONFIG: "Capital.com is not configured", CAPITAL_AUTH: "Capital.com authentication unavailable",
    CAPITAL_RATE_LIMIT: "Capital.com rate limit reached", CAPITAL_TIMEOUT: "Capital.com request timed out",
    CAPITAL_INVALID_RESPONSE: "Capital.com returned invalid data",
  };
  return historyJson({ ok: false, provider: "Capital.com", error: { code, message: messages[code] ?? "Capital.com upstream unavailable" } }, status, status === 429 ? 60 : 0);
}

export function historyOptions() { return new Response(null, { status: 204, headers: HISTORY_HEADERS }); }
