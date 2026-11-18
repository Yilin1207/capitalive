import {HISTORY,type CandleResponse,type PriceSide,type Timeframe} from '../candle-data';
import {closedRegularInterval} from '../research/calendars';

// Reconcile broker bars within the observed overlap. Session coverage outside
// those inputs, including historical holiday exceptions, remains unknown.
export function reconcileOhlc(data:Record<Timeframe,CandleResponse>,tf:Timeframe,side:PriceSide,asOf:string){
 const childTf=tf==='D1'?'H4':tf==='MN1'||tf==='W1'?'D1':null;
 if(!childTf)return null;
 const source=data[childTf],step=HISTORY[childTf].seconds*1000;
 const children=new Map(source.candles.map(c=>[Date.parse(c.time),c]));
 const earliest=Date.parse(source.candles[0]?.time),latest=Date.parse(source.candles.at(-1)?.time??'')+step;
 const cutoff=Math.min(Date.parse(asOf),Date.parse(source.fetched_at));
 const fields=['open','high','low','close'] as const;
 let matched=0,outside=0;
 const mismatches:string[]=[],incomplete:string[]=[];
 for(const parent of data[tf].candles){
  const start=Date.parse(parent.time),date=new Date(start);
  const end=tf==='MN1'?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1):start+HISTORY[tf].seconds*1000;
  if(!parent.is_closed||end>cutoff)continue;
  if(!children.size||start<earliest||end>latest){outside++;continue;}
  const bars=[];
  let complete=true;
  for(let t=start;t<end;t+=step){
   const bar=children.get(t);
   if(!bar && closedRegularInterval(source.symbol,t,t+step))continue;
   if(!bar?.is_closed || fields.some(f=>bar[f][side]===null)){complete=false;break;}
   bars.push(bar);
  }
  if(!complete || !bars.length || (parent.history_completeness_by_side?.[side]??parent.history_completeness)==='partial_validation'
     || (tf==='MN1' && parent.daily_bars!==bars.length)){
   incomplete.push(parent.time);continue;
  }
  const values=[bars[0].open[side],Math.max(...bars.map(b=>b.high[side]!)),Math.min(...bars.map(b=>b.low[side]!)),bars.at(-1)!.close[side]];
  if(fields.every((f,i)=>parent[f][side]===values[i]))matched++;
  else mismatches.push(parent.time);
 }
 return {source_timeframe:childTf,matched,mismatches,incomplete,outside_overlap:outside,price_source:'SAME_PROVIDER',holiday_coverage:'UNVERIFIED'};
}
