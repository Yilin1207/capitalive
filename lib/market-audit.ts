import { getCandles, HistoryError } from "@/lib/candles";
import { HISTORY, type CandleResponse, type Timeframe } from "@/lib/candle-data";
import { analysisParams } from "@/lib/analysis-http";
import { getAnalysisQuote } from "@/lib/analysis-quote";
import { ANALYSIS_TIMEFRAMES, analyzeSeries, targetMap } from "@/lib/technical-analysis";
import { checkConsistency } from "@/lib/analysis-consistency";
import { checkHistoryRequest, historyFailure, historyJson } from "@/lib/history-http";

export async function marketAudit(request: Request, dependencies = { getCandles, getAnalysisQuote }) {
  try {
    checkHistoryRequest(request);
    const url = new URL(request.url), { symbol, side, settings, selection } = analysisParams(url.searchParams);
    const includeCandles = url.searchParams.get("include_candles") ?? "0";
    if (includeCandles !== "0" && includeCandles !== "1") throw new HistoryError("INVALID_INCLUDE_CANDLES", "include_candles must be 0 or 1", 400);
    const only = url.searchParams.get("timeframe")?.toUpperCase() as Timeframe | undefined;
    if (only !== undefined && !ANALYSIS_TIMEFRAMES.includes(only)) throw new HistoryError("INVALID_TIMEFRAME", "Supported timeframes: MN1, W1, D1, H4", 400);
    if (selection && only && only !== "H4") throw new HistoryError("INVALID_RANGE_SELECTION", "Explicit range selection requires H4 or the full audit", 400);
    const data = {} as Record<Timeframe, CandleResponse>;
    for (const timeframe of ANALYSIS_TIMEFRAMES) data[timeframe] = await dependencies.getCandles(symbol, timeframe, HISTORY[timeframe].limit);
    // Retrieve the quote after history so its age is measured at the point of analysis.
    const quote = await dependencies.getAnalysisQuote(symbol);
    const price = quote[side];
    const analyses = ANALYSIS_TIMEFRAMES.map(tf => analyzeSeries(data[tf], symbol, side, settings, price, tf === "H4" ? selection : undefined));
    const consistency = checkConsistency(data, side);
    const warnings = analyses.flatMap(s => s.warnings.map(code => ({ timeframe: s.timeframe as Timeframe | null, code })));
    if (!quote.fresh) warnings.push({ timeframe: null, code: "NO_VERIFIED_FRESH_TICK_REDUCED_RELIABILITY" });
    if (!quote.actionable_live) warnings.push({ timeframe: null, code: "MARKET_NOT_VERIFIED_TRADEABLE_WITH_FRESH_QUOTE" });
    if (consistency.status === "mismatch") warnings.push({ timeframe: null, code: "CROSS_TIMEFRAME_CONTRADICTION" });
    const targets = targetMap(analyses, price);
    return historyJson({ ok: true, schema_version: "2.0", symbol, provider: "Capital.com", environment: data.H4.environment,
      price_side: side, generated_at: new Date().toISOString(), quote,
      reliability: { fresh_tick_verified: quote.fresh, history_warnings_present: analyses.some(s => s.warnings.length > 0),
        cross_timeframe_consistency: consistency.status, session_coverage_verified: false },
      structure: Object.fromEntries(analyses.filter(s => !only || s.timeframe === only).map(s => [s.timeframe, { ...s,
        ...(includeCandles === "1" ? { candles: data[s.timeframe].candles } : {}),
        candles_url: new URL(`/api/candles?symbol=${symbol}&timeframe=${s.timeframe}`, url.origin).href,
        metadata: data[s.timeframe].metadata }])),
      response_scope: { structure_timeframes: only ? [only] : ANALYSIS_TIMEFRAMES, targets_timeframes: ANALYSIS_TIMEFRAMES, candles_included: includeCandles === "1" },
      targets: { ...targets, reference_fresh: quote.fresh, interpretation: "Observed candidates, not an instruction to place TP; inspect warnings and intermediate H4 obstacles." },
      consistency, charts: Object.fromEntries(ANALYSIS_TIMEFRAMES.map(timeframe => {
        const params = new URLSearchParams({ symbol, timeframe, side, min_remaining_units: String(settings.min_remaining_units), atr_fraction: String(settings.atr_fraction) });
        if (timeframe === "H4" && selection) { params.set("range_high", selection.high_id); params.set("range_low", selection.low_id); }
        return [timeframe, { url: new URL(`/api/chart?${params}`, url.origin).href, content_type: "image/png", snapshot: "independently_fetched_cached_history_check_chart_timestamp" }];
      })), warnings,
      interpretation: "Facts from available Capital.com history only. No BUY/SELL, EDGE or probability is generated. Forming pivots are provisional; swept fractals and immaterial FVGs are not eligible D1+ targets.",
    });
  } catch (error) { return historyFailure(error); }
}
