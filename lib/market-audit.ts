import { getCandles, HistoryError } from "@/lib/candles";
import { HISTORY, type CandleResponse, type Timeframe } from "@/lib/candle-data";
import { analysisParams } from "@/lib/analysis-http";
import { getAnalysisQuote } from "@/lib/analysis-quote";
import { ANALYSIS_TIMEFRAMES, analyzeSeries, targetMap } from "@/lib/technical-analysis";
import { checkConsistency } from "@/lib/analysis-consistency";
import { checkHistoryRequest, historyFailure, historyJson } from "@/lib/history-http";
import { buildHtfAudit } from "@/lib/htf-audit";
import { createAuditSnapshot, readAuditSnapshot } from './audit-snapshots';

export async function marketAudit(request: Request, dependencies = { getCandles, getAnalysisQuote }) {
  try {
    checkHistoryRequest(request);
    const url = new URL(request.url), { symbol, side, settings, selection } = analysisParams(url.searchParams);
    const existingSnapshot=readAuditSnapshot(url);
    if(existingSnapshot)return existingSnapshot;
    if(url.searchParams.has('page'))throw new HistoryError('SNAPSHOT_ID_REQUIRED','page requires snapshot_id',400);
    const includeCandles = url.searchParams.get("include_candles") ?? "0";
    const includeHtf = url.searchParams.get('htf') ?? '1';
    const view = url.searchParams.get('view') ?? 'full';
    if (!['full','priority','snapshot'].includes(view)) throw new HistoryError('INVALID_VIEW', 'view must be full, priority or snapshot', 400);
    if (includeHtf !== '0' && includeHtf !== '1') throw new HistoryError('INVALID_HTF', 'htf must be 0 or 1', 400);
    const rawEntry = url.searchParams.get('entry');
    if (rawEntry !== null && (!/^\d+(?:\.\d+)?$/.test(rawEntry) || !Number.isFinite(Number(rawEntry)) || Number(rawEntry) <= 0))
      throw new HistoryError('INVALID_ENTRY', 'entry must be a finite positive hypothetical price', 400);
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
    const completeHtf = includeHtf === '1' ? buildHtfAudit(symbol, side, data, analyses, quote, rawEntry === null ? undefined : Number(rawEntry)) : undefined;
    const fullUrl = new URL(url); fullUrl.searchParams.set('view','full');
    const snapshotUrl=new URL(url);snapshotUrl.searchParams.set('view','snapshot');
    const htf = completeHtf && view === 'priority' ? { engine:completeHtf.engine,version:completeHtf.version,asset:symbol,price_side:side,
      environment:completeHtf.environment,reference_price:completeHtf.reference_price,reference_fresh:completeHtf.reference_fresh,
      data_reliability:completeHtf.data_reliability,priority_zones:completeHtf.priority_zones,risk:completeHtf.risk,contact:completeHtf.contact,
      frame_snapshots:Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf=>[tf,data[tf].fetched_at])),
      scope:{...completeHtf.scope,view:'priority',full_catalog_url:fullUrl.href,full_snapshot_url:snapshotUrl.href,full_catalog_count:completeHtf.catalog.total,full_catalog_included:false},
    } : completeHtf;
    const body = { ok: true, schema_version: "2.1", symbol, provider: "Capital.com", environment: data.H4.environment,
      price_side: side, generated_at: new Date().toISOString(), quote,
      reliability: { fresh_tick_verified: quote.fresh, history_warnings_present: analyses.some(s => s.warnings.length > 0),
        cross_timeframe_consistency: consistency.status, session_coverage_verified: false },
      structure: Object.fromEntries(analyses.filter(s => !only || s.timeframe === only).map(s => [s.timeframe, { ...s,
        ...(includeCandles === "1" ? { candles: data[s.timeframe].candles } : {}),
        candles_url: new URL(`/api/candles?symbol=${symbol}&timeframe=${s.timeframe}`, url.origin).href,
        metadata: data[s.timeframe].metadata }])),
      response_scope: { structure_timeframes: only ? [only] : ANALYSIS_TIMEFRAMES, targets_timeframes: ANALYSIS_TIMEFRAMES, candles_included: includeCandles === "1", htf_timeframes: htf ? ANALYSIS_TIMEFRAMES : [], htf_requested: includeHtf === '1' },
      targets: { ...targets, reference_fresh: quote.fresh, interpretation: "Observed candidates, not an instruction to place TP; inspect warnings and intermediate H4 obstacles." },
      htf, consistency, charts: Object.fromEntries(ANALYSIS_TIMEFRAMES.map(timeframe => {
        const params = new URLSearchParams({ symbol, timeframe, side, min_remaining_units: String(settings.min_remaining_units), atr_fraction: String(settings.atr_fraction) });
        if (timeframe === "H4" && selection) { params.set("range_high", selection.high_id); params.set("range_low", selection.low_id); }
        return [timeframe, { url: new URL(`/api/chart?${params}`, url.origin).href, content_type: "image/png", snapshot: "independently_fetched_cached_history_check_chart_timestamp" }];
      })), warnings,
      interpretation: "Facts from available Capital.com history only. No BUY/SELL, EDGE or probability is generated. Forming pivots are provisional; swept fractals and immaterial FVGs are not eligible D1+ targets.",
    };
    if(view==='snapshot')return historyJson({ok:true,schema_version:'2.1',pagination:createAuditSnapshot(body,url)});
    if (Buffer.byteLength(JSON.stringify(body)) > 4_250_000) return historyJson({ ok: false,
      error: { code: 'ANALYSIS_RESPONSE_TOO_LARGE', message: 'No zones dropped. Download the exact full snapshot using pagination, or request view=priority.' },
      pagination:createAuditSnapshot(body,url),
      metadata: { zone_count: completeHtf?.catalog.total ?? 0, htf_included: !!htf, budget_bytes: 4_250_000 } }, 503);
    return historyJson(body);
  } catch (error) { return historyFailure(error); }
}
