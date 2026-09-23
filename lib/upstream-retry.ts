export type UpstreamFailureCode = "TIMEOUT" | "NETWORK";

export class UpstreamFetchError extends Error {
  public readonly code: UpstreamFailureCode;

  constructor(
    code: UpstreamFailureCode,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "UpstreamFetchError";
  }
}

export type RetryMetrics = { retryCount: number };

type RetryOptions = {
  timeoutMs: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  metrics?: RetryMetrics;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  beforeAttempt?: () => Promise<void>;
  onFailure?: (details: {
    attempt: number;
    status: number | null;
    statusText: string | null;
    timedOut: boolean;
  }) => void;
};

export function isAuthenticationFailure(status: number, code: string): boolean {
  const normalized = code.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    normalized.includes("token") ||
    normalized.includes("session") ||
    normalized.includes("auth")
  );
}

export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchWithTimeoutRetry(
  input: string | URL,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 150;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleepImpl ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastNetworkError: UpstreamFetchError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await options.beforeAttempt?.();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (!isTransientStatus(response.status) || attempt === maxAttempts) return response;
      await response.body?.cancel().catch(() => undefined);
      options.onFailure?.({
        attempt,
        status: response.status,
        statusText: response.statusText,
        timedOut: false,
      });
    } catch {
      clearTimeout(timeout);
      const timedOut = controller.signal.aborted;
      lastNetworkError = new UpstreamFetchError(
        timedOut ? "TIMEOUT" : "NETWORK",
        timedOut ? "Capital.com request timed out" : "Capital.com network request failed",
      );
      options.onFailure?.({
        attempt,
        status: null,
        statusText: null,
        timedOut,
      });
      if (attempt === maxAttempts) throw lastNetworkError;
    }

    if (options.metrics) options.metrics.retryCount += 1;
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }

  throw lastNetworkError ?? new UpstreamFetchError("NETWORK", "Capital.com request failed");
}
