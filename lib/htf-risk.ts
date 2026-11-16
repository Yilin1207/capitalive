import type { CandleResponse, PriceSide, Timeframe } from './candle-data';
import type { AnalysisSettings, AnalysisSymbol, SeriesAnalysis } from './technical-analysis';
import type { MarketQuote } from './quote-normalization';
import type { buildCompleteZoneCatalog } from './htf-zone-catalog';
import type { classifyObstacles } from './htf-obstacles';
export type RiskContext = { data: Record<Timeframe,CandleResponse>; asset: AnalysisSymbol; quote: MarketQuote; side: PriceSide; settings?: Partial<AnalysisSettings> };
/** Compatibility only. Unsupported protected-swing SL/TP and spread-shifted historical obstacle rules are removed. */
export function calculateStructuralRisk(analyses: SeriesAnalysis[], catalog: ReturnType<typeof buildCompleteZoneCatalog>, entry: number | null, context?: RiskContext) {
  void analyses; void catalog;
  const q=context?.quote;
  const spread=q && q.bid!==null && q.ask!==null && Number.isFinite(q.bid) && Number.isFinite(q.ask) && q.bid>0 && q.ask>=q.bid ? q.ask-q.bid : null;
  const scenario=(direction:'long'|'short')=>({direction,entry:null,entry_side:direction==='long'?'ask':'bid',exit_side:direction==='long'?'bid':'ask',
    structural_sl:null,setup:null,distance_to_sl:null,first_obstacle:null,first_opposing_obstacle:null,distance_to_first_obstacle:null,
    principal_tp:null,distance_to_tp:null,rr_to_obstacle:null,rr_to_tp:null,obstacles_before_tp:[] as ReturnType<typeof classifyObstacles>['before_tp'],current_zones:[] as ReturnType<typeof classifyObstacles>['current_zones'],uncertain_zones:[],obstacles_at_or_beyond_tp:[],
    obstacle_policy:'Author A-to-B evidence is available in /api/intelligence; legacy heuristic risk disabled.',reason:'NEEDS_SPECIFICATION'});
  return {hypothetical_entry:entry,entry_reference_side:context?.side??null,spread,spread_status:spread===null?'UNVERIFIED':'OBSERVED_SNAPSHOT',
    quote_fresh:q?.fresh??false,long:scenario('long'),short:scenario('short'),
    assumptions:'No inferred protected-swing stop, principal TP, order execution, position sizing or aggregate risk decision. Author technical invalidation is exposed separately by intelligence.'};
}
