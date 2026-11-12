import {candle,data,supportHistory} from './htf-test-helpers';
import type {Timeframe} from '../lib/candle-data';

/** Hand-authored price paths; annotations live in a separate static JSON, not engine output. */
export function reviewScenario(pattern:string,timeframe:Timeframe){
  let bars=supportHistory();
  if(pattern==='flip')bars.push(candle(12,99,90,94),candle(13,96,90,93),candle(14,101,90,94),candle(15,96,88,92));
  if(pattern==='sweep')bars.push(candle(12,110,96,108));
  if(pattern==='false_break')bars.push(candle(12,110,94,96,true,100),candle(13,112,90,110));
  if(pattern==='failed_reclaim')bars.push(candle(12,110,75,77,true,108),candle(13,101,78,90));
  if(pattern==='continuous')bars=Array.from({length:20},(_,i)=>candle(i,112,100,109));
  if(pattern==='weak')bars=Array.from({length:12},(_,i)=>i%4===0?candle(i,112,100,101):candle(i,106,104,104.1));
  if(pattern==='short')bars=bars.slice(0,3);
  if(pattern==='forming')bars.push(candle(12,110,75,77,false,108));
  if(timeframe==='MN1')bars=bars.map((c,i)=>({...c,time:new Date(Date.UTC(2024,i,1)).toISOString()}));
  return {...data(bars),timeframe};
}
