import type { CandleResponse, PriceSide, Timeframe } from './candle-data';
import { analyzeSeries, ANALYSIS_TIMEFRAMES, type AnalysisSymbol } from './technical-analysis';
import { detectIndependentSNR } from './htf-snr';
import { rankPriorityZones, type PriorityZones } from './htf-priority';

export type ChartHtf = { priority_zones: PriorityZones; frame_snapshots?: Partial<Record<Timeframe,string>> };
export function chartHtf(data:Partial<Record<Timeframe,CandleResponse>>,symbol:AnalysisSymbol,side:PriceSide,price:number|null):ChartHtf {
  const available=ANALYSIS_TIMEFRAMES.flatMap(tf=>data[tf]?[data[tf]!]:[]);
  const series=available.map(d=>analyzeSeries(d,symbol,side,{},price));
  const snr=Object.fromEntries(available.map(d=>[d.timeframe,detectIndependentSNR(d,symbol,side,price)]));
  return {priority_zones:rankPriorityZones(snr,series,price),frame_snapshots:Object.fromEntries(available.map(d=>[d.timeframe,d.fetched_at]))};
}
