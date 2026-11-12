import { quoteAt } from "@/lib/quote-at";
import { providerTime } from "@/lib/tick-data";
import { HistoryError } from "@/lib/candles";
import { checkHistoryRequest, historyFailure, historyJson, historyOptions, historySymbol } from "@/lib/history-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    checkHistoryRequest(request);
    const params = new URL(request.url).searchParams;
    const symbol = historySymbol(params);
    const raw = params.get("at");
    const at = providerTime(raw);
    if (!at || !raw?.endsWith("Z") || Date.parse(at) > Date.now()) throw new HistoryError("INVALID_AT", "at must be a non-future ISO 8601 UTC timestamp ending in Z", 400);
    return historyJson(await quoteAt(symbol, at));
  } catch (error) { return historyFailure(error); }
}
export const OPTIONS = historyOptions;
