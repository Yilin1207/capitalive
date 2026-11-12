import { chartPng } from "@/lib/chart-png";
import { createHash } from "node:crypto";
import { getCandles, HistoryError } from "@/lib/candles";
import { HISTORY, TIMEFRAMES, type Timeframe, type CandleResponse } from "@/lib/candle-data";
import { analysisParams } from "@/lib/analysis-http";
import { analyzeSeries } from "@/lib/technical-analysis";
import { chartSvg, DEFAULT_LAYERS, SNR_LAYER } from "@/lib/chart-svg";
import { chartHtf } from '@/lib/chart-htf';
import { HistoryCache } from "@/lib/history-cache";
import { checkHistoryRequest, historyFailure, HISTORY_HEADERS } from "@/lib/history-http";




const images = new HistoryCache<Buffer>(30_000, 24);
let renders = 0;

export async function chartResponse(request: Request, dependencies = { getCandles }) {
  try {
    checkHistoryRequest(request);
    const params = new URL(request.url).searchParams, { symbol, side, settings, selection } = analysisParams(params);
    const timeframe = (params.get("timeframe") ?? "H4").toUpperCase() as Timeframe;
    if (!TIMEFRAMES.includes(timeframe)) throw new HistoryError("INVALID_TIMEFRAME", "Supported timeframes: MN1, W1, D1, H4", 400);
    if (selection && timeframe !== "H4") throw new HistoryError("INVALID_RANGE_SELECTION", "Explicit range selection is supported only for H4", 400);
    const barsRaw = params.get("bars") ?? "120";
    if (!/^\d+$/.test(barsRaw) || Number(barsRaw) < 20 || Number(barsRaw) > 240) throw new HistoryError("INVALID_BARS", "bars must be an integer from 20 to 240", 400);
    const layers = { ...DEFAULT_LAYERS };
    for (const layer of Object.keys(layers) as (keyof typeof layers)[]) {
      const value = params.get(layer);
      if (value !== null && value !== "0" && value !== "1") throw new HistoryError("INVALID_LAYER", `${layer} must be 0 or 1`, 400);
      if (value !== null) layers[layer] = value === "1";
    }
    const data = await dependencies.getCandles(symbol, timeframe, HISTORY[timeframe].limit);
    if (!data.candles.some(c => [c.open[side], c.high[side], c.low[side], c.close[side]].every(p => p !== null)))
      throw new HistoryError("CHART_SIDE_UNAVAILABLE", "No valid OHLC for selected side", 404);
    const frames:Partial<Record<Timeframe,CandleResponse>>={[timeframe]:data};
    const snrEnabled=Object.values(SNR_LAYER).some(key=>layers[key]);
    if(snrEnabled) for(const tf of ['MN1','W1','D1','H4'] as const) if(!frames[tf]) frames[tf]=await dependencies.getCandles(symbol,tf,HISTORY[tf].limit);
    const overlay=snrEnabled?chartHtf(frames,symbol,side,data.candles.at(-1)?.close[side]??null):undefined;
    const svg = chartSvg(data, analyzeSeries(data, symbol, side, settings, undefined, selection), symbol, side, layers, Number(barsRaw),overlay);
    const key = createHash("sha256").update(svg).digest("hex");
    const { value } = await images.get(key, async () => {
      if (renders >= 2) throw new HistoryError("CHART_BUSY", "Chart renderer busy; retry shortly", 429, 5);
      renders++;
      try { return chartPng(svg); }
      finally { renders--; }
    });
    return new Response(new Uint8Array(value), { headers: { ...HISTORY_HEADERS, "Content-Type": "image/png", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${symbol}-${timeframe}-${side}.png"`, "X-Candle-Fetched-At": data.fetched_at } });
  } catch (error) { return historyFailure(error); }
}
