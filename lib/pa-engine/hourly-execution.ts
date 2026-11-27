import {createHash} from 'node:crypto';
import type {CandleResponse} from '../candle-data';
import {closedFrame,type Bar} from '../knowledge/data';
import {detectFractals,detectFvg} from '../knowledge/detectors';
import {fvgTestTimeline,remainingBounds} from '../knowledge/fvg-remaining';
import {closedRegularInterval} from '../research/calendars';
import {approachBars,atrD1} from './brief-facts';
import {thesisRanges} from './thesis-location';
import type {PaEngine} from './core';

const WINDOW=12;
const round=(v:number)=>Number(v.toFixed(10));

export function freshHourlyStatus(warnings:readonly string[]){
 return warnings.length?'PARTIAL' as const:'OK' as const;
}

// H4 identifies the two boundary candles. Within the later candle the extreme's
// hour is knowable only when the complete hourly sequence agrees with its price.
function pullbackExtreme(core:PaEngine,range:ReturnType<typeof thesisRanges>['active_dr']['H4'],bars:Bar[]){
 if(!range)return null;
 const high=core.evidence.find(e=>e.id===range.high_id)?.candle_evidence[1];
 const low=core.evidence.find(e=>e.id===range.low_id)?.candle_evidence[1];
 if(!high||!low||high.time===low.time)return null;
 const polarity=high.time>low.time?'high':'low';
 const pivot=polarity==='high'?high:low;
 const hours=bars.filter(b=>b.time>=pivot.time&&b.end<=pivot.closed_at);
 const complete=hours[0]?.time===pivot.time&&hours.at(-1)?.end===pivot.closed_at&&
  hours.every((b,i)=>i===0||b.time===hours[i-1].end);
 const price=range[polarity];
 const observed=polarity==='high'?Math.max(...hours.map(b=>b.high)):Math.min(...hours.map(b=>b.low));
 const exact=complete&&observed===price?hours.findLast(b=>b[polarity]===price):undefined;
 return {polarity,id:polarity==='high'?range.high_id:range.low_id,price,pivot_at:pivot.time,
  after_from:exact?.end??pivot.closed_at,basis:exact?'CLOSED_EXTREME_HOUR':'CLOSED_EXTREME_H4_CANDLE'};
}

export function hourlyExecution(data:CandleResponse,core:PaEngine){
 if(data.timeframe!=='H1'||data.symbol!==core.symbol||data.provider!=='Capital.com')throw Error('INVALID_HOURLY_IDENTITY');
 const frame=closedFrame(data,core.side,core.as_of);
 const bars=frame.bars,latest=bars.at(-1);
 if(!latest)return {status:'UNAVAILABLE' as const,reason:'NO_CLOSED_H1',as_of:core.as_of};
 const closed=Date.parse(latest.end),expected=Math.floor(Date.parse(core.as_of)/3600000)*3600000;
 if(closed<expected&&!closedRegularInterval(core.symbol,closed,expected))
  return {status:'STALE' as const,reason:'H1_CLOSED_CANDLE_DELAY',last_closed_at:latest.end,as_of:core.as_of};

 const tail=bars.slice(-WINDOW),first=tail[0],sameSegment=bars.filter(b=>b.segment===latest.segment);
 const h4=thesisRanges(core).active_dr.H4;
 const extreme=pullbackExtreme(core,h4,bars);
 const sideKnown=!!(extreme&&h4&&latest.close>h4.low&&latest.close<h4.high&&
  !bars.some(b=>b.time>=extreme.after_from&&(b.high>h4.high||b.low<h4.low)));
 const pivots=detectFractals(frame).map(p=>{
  const raid=bars.find(b=>b.time>=p.confirmed_at&&(p.polarity==='high'?b.high>p.price:b.low<p.price));
  return {id:p.id,polarity:p.polarity,price:p.price,pivot_at:p.candle_evidence[1].time,confirmed_at:p.confirmed_at,
   formed_after_dr_extreme:!!extreme&&p.candle_evidence[1].time>=extreme.after_from,segment:p.segment,first_observed_raid_at:raid?.end??null};
 });
 const fractals=pivots.filter(p=>p.confirmed_at>=first.end);
 const fvg=detectFvg(frame,'PA_ONLY').levels.filter(l=>l.confirmed_at>=first.end).map(l=>{
  const depth=fvgTestTimeline(l,[frame]).at(-1)?.fraction??0;
  return {id:l.id,confirmed_at:l.confirmed_at,polarity:l.role==='support'?'bullish':'bearish',lower:l.lower,upper:l.upper,
   observed_fill_fraction:depth,remaining:remainingBounds(l,depth)};
 });
 const inRange=h4?pivots.filter(p=>p.price>h4.low&&p.price<h4.high):[];
 const consumedTotal=inRange.filter(p=>p.first_observed_raid_at!==null).length;
 const inside=h4?inRange.filter(p=>p.first_observed_raid_at===null&&(!sideKnown||p.formed_after_dr_extreme)).map(p=>({
  ...p,same_h1_segment_as_latest:p.segment===latest.segment,distance_to_eq:round(Math.abs(p.price-h4.eq)),position_pct:round(100*(p.price-h4.low)/(h4.high-h4.low)),
  known_together_at:p.confirmed_at>h4.confirmed_at?p.confirmed_at:h4.confirmed_at
 })).sort((a,b)=>a.distance_to_eq-b.distance_to_eq||b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id)):[];
 const approach=approachBars(sameSegment,atrD1(core)?.value??null,null);
 const approachWindow=approach?sameSegment.slice(-approach.window_bars):[];
 const body=(b:typeof latest)=>Math.abs(b.close-b.open);
 const facts={status:freshHourlyStatus(frame.warnings),as_of:core.as_of,symbol:core.symbol,price_side:core.side,timeframe:'H1' as const,
  provider:'Capital.com',grid:'utc' as const,last_closed_at:latest.end,warnings:frame.warnings,window_start:first.time,
  last_closed_candles:tail.map(b=>({time:b.time,closed_at:b.end,open:b.open,high:b.high,low:b.low,close:b.close,segment:b.segment})),
  fractals,fvg,new_fvg_count:{bullish:fvg.filter(f=>f.polarity==='bullish').length,bearish:fvg.filter(f=>f.polarity==='bearish').length},
  approach:approach?{...approach,window_start:approachWindow[0].time,mean_body:round(approachWindow.reduce((n,b)=>n+body(b),0)/approachWindow.length),
   last_body:round(body(latest)),new_fvg_count:fvg.filter(f=>f.confirmed_at>=approachWindow[0].end).length}:null,
  h4_range:h4,idm_in_h4:{range_available:!!h4,consumed_total:consumedTotal,pullback_extreme:extreme,pullback_side_known:sideKnown,
   selection:sideKnown?'UNRAIDED_H1_AFTER_H4_EXTREME_BY_DISTANCE_TO_EQ':'UNRAIDED_H1_INSIDE_ACTIVE_H4_SORTED_BY_DISTANCE_TO_EQ',
   items:inside.slice(0,WINDOW),total:inside.length,omitted:Math.max(0,inside.length-WINDOW)}};
 return {...facts,snapshot_sha256:createHash('sha256').update(JSON.stringify(facts)).digest('hex')};
}
export type HourlyExecution=ReturnType<typeof hourlyExecution>;
