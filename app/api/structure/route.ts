import { getCandles, HistoryError } from "@/lib/candles";
import { HISTORY, TIMEFRAMES, parseLimit, type Timeframe, type CandleResponse } from "@/lib/candle-data";
import { checkHistoryRequest, historyFailure, historyJson, historyOptions, historySymbol } from "@/lib/history-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    checkHistoryRequest(request);
    const params = new URL(request.url).searchParams;
    const symbol = historySymbol(params);
    // Opt-in preserves the latency, availability and JSON contract of older callers.
    const timeframes = TIMEFRAMES.filter(timeframe => timeframe !== "MN1" || params.has("mn1"));
    const limits = {} as Record<Timeframe, number>;
    for (const timeframe of timeframes) {
      try { limits[timeframe] = parseLimit(params.get(timeframe.toLowerCase()), HISTORY[timeframe].limit); }
      catch { throw new HistoryError("INVALID_LIMIT", `${timeframe.toLowerCase()} must be an integer from 1 to 1000`, 400); }
      if (timeframe === "MN1" && limits.MN1 > 60) throw new HistoryError("INVALID_LIMIT", "mn1 must be from 1 to 60", 400);
    }
    // Sequential loading caps each structure request to one active upstream request.
    // All-or-error: never imply a complete structure when a timeframe is unavailable.
    const series = {} as Record<Timeframe, CandleResponse>;
    for (const timeframe of timeframes) series[timeframe] = await getCandles(symbol, timeframe, limits[timeframe]);
    const { epic, provider, environment, price_side } = series.W1;
    return historyJson({
      ok: true, symbol, epic, provider, environment, price_side,
      fetched_at: Object.values(series).map(value => value.fetched_at).sort().at(-1),
      W1: series.W1.candles, D1: series.D1.candles, H4: series.H4.candles,
      ...(series.MN1 ? { MN1: series.MN1.candles } : {}),
      metadata: Object.fromEntries(timeframes.map(timeframe => [timeframe, {
        ...series[timeframe].metadata, fetched_at: series[timeframe].fetched_at,
      }])),
    });
  } catch (error) { return historyFailure(error); }
}

export const OPTIONS = historyOptions;
