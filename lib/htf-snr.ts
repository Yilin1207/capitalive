import type { CandleResponse, PriceSide, Timeframe } from './candle-data';
import { prepareHtfBars, barCloseTime, type ClosedBar, type Reliability } from './htf-data-quality';
import { INSTRUMENTS, type AnalysisSymbol } from './technical-analysis';

export type SNRRole = 'support' | 'resistance';
export type ZoneInteraction = {
  time: string; index: number; segment: number; kind: 'origin' | 'wick_touch' | 'close_in_zone' | 'traverse';
  role: SNRRole; reaction: 'up' | 'down' | 'not_proven'; reaction_at: string | null; reaction_distance: number | null;
  endpoint_near_zone: boolean;
  reaction_atr: number | null; approach: { bars: number; net_move_atr: number | null; directional_efficiency: number | null };
};
export type SNRState = 'CLOSE_BREAK' | 'BREAK_PENDING' | 'CONFIRMED_BREAK' | 'RETEST' | 'FAILED_RECLAIM' | 'CONFIRMED_ROLE_REVERSAL' | 'SWEEP' | 'BREAK_INVALIDATED';
export type ZoneEvent = { type: 'close_break' | 'break_pending' | 'confirmed_break' | 'retest' | 'role_reversal' | 'failed_reclaim' | 'liquidity_sweep' | 'break_invalidated';
  state: SNRState; confidence: 'OBSERVED' | 'PROVISIONAL' | 'RULE_CONFIRMED'; facts: { close: number };
  time: string; confirmed_at: string; index: number; role: SNRRole; break_time?: string; retest_time?: string; evidence: string };
export type SNRZone = {
  id: string; asset: AnalysisSymbol; timeframe: Timeframe; side: PriceSide; type: 'SNR'; lower: number; upper: number;
  role: SNRRole; status: 'tested' | 'watch'; origin: { method: string; time: string; endpoint: 'high' | 'low'; price: number; atr: number; half_width: number; bounds: 'heuristic_frozen_at_origin' };
  test_count: number; historical_test_count: number; reaction_count: number; last_test: string; last_interaction: string;
  break_status: 'unbroken' | 'pending' | 'confirmed' | 'reclaimed' | 'unknown_after_gap'; retest_status: 'none' | 'pending' | 'confirmed';
  current_state: SNRState | null; provisional_role: SNRRole | null;
  role_reversal_confirmed: boolean;
  quality: { score: number; basis: 'heuristic_not_probability'; downgrade_reasons: string[] };
  evidence: { tests: ZoneInteraction[]; events: ZoneEvent[]; clustered_endpoints: { time: string; kind: 'high' | 'low'; price: number }[] };
  invalidation: string; data_reliability: Reliability; distance_to_price: number | null; confirmed_at: string | null;
};
export type SNRConfig = { widthAtrFraction?: number; minTouchSeparation?: number; closeBreakBars?: number };
/** The old ATR endpoint clusters are not THE EDGE SNR. Kept as an empty
 * migration envelope; author two-candle/KL/closed-break SNR lives in knowledge/detectors. */
export function detectIndependentSNR(data:CandleResponse,asset:AnalysisSymbol,side:PriceSide='bid',reference:number|null=null,config:SNRConfig={}) {
  void config;
  const prepared=prepareHtfBars(data,side),bars=prepared.bars;
  return {timeframe:data.timeframe,asset,side,reference_price:reference,data_reliability:prepared.reliability,
    history:{input:data.candles.length,accepted_closed:bars.length,first:bars[0]?.time??null,last:bars.at(-1)?.time??null,excluded:prepared.excluded},
    parameters:{width_atr_fraction:0,min_width_units:0,minimum_test_separation_bars:0,close_break_bars:0,early_break:'REMOVED',role_reversal_rule:'REMOVED',confidence:'NEEDS_SPECIFICATION',reaction_min_atr:0,reaction_window_bars:0,independent_test:'REMOVED',atr:'NOT_USED'},
    zones:[] as SNRZone[],all_zone_count:0,selection:'USE_AUTHOR_SNR_IN_INTELLIGENCE',facts_scope:'DEPRECATED_UNSUPPORTED_HEURISTIC_REMOVED',time_semantics:'NO_OBSERVATIONS',heuristic_scope:'DISABLED',
    replacement:'/api/intelligence',status:'NEEDS_SPECIFICATION'};
}
export type SNRAudit=ReturnType<typeof detectIndependentSNR>;
