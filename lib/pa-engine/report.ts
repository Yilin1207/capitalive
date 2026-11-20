import {createHash} from 'node:crypto';
import type {CandleResponse,Timeframe} from '../candle-data';
import type {MarketQuote} from '../quote-normalization';
import type {buildPaEngine} from './core';
import {freshnessPolicy} from '../research-bridge/freshness';
import {closedRegularInterval} from '../research/calendars';
export const PA_CONTRACT='pa-engine-v6.1';
export const PA_MAX_BYTES=65536;
export const PA_TFS=['MN1','W1','D1','H4'] as const;
export type PaEngine=ReturnType<typeof buildPaEngine>;
export function snapshotHash(core:PaEngine){return createHash('sha256').update(JSON.stringify({revision:PA_CONTRACT,symbol:core.symbol,side:core.side,frames:PA_TFS.map(tf=>({tf,ohlc:core.frames[tf].ohlc,warnings:core.frames[tf].warnings})),definitions:core.definitions,ranges:core.dealing_ranges.map(r=>({timeframe:r.timeframe,current:r.current,status:r.status,explicit:r.explicit_range}))})).digest('hex');}
export const NEARBY_PER_SIDE=3;
export const NEARBY_KINDS=['FRACTAL','FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK'] as const;
export const NEARBY_EXCLUDED_STATES=['CONSUMED','INVALIDATED'] as const;
export type NearbyLevel={id:string;kind:string;lower:number;upper:number;bounds_basis:'FVG_REMAINING'|'ORIGINAL';state:string;fill:string|null;distance:number};
type NearbyFrame={above:NearbyLevel[];below:NearbyLevel[];at_price:NearbyLevel[];eligible:{above:number;below:number;at_price:number}};
/** Strip float noise from price differences (e.g. 57.99999999 -> 58). */
const priceDiff=(a:number,b:number)=>Number((a-b).toFixed(10));
/** Geometric proximity only: nearest unconsumed, non-invalidated levels around the last closed H4 close.
 * Ordering is distance then id; it is never a significance, strength or direction ranking. */
