import type { CandleResponse, PriceSide, Timeframe } from './candle-data';
import { analyzeSeries, targetMap, ANALYSIS_TIMEFRAMES, type AnalysisSettings, type AnalysisSymbol, type SeriesAnalysis } from './technical-analysis';
import { analyzeHtfStructure } from './htf-structure';
import { prepareHtfBars } from './htf-data-quality';
import type { MarketQuote } from './quote-normalization';
import type { buildCompleteZoneCatalog } from './htf-zone-catalog';

export type RiskContext = { data: Record<Timeframe,CandleResponse>; asset: AnalysisSymbol; quote: MarketQuote; side: PriceSide; settings?: Partial<AnalysisSettings> };
export function calculateStructuralRisk(analyses: SeriesAnalysis[], catalog: ReturnType<typeof buildCompleteZoneCatalog>, entry: number | null, context?: RiskContext) {
  const q=context?.quote;
  const spread=q && q.bid!==null && q.ask!==null && Number.isFinite(q.bid) && Number.isFinite(q.ask) && q.bid>0 && q.ask>=q.bid ? q.ask-q.bid : null;
  const scenario=(direction:'long'|'short')=>{
    const long=direction==='long', exitSide:PriceSide=long?'bid':'ask';
    const executableEntry=entry!==null && Number.isFinite(entry) && entry>0 && spread!==null && context
      ? entry+(long ? (context.side==='bid'?spread:0) : (context.side==='ask'?-spread:0)) : null;
    const actual=context ? ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(context.data[tf],context.asset,exitSide,context.settings,executableEntry)) : analyses;
    const h4=actual.find(s=>s.timeframe==='H4');
    const structure=context && h4 ? analyzeHtfStructure(context.data.H4,h4,exitSide) : null;
    const prepared=context ? prepareHtfBars(context.data.H4,exitSide) : null;
    const lastBreak=structure?.breaks.at(-1);
    const directionMatches=lastBreak?.direction===(long?'bullish':'bearish');
    const pivot=directionMatches ? h4?.fractals.filter(f=>f.kind===(long?'low':'high') && f.index+2<=lastBreak!.index && f.index<lastBreak!.index)
      .sort((a,b)=>b.index-a.index)[0] : undefined;
    const pivotBar=pivot && prepared?.bars.find(b=>b.index===pivot.index);
    const valid=executableEntry!==null && pivot && pivot.liquidity_status!=='swept' && prepared?.confirmationsAllowed && prepared.currentSegmentVerified
      && pivotBar?.segment===prepared.latestSegment && (long?pivot.price<executableEntry:pivot.price>executableEntry);
    const stop=valid ? {price:pivot.price,source_id:pivot.id,confirmed_at:pivot.confirmed_at,timeframe:'H4',price_side:exitSide,
      protected_by_break_id:lastBreak!.id,protected_at:lastBreak!.confirmed_at,invalidation:'strict_wick_cross_of_pre_break_protected_swing; boundary_not_an_order'} : null;
    const targets=targetMap(actual,executableEntry), target=long?targets.above.nearest:targets.below.nearest;
    // Convert selected-side catalog geometry using current observed spread only; do not pretend historical spreads are constant.
    const sideAdjustment=spread===null || !context ? null : context.side===exitSide?0:exitSide==='ask'?spread:-spread;
    const obstacles=executableEntry===null || sideAdjustment===null ? [] : catalog.zones.filter(z=>z.significant && (z.type==='SNR'||z.role===(long?'resistance':'support')))
      .map(z=>({id:z.id,timeframe:z.timeframe,type:z.type,lower:z.lower+sideAdjustment,upper:z.upper+sideAdjustment}))
      .filter(z=>long?z.upper>=executableEntry:z.lower<=executableEntry)
      .map(z=>({id:z.id,timeframe:z.timeframe,type:z.type,price:long?Math.max(executableEntry,z.lower):Math.min(executableEntry,z.upper),price_side:exitSide,
        side_conversion:sideAdjustment===0?'none':'current_spread_approximation'}))
      .sort((a,b)=>Math.abs(a.price-executableEntry)-Math.abs(b.price-executableEntry)||ANALYSIS_TIMEFRAMES.indexOf(a.timeframe)-ANALYSIS_TIMEFRAMES.indexOf(b.timeframe));
    const obstacle=obstacles[0]??null;
    const risk=stop && executableEntry!==null?Math.abs(executableEntry-stop.price):null;
    const obstacleDistance=obstacle && executableEntry!==null?Math.abs(obstacle.price-executableEntry):null;
    const tpDistance=target && executableEntry!==null?Math.abs(target.price-executableEntry):null;
    return {direction,entry:executableEntry,entry_side:long?'ask':'bid',exit_side:exitSide,structural_sl:stop,
      setup:stop?{type:'protected_swing_after_closed_structure_break',break_id:lastBreak!.id}:null,
      distance_to_sl:risk,first_obstacle:obstacle,distance_to_first_obstacle:obstacleDistance,principal_tp:target,distance_to_tp:tpDistance,
      rr_to_obstacle:risk && obstacleDistance!==null?obstacleDistance/risk:null,rr_to_tp:risk && tpDistance!==null?tpDistance/risk:null,
      obstacles_before_tp:obstacles.filter(o=>tpDistance===null || Math.abs(o.price-executableEntry!)<tpDistance),
      reason:spread===null?'QUOTE_SPREAD_UNAVAILABLE':!context?'STRUCTURAL_CONTEXT_REQUIRED':stop?'PROTECTED_SWING_INVALIDATION':'NO_VALID_PROTECTED_SWING_FOR_LATEST_BREAK',
    };
  };
  return {hypothetical_entry:entry,entry_reference_side:context?.side??null,spread,spread_status:spread===null?'UNVERIFIED':'OBSERVED_SNAPSHOT',
    quote_fresh:q?.fresh??false,long:scenario('long'),short:scenario('short'),
    assumptions:'Geometry only. Long enters Ask/exits Bid; short enters Bid/exits Ask. Actual opposite-side OHLC used for SL/TP. Current spread approximates opposite-side SNR obstacles; no future spread, slippage, fees, sizing or trade recommendation.'};
}
