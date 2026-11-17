import {createHash} from 'node:crypto';
import {closedFrame} from '../knowledge/data';
import {buildIntelligence,type IntelligenceOptions} from '../knowledge/intelligence';
import {knowledgeCoverage} from '../knowledge/rules';
import type {CandleResponse,Timeframe,PriceSide} from '../candle-data';
import type {MarketQuote} from '../quote-normalization';
const frames=['MN1','W1','D1','H4'] as const;
/** Reuse only identical CLOSED inputs and revisions. Quote/forming-bar updates do
 * not rerun PA; revised OHLC, validation gaps, ranges or new closes always do.
 * The cached as_of stays honest. No provider-error fallback is implemented. */
export class ClosedAnalysisCache {
  private entries=new Map<string,ReturnType<typeof buildIntelligence>>();
  constructor(private capacity=12){}
  get(data:Record<Timeframe,CandleResponse>,side:PriceSide,quote:MarketQuote,options:IntelligenceOptions={},build=buildIntelligence){
    const asOf=frames.map(tf=>data[tf].fetched_at).sort()[0];
    const key=createHash('sha256').update(JSON.stringify({dr_revision:'dr-sequence-1',rb_revision:'rb-first-close-2',snr_revision:'snr-formation-context-2',fvg_revision:'fvg-unfilled-1',side,options,revision:knowledgeCoverage().catalog_revision,
      frames:frames.map(tf=>{const f=closedFrame(data[tf],side,asOf);return {symbol:f.symbol,environment:data[tf].environment,tf,bars:f.bars,status:f.status,warnings:f.warnings,validation:data[tf].metadata.validation_gaps};})})).digest('hex');
    const saved=this.entries.get(key);
    if(saved){this.entries.delete(key);this.entries.set(key,saved);return {result:saved,hit:true};}
    const result=build(data,side,quote,options);
    if(this.entries.size>=this.capacity)this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key,result);return {result,hit:false};
  }
}
export const closedAnalysisCache=new ClosedAnalysisCache();