export function nearbyLevels(core:Pick<PaEngine,'frames'|'evidence'>,perSide:number=NEARBY_PER_SIDE){
 const last=core.frames.H4.ohlc.at(-1);if(!last)return null;
 const ref=last.close,timeframes={} as Record<(typeof PA_TFS)[number],NearbyFrame>;let eligible=0;
 for(const tf of PA_TFS){
  const rows={above:[] as NearbyLevel[],below:[] as NearbyLevel[],at_price:[] as NearbyLevel[]};
  for(const e of core.evidence){
   const s=e.lifecycle;
   if(e.timeframe!==tf||!s||!(NEARBY_KINDS as readonly string[]).includes(e.kind)||(NEARBY_EXCLUDED_STATES as readonly string[]).includes(s.state))continue;
   // FVG: only the unfilled remainder is a live zone; a fully tested gap has none.
   const fvg=e.kind==='FVG',b=fvg?e.remaining_bounds:e.bounds;
   if(!b||!Number.isFinite(b.lower)||!Number.isFinite(b.upper)||fvg&&(!s.fill||s.fill.state==='FILLED'||s.fill.max_observed_fraction>=1))continue;
   const side=b.lower>ref?'above':b.upper<ref?'below':'at_price';
   rows[side].push({id:e.id,kind:e.kind,lower:b.lower,upper:b.upper,bounds_basis:fvg&&s.fill!.max_observed_fraction>0?'FVG_REMAINING':'ORIGINAL',state:s.state,fill:fvg?s.fill!.state:null,distance:side==='above'?priceDiff(b.lower,ref):side==='below'?priceDiff(ref,b.upper):0});
  }
  const pick=(x:NearbyLevel[])=>x.sort((a,c)=>a.distance-c.distance||a.id.localeCompare(c.id)).slice(0,perSide);
  const counts={above:rows.above.length,below:rows.below.length,at_price:rows.at_price.length};eligible+=counts.above+counts.below+counts.at_price;
  timeframes[tf]={above:pick(rows.above),below:pick(rows.below),at_price:pick(rows.at_price),eligible:counts};
 }
 return {block:{reference:{price:ref,at:last.end,basis:'LAST_CLOSED_H4_CLOSE' as const},selection_policy:'NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE' as const,state_field:'lifecycle.state' as const,distance_unit:'PRICE' as const,per_side_limit:perSide,excluded_states:[...NEARBY_EXCLUDED_STATES,'FVG_FILLED'],size_trimmed:0,timeframes},eligible};
}
const nearbyCount=(n:{timeframes:Record<string,NearbyFrame>}|null)=>n?Object.values(n.timeframes).reduce((k,f)=>k+f.above.length+f.below.length+f.at_price.length,0):0;
/** Size fallback: drop the farthest included level across all TFs (ties: later id first). */
function trimFarthestNearby(n:{size_trimmed:number;timeframes:Record<string,NearbyFrame>}){
 let worst:{list:NearbyLevel[];item:NearbyLevel}|null=null;
 for(const f of Object.values(n.timeframes))for(const list of [f.above,f.below,f.at_price]){const item=list.at(-1);if(item&&(!worst||item.distance>worst.item.distance||item.distance===worst.item.distance&&item.id>worst.item.id))worst={list,item};}
 if(!worst)return false;worst.list.pop();n.size_trimmed++;return true;
}
export function paError(symbol:string,code='UPSTREAM_UNAVAILABLE',now=new Date().toISOString()){
 return {schema_version:'pa-engine-v6',mode:'PA_ONLY',symbol,status:'ERROR',data_quality:'UNVERIFIED',generated_at:now,as_of:null,expires_at:now,published_at:null,error:code,source:null,quote:null,freshness:null,frames:{},evidence:[],market_structure:{},dealing_ranges:[],lifecycle_events:[],cross_timeframe_interactions:[],nearby_levels:null,coverage:null,warnings:[code],omitted:{evidence:0,nearby_levels:0},trading_enabled:false};
}
export function buildPaReport(core:PaEngine,data:Record<Timeframe,CandleResponse>,quote:MarketQuote,now=new Date().toISOString(),commit:string|null=null){
 const clock=Date.parse(now),policy=freshnessPolicy(process.env),valid=quote.bid!==null&&quote.ask!==null&&Number.isFinite(quote.bid)&&Number.isFinite(quote.ask)&&quote.bid>0&&quote.ask>=quote.bid;
 const qt=quote.provider_timestamp??quote.quote_time,qr=quote.retrieved_at??quote.fetched_at_utc??null,age=qt?(clock-Date.parse(qt))/1000:null;
 if(!Number.isFinite(clock)||Date.parse(core.as_of)>clock||age!==null&&(!Number.isFinite(age)||age<0)||qr&&Date.parse(qr)>clock)throw Error('INVALID_EVIDENCE');
 const closed=quote.market_status==='CLOSED'&&!!qr&&clock-Date.parse(qr)<=policy.delivery_seconds*1000;
 const fresh=valid&&age!==null&&age>=0&&age<=policy.quote_seconds&&quote.fresh&&!closed;
 const reasons:string[]=[];if(!valid)reasons.push('QUOTE_UNAVAILABLE');if(!qt)reasons.push('QUOTE_PROVIDER_TIME_UNKNOWN');else if(!fresh&&!closed)reasons.push('QUOTE_STALE');
 const sourceAge=Math.max(...PA_TFS.map(tf=>(clock-Date.parse(data[tf].fetched_at))/1000));if(sourceAge>policy.delivery_seconds)reasons.push('SOURCE_SNAPSHOT_STALE');
 const h4=core.frames.H4.last_closed_at,expected=Math.floor(clock/14400000)*14400000,delay=h4&&Date.parse(h4)<expected?(clock-Date.parse(h4)-14400000)/1000:0;
 if(!h4||delay>policy.h4_delay_seconds&&!closedRegularInterval(core.symbol,Date.parse(h4),expected))reasons.push('H4_CLOSED_CANDLE_DELAY');
 const status=PA_TFS.some(tf=>!core.frames[tf].closed_candles)?'ERROR':reasons.length?'STALE':core.data_quality;
 const available=!['ERROR','STALE'].includes(status),snapshot=snapshotHash(core);
 const frames=Object.fromEntries(PA_TFS.map(tf=>{const f=core.frames[tf];return [tf,{timeframe:tf,data_quality:f.data_quality,warnings:f.warnings,last_closed_at:f.last_closed_at,closed_candles:f.closed_candles,as_of:f.as_of,fetched_at:data[tf].fetched_at,ohlc_validation:f.ohlc_validation,calendar:f.calendar,ohlc_path:`/api/pa-candles?symbol=${core.symbol}&side=${core.side}&timeframe=${tf}&snapshot_sha256=${snapshot}`}];}));
 // Recency and rotating TF categories are display policies, never significance or direction scores.
 const groups=PA_TFS.flatMap(tf=>[...new Set(core.evidence.filter(e=>e.timeframe===tf).map(e=>e.kind))].map(kind=>core.evidence.filter(e=>e.timeframe===tf&&e.kind===kind).sort((a,b)=>b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id))));
 const selected=available?groups.flatMap(g=>g.slice(0,1)):[];
 const nearby=nearbyLevels(core),nearbyBlock=available&&nearby?nearby.block:null,nearbyEligible=nearby?.eligible??0;
 const result={schema_version:'pa-engine-v6',contract_revision:PA_CONTRACT,mode:'PA_ONLY',technical_only:true,symbol:core.symbol,price_side:core.side,status,data_quality:core.data_quality,generated_at:now,as_of:core.as_of,published_at:null,expires_at:new Date(fresh?Math.min(clock+policy.delivery_seconds*1000,Date.parse(qt!)+policy.quote_seconds*1000):clock+policy.delivery_seconds*1000).toISOString(),error:status==='ERROR'?'UPSTREAM_UNAVAILABLE':null,
 source:{provider:'Capital.com',environment:data.H4.environment,analysis_schema:'pa-engine-v6',price_side:core.side,engine_commit:commit,evidence_sha256:snapshot,demo_live_equivalence:'NOT_ESTABLISHED',full_ohlc_published:false},snapshot_sha256:snapshot,
 quote:{bid:valid?quote.bid:null,ask:valid?quote.ask:null,spread:valid?quote.ask!-quote.bid!:null,provider_timestamp:qt,retrieved_at:qr,source_type:quote.source_type,market_status:quote.market_status,provider_age_seconds:age,fresh,used_as_closed_evidence:false},
 freshness:{quote_status:closed?'MARKET_CLOSED':fresh?'FRESH':'STALE',quote_retrieved_at:qr,data_quality:core.data_quality,stale_reasons:reasons,quote_max_seconds:policy.quote_seconds,h4_max_delay_seconds:policy.h4_delay_seconds,h4_delay_seconds:delay,source_age_seconds:sourceAge,delivery_max_seconds:policy.delivery_seconds},
 frames,evidence:selected,market_structure:available?Object.fromEntries(PA_TFS.map(tf=>[tf,{details_path:`/api/pa-evidence?view=structure&symbol=${core.symbol}&side=${core.side}&timeframe=${tf}&snapshot_sha256=${snapshot}`}])):{},
 dealing_ranges:available?core.dealing_ranges.map(r=>({timeframe:r.timeframe,status:r.status,current:r.current?{lower:r.current.lower,upper:r.current.upper,equilibrium:r.current.equilibrium,confirmed_at:r.current.confirmed_at,high_id:r.current.high_id,low_id:r.current.low_id}:null,current_h4_position:r.current_h4_position,reference:r.reference,details_path:`/api/pa-evidence?view=structure&symbol=${core.symbol}&side=${core.side}&timeframe=${r.timeframe}&snapshot_sha256=${snapshot}`})):[],lifecycle_events:[],cross_timeframe_interactions:[],nearby_levels:nearbyBlock,definitions:core.definitions,
 coverage:{...core.coverage,findings_total:core.evidence.length,findings_included:selected.length,findings_omitted:core.evidence.length-selected.length,all_findings_included:selected.length===core.evidence.length,selection_policy:'RECENT_PER_TF_TYPE_NOT_SIGNIFICANCE',observations_available:available,raw_ohlc_included:false},
 warnings:[...core.warnings,...reasons],omitted:{evidence:core.evidence.length-selected.length,ohlc:PA_TFS.reduce((n,tf)=>n+core.frames[tf].closed_candles,0),lifecycle_events:core.lifecycle_events.length,cross_timeframe_interactions:core.cross_timeframe_interactions.length,market_structure:true,range_history:true,nearby_levels:nearbyEligible-nearbyCount(nearbyBlock)},
 details:{market_context:`/api/desk-report?symbol=${core.symbol}&side=${core.side}&view=market-context`,evidence:'/api/pa-evidence',ohlc:'/api/pa-candles',snapshot_sha256:snapshot},trading_enabled:false};
 // Size priority (approved): nearby_levels outranks the recency tail of evidence; evidence stays fully paginated via /api/pa-evidence.
 while(Buffer.byteLength(JSON.stringify(result))+64>PA_MAX_BYTES&&result.evidence.length){result.evidence.pop();result.coverage.findings_included--;result.coverage.findings_omitted++;result.coverage.all_findings_included=false;result.omitted.evidence++;}
 while(Buffer.byteLength(JSON.stringify(result))+64>PA_MAX_BYTES&&result.nearby_levels&&trimFarthestNearby(result.nearby_levels))result.omitted.nearby_levels++;
 if(Buffer.byteLength(JSON.stringify(result))+64>PA_MAX_BYTES)throw Error('REPORT_TOO_LARGE');
 return result;
}
export type PaReport=ReturnType<typeof buildPaReport>;
