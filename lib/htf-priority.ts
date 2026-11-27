import { ANALYSIS_TIMEFRAMES, type SeriesAnalysis } from './technical-analysis';
import type { Timeframe } from './candle-data';
import type { SNRAudit, SNRZone } from './htf-snr';

export const SNR_COLORS: Record<Timeframe, string> = { MN1: '#c8a5ff', W1: '#66c8ff', D1: '#f1c76b', H4: '#57dab2', H1: '#7db6ee' };
export type PriorityZone = Pick<SNRZone, 'id' | 'timeframe' | 'lower' | 'upper' | 'role' | 'provisional_role' | 'status' | 'current_state' | 'break_status' | 'retest_status' | 'origin' | 'confirmed_at'> & {
  position: 'above' | 'below' | 'inside' | 'unknown'; distance_atr: number | null; score: number;
  components: { timeframe: number; evidence: number; reaction: number; proximity: number; recency: number; confluence: number; penalty: number };
  tests: number; reactions: number; last_interaction: string; approach: SNRZone['evidence']['tests'][number]['approach'] | null;
  confluences: { source_id: string; timeframe: Timeframe; type: 'FVG' | 'FRACTAL' }[];
  events: SNRZone['evidence']['events']; event_history_total: number; event_history_omitted: number; selection_reasons: string[];
};

/** No author numeric priority weights are specified. */
export function rankPriorityZones(snr:Partial<Record<Timeframe,SNRAudit>>,analyses:SeriesAnalysis[],reference:number|null,limit=20){
 void analyses;void reference;
 return {zones:[] as PriorityZone[],full_snr_count:Object.values(snr).reduce((n,s)=>n+s.all_zone_count,0),selected_count:0,
 excluded_from_priority:[] as {id:string;reason:string;represented_by?:string}[],full_catalog_omitted:0,
 policy:{limit,per_timeframe_cap:0,minimum_available_MN1_W1:0,overlap_representative_ratio:0,formula:'NEEDS_SPECIFICATION',confluence_required:false,score_is_probability:false,historical_signal:false}};
}
export type PriorityZones=ReturnType<typeof rankPriorityZones>;
