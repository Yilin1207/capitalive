import "server-only";
import { getCandles, HistoryError } from "../candles";
import { getAnalysisQuote } from "../analysis-quote";
import { analysisParams } from "../analysis-http";
import {
  checkHistoryRequest,
  historyJson,
  historyFailure,
} from "../history-http";
import { HISTORY, type CandleResponse, type Timeframe } from "../candle-data";
import { buildIntelligence } from "./intelligence";
import { TF_ORDER } from "./detectors";
export async function intelligenceHttp(
  request: Request,
  dependencies = { getCandles, getAnalysisQuote },
) {
  try {
    checkHistoryRequest(request);
    const params = new URL(request.url).searchParams;
    const { symbol, side } = analysisParams(
      new URLSearchParams({
        symbol: params.get("symbol") ?? "NAS100",
        side: params.get("side") ?? "bid",
      }),
    );
    const high = params.get("high_id"),
      low = params.get("low_id");
    const target = params.get("target_id");
    if(target !== null && (!target || target.length > 500))
      throw new HistoryError("INVALID_TARGET_SELECTION", "target_id must contain 1–500 characters", 400);
    if (
      (high !== null || low !== null) &&
      (!high || !low || high.length > 500 || low.length > 500)
    )
      throw new HistoryError(
        "INVALID_RANGE_SELECTION",
        "Both high_id and low_id are required",
        400,
      );
    const data = {} as Record<Timeframe, CandleResponse>;
    for (const tf of TF_ORDER)
      data[tf] = await dependencies.getCandles(symbol, tf, HISTORY[tf].limit);
    const quote = await dependencies.getAnalysisQuote(symbol),
      body = buildIntelligence(data, side, quote, {
        ...(target ? {target_id:target} : {}),
        ...(high && low
          ? { ranges: { H4: { high_id: high, low_id: low } } }
          : {}),
      });
    if (high && body.frames.find((f) => f.timeframe === "H4")?.range_blocker)
      throw new HistoryError(
        "INVALID_RANGE_SELECTION",
        "IDs must identify valid closed H4 knowledge pivots on the selected price side",
        400,
      );
    if (Buffer.byteLength(JSON.stringify(body)) > 4_250_000)
      throw new HistoryError(
        "INTELLIGENCE_RESPONSE_TOO_LARGE",
        "No evidence was dropped; use a smaller local dataset for complete offline analysis",
        503,
      );
    return historyJson(body);
  } catch (error) {
    return historyFailure(error);
  }
}
