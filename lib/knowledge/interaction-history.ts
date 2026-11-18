import type {Frame} from './data';import {TF_ORDER,type KeyLevel} from './detectors';import type {Timeframe} from '../candle-data';
/** On-demand, complete observed interactions, not a claim of complete market
 * history. Same-TF and lower-TF observations overlap and are not independent. */
export function interactionHistory(level:KeyLevel,all:Record<Timeframe,Frame>,asOf:string){
 const events=[];
 for(const tf of TF_ORDER.slice(TF_ORDER.indexOf(level.timeframe))){const f=all[tf];if(f.side!==level.side||f.symbol!==all[level.timeframe].symbol)continue;
  for(const b of f.bars){if(b.time<level.confirmed_at||b.end>asOf||b.end>f.as_of)continue;
   const kinds:string[]=[];const hit=b.high>=level.lower&&b.low<=level.upper;
   if(hit)kinds.push('OBSERVED_TEST');
   if(level.kind==='FRACTAL'&&(level.role==='support'?b.low<level.lower:b.high>level.upper))kinds.push('STRICT_LIQUIDITY_CROSSING');
   if(level.role==='support'?b.close<level.lower:b.close>level.upper)kinds.push(tf===level.timeframe?'OWN_TF_CLOSE_BEYOND':'LOWER_TF_CLOSE_BEYOND');
   if(kinds.length)events.push({timeframe:tf,index:b.index,time:b.time,confirmed_at:b.end,kinds,open:b.open,high:b.high,low:b.low,close:b.close});
  }
 }
 events.sort((a,b)=>a.confirmed_at.localeCompare(b.confirmed_at)||TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe));
 return {events,total:events.length,omitted:0,scope:'ALL_OBSERVED_CLOSED_INTERACTIONS_NOT_COMPLETE_MARKET_HISTORY',overlapping_timeframes_are_independent:false};
}
