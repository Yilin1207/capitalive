import {createHash} from 'node:crypto';
import {normalizeCandles,parseCandleTime,type Candle,type RejectedCandle} from './candle-data';
const fields=['open','high','low','close'] as const,sides=['bid','ask'] as const;
export type DailyRecovery={day:string;source:'Capital.com HOUR_4';status:'RECOVERED'|'NOT_RECOVERED';reason:string;input_sha256:string|null;verification_day?:string};
/** Reconstruct from observed bars only. No interpolation, rounding tolerance or price correction. */
export function recoverDaily(rejected:RejectedCandle,original:unknown,validDaily:Candle[],h4Payload:unknown,asOf:number):{candle:Candle|null;record:DailyRecovery}{
 const day=rejected.time??'',record:DailyRecovery={day,source:'Capital.com HOUR_4',status:'NOT_RECOVERED',reason:'UNSUPPORTED_REJECTION',input_sha256:createHash('sha256').update(JSON.stringify(h4Payload)).digest('hex')};
 const fail=(reason:string)=>({candle:null,record:{...record,reason}});
 if(rejected.reason!=='crossed_sides'||rejected.crossed_fields?.length!==1||!parseCandleTime(day)||!day.endsWith('T00:00:00.000Z')||Date.parse(day)+86400_000>asOf||!original||typeof original!=='object')return fail('UNSUPPORTED_REJECTION');
 const q=normalizeCandles(h4Payload,'H4',asOf);if(q.discarded_reasons.invalid_time)return fail('UNLOCATABLE_H4_ROW');
 function aggregate(start:number):Candle|null{const rows=q.candles.filter(c=>Date.parse(c.time)>=start&&Date.parse(c.time)<start+86400_000);
  if(rows.length!==6||rows.some((c,i)=>Date.parse(c.time)!==start+i*14400_000||!c.is_closed||fields.some(k=>sides.some(s=>c[k][s]===null||c[k][s]!<=0))))return null;
  const result:Candle={time:new Date(start).toISOString(),open:{...rows[0].open},close:{...rows[5].close},high:{bid:Math.max(...rows.map(c=>c.high.bid!)),ask:Math.max(...rows.map(c=>c.high.ask!))},low:{bid:Math.min(...rows.map(c=>c.low.bid!)),ask:Math.min(...rows.map(c=>c.low.ask!))},is_closed:true,source:'Capital.com HOUR_4'};
  return fields.some(k=>result[k].bid!>result[k].ask!)?null:result;
 }
 const candle=aggregate(Date.parse(day));if(!candle)return fail('INCOMPLETE_OR_INVALID_H4_DAY');
 const previous=aggregate(Date.parse(day)-86400_000),daily=validDaily.find(c=>c.time===previous?.time&&c.source!=='Capital.com HOUR_4');
 if(!previous||!daily||!fields.every(k=>sides.every(s=>previous[k][s]===daily[k][s])))return fail('PREVIOUS_DAY_DOES_NOT_MATCH_ALL_BID_ASK_FIELDS');
 const raw=original as Record<string,Record<string,unknown>>,field=rejected.crossed_fields[0].field;
 if(!sides.some(s=>fields.every(k=>candle[k][s]===raw[`${k}Price`]?.[s]))||!fields.filter(k=>k!==field).every(k=>sides.every(s=>candle[k][s]===raw[`${k}Price`]?.[s])))return fail('UNAFFECTED_DAILY_FIELDS_DO_NOT_MATCH');
 return {candle,record:{...record,status:'RECOVERED',reason:'SIX_REAL_H4_BARS_MATCH_UNAFFECTED_FIELDS_AND_PREVIOUS_VALID_D1',verification_day:previous.time}};
}
