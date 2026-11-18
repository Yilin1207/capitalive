import type { CandleResponse, PriceSide } from './candle-data';
import { prepareHtfBars, barCloseTime, type Reliability } from './htf-data-quality';
import type { SeriesAnalysis, Fractal } from './technical-analysis';

export type StructureBreak = { id: string; type: 'BOS' | 'CHOCH'; direction: 'bullish' | 'bearish'; time: string;
  confirmed_at: string; price: number; source_id: string; pivot_time: string; previous_bias: string; index: number };
export type OrderBlock = { id: string; type: 'ORDER_BLOCK' | 'BREAKER'; lower: number; upper: number; direction: 'bullish' | 'bearish';
  origin_time: string; confirmed_at: string; structure_break_id: string; status: 'active' | 'invalidated' | 'unverified_after_gap'; invalidated_at: string | null;
  retested_at: string | null; evidence: string[]; data_reliability: Reliability };

/** Deprecated compatibility envelope. Unsupported generic structure/OB/breaker rules removed in V5. */
export function analyzeHtfStructure(data: CandleResponse, series: SeriesAnalysis, side: PriceSide) {
  void series;
  return {bias:'undetermined' as const,swing_labels:[] as {source_id:string;time:string;confirmed_at:string;kind:string;price:number}[],
    breaks:[] as StructureBreak[],order_blocks:[] as OrderBlock[],data_reliability:prepareHtfBars(data,side).reliability,
    status:'NEEDS_SPECIFICATION',rules:{structure:'THE_EDGE_AUTHOR_REVIEW_REQUIRED',choch:'DISABLED_NO_AUTHOR_CRITERIA',order_blocks:'DISABLED_NO_AUTHOR_CRITERIA',barriers:'NO_PATTERN_STITCHING'}};
}
export type HtfStructure = ReturnType<typeof analyzeHtfStructure>;
