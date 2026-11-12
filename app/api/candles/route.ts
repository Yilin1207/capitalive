import { getCandles, HistoryError } from "@/lib/candles";
import { HISTORY, TIMEFRAMES, parseLimit, type Timeframe } from "@/lib/candle-data";
import { checkHistoryRequest, historyFailure, historyJson, historyOptions, historySymbol } from "@/lib/history-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    checkHistoryRequest(request);
    const params = new URL(request.url).searchParams;
    const symbol = historySymbol(params);
    const timeframe = (params.get("timeframe") ?? "H4").toUpperCase() as Timeframe;
    if (!TIMEFRAMES.includes(timeframe)) throw new HistoryError("INVALID_TIMEFRAME", "Supported timeframes: MN1, W1, D1, H4", 400);
    let limit: number;
    try { limit = parseLimit(params.get("limit"), HISTORY[timeframe].limit); }
    catch { throw new HistoryError("INVALID_LIMIT", "limit must be an integer from 1 to 1000", 400); }
    return historyJson(await getCandles(symbol, timeframe, limit));
  } catch (error) { return historyFailure(error); }
}

export const OPTIONS = historyOptions;
