import type { CandleResponse, PriceSide, Timeframe } from './candle-data';
import type { MarketQuote } from './quote-normalization';
import { ANALYSIS_TIMEFRAMES, type AnalysisSymbol, type SeriesAnalysis } from './technical-analysis';
import { detectIndependentSNR } from './htf-snr';
import { analyzeHtfStructure } from './htf-structure';
import { buildCompleteZoneCatalog, calculateStructuralRisk } from './htf-zone-catalog';
import { checkConsistency } from './analysis-consistency';

export function buildHtfAudit(asset: AnalysisSymbol, side: PriceSide, data: Record<Timeframe, CandleResponse>, analyses: SeriesAnalysis[], quote: MarketQuote, entry?: number) {
  const price = quote[side];
  const snr = Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf => [tf, detectIndependentSNR(data[tf], asset, side, price)])) as Record<Timeframe, ReturnType<typeof detectIndependentSNR>>;
  const structure = Object.fromEntries(analyses.map(s => [s.timeframe, analyzeHtfStructure(data[s.timeframe], s, side)])) as Record<Timeframe, ReturnType<typeof analyzeHtfStructure>>;
  const catalog = buildCompleteZoneCatalog(asset, snr, analyses, structure, price);
  const consistency = checkConsistency(data, side);
  const reasons = [...new Set(Object.values(snr).flatMap(s => s.data_reliability.reasons))];
  const validSpread = quote.bid !== null && quote.ask !== null && Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.bid > 0 && quote.ask >= quote.bid;
  if (!validSpread) reasons.push('QUOTE_SIDES_OR_SPREAD_UNVERIFIED');
  if (!quote.fresh) reasons.push('QUOTE_NOT_VERIFIED_FRESH');
  if (consistency.status === 'mismatch') reasons.push('CROSS_TIMEFRAME_CONTRADICTION');
  if (consistency.status === 'not_checkable') reasons.push('CROSS_TIMEFRAME_NOT_CHECKABLE');
  const unverified = !validSpread || Object.values(snr).some(s => s.data_reliability.status === 'UNVERIFIED') || consistency.status === 'mismatch';
  const reliability = { status: unverified ? 'UNVERIFIED' : reasons.length ? 'PARTIAL' : 'VERIFIED', reasons,
    checks: { bid_ask_spread: validSpread ? 'VERIFIED' : 'UNVERIFIED', tick_timestamp: quote.fresh ? 'VERIFIED' : 'UNVERIFIED',
      session_coverage: 'UNVERIFIED', environment: data.H4.environment, cross_timeframe: consistency.status },
    interpretation: 'VERIFIED applies only to listed checks, not complete history, profitability, or equivalence of DEMO and LIVE' };
  return { engine: 'capitalive-2.1-htf', version: '2.1', asset, price_side: side, environment: data.H4.environment, reference_price: price,
    reference_fresh: quote.fresh, data_reliability: reliability, snr, structure, catalog,
    risk: { ...calculateStructuralRisk(analyses, catalog, entry ?? price), entry_source: entry === undefined ? 'selected_quote_side' : 'user_hypothesis_unverified',
      reference_fresh: entry === undefined ? quote.fresh : false, data_reliability: reliability },
    scope: { timeframes: ANALYSIS_TIMEFRAMES, loaded_history_only: true, omitted_zones: 0, source: 'same_snapshot_as_market_audit', no_synthetic_candles: true } };
}
