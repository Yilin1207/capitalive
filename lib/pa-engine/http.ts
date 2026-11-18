import 'server-only';
import {reconcileOhlc} from './coverage';
import {HistoryCache} from '../history-cache';
import {freshnessPolicy} from '../research-bridge/freshness';
import {getCandles} from '../candles';
import {getAnalysisQuote} from '../analysis-quote';
import {HISTORY,type CandleResponse,type Timeframe,type PriceSide} from '../candle-data';
import {checkHistoryRequest} from '../history-http';
import {buildPaEngine,interactionsForEvidence} from './core';
import {buildPaReport,paError,PA_CONTRACT,PA_TFS,snapshotHash,type PaEngine} from './report';
import {ACTIVE_RESEARCH_SYMBOLS} from '../active-research-markets';
import {validatePaReport} from './contract';

type Dependencies={getCandles:typeof getCandles;getAnalysisQuote:typeof getAnalysisQuote};
const defaultDeps = {getCandles, getAnalysisQuote};
type Frames = Record<Timeframe,CandleResponse>;
type Snapshot = {core:PaEngine; data:Frames; hash:string};
function snapshotCache(){
 return {frames:new HistoryCache<Frames>(60_000,6), recent:new Map<string,Snapshot>()};
}
const stores=new WeakMap<Dependencies,ReturnType<typeof snapshotCache>>();
export async function paHttp(request:Request,view:'report'|'evidence'|'candles'='report',deps:Dependencies=defaultDeps){
 const p=new URL(request.url).searchParams,symbol=(p.get('symbol')??'EURUSD').toUpperCase(),side=p.get('side')??'bid';
 const json=(body:unknown,status=200,retry=0)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Desk-Contract':PA_CONTRACT,'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*',...(retry?{'Retry-After':String(retry)}:{})}});
 const fail=(code:string,status=400)=>json(paError(symbol,code),status);
 if(!ACTIVE_RESEARCH_SYMBOLS.includes(symbol as typeof ACTIVE_RESEARCH_SYMBOLS[number])||!['bid','ask'].includes(side))return fail('INVALID_REQUEST');
 if(request.method!=='GET'&&request.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 if(['anchor_id','target_id'].some(k=>p.has(k)))return fail('INTERPRETATION_DISABLED');
 const refresh=p.get('refresh')==='1';if(refresh&&request.method!=='POST')return fail('REFRESH_REQUIRES_POST',405);
 if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return fail('ORIGIN_REJECTED',403);
 if(request.method==='POST'&&request.body){const reader=request.body.getReader();try{const first=await reader.read();if(!first.done&&first.value.length)return fail('INTERPRETATION_DISABLED');}catch{return fail('INVALID_REQUEST');}finally{await reader.cancel().catch(()=>{});}}
 const tf=p.get('timeframe')??'H4';if(!PA_TFS.includes(tf as Timeframe))return fail('INVALID_TIMEFRAME');
 const offset=Number(p.get('offset')??0),limit=Number(p.get('limit')??(view==='candles'?50:8));if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>(view==='candles'?200:50))return fail('INVALID_PAGE');
 const from=p.get('from'),to=p.get('to'),asof=p.get('as_of');for(const d of [from,to,asof])if(d&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString()!==d))return fail('INVALID_TIME');if(from&&to&&from>to||asof&&Date.parse(asof)>Date.now())return fail('INVALID_TIME');
 const min=p.get('min_price'),max=p.get('max_price');if([min,max].some(x=>x!==null&&(!Number.isFinite(Number(x))||Number(x)<=0))||min&&max&&Number(min)>Number(max))return fail('INVALID_PRICE_RANGE');
 const id=p.get('id')??p.get('level_id'),pin=p.get('snapshot_sha256');if(id&&id.length>1500||pin&&!/^[a-f0-9]{64}$/.test(pin))return fail('INVALID_REQUEST');
 if(p.has('kind')&&!['FRACTAL','FVG','FVG_CLOSED_BREACH','RAID','TOUCH','RB_TWO_CANDLE','SNR_CLOSED_BREAK','FRACTAL_INSIDE_POI','DEALING_RANGE','PREMIUM_DISCOUNT'].includes(p.get('kind')!))return fail('INVALID_KIND');
 if(offset>0&&!pin)return fail('SNAPSHOT_REQUIRED');
 if(p.has('view')&&!['structure','interactions'].includes(p.get('view')!))return fail('INVALID_VIEW');
 if(p.has('lifecycle')&&!['ACTIVE','CONSUMED','TESTED','INVALIDATED','UNVERIFIED','CANDIDATE','FILLED','PARTIALLY_FILLED'].includes(p.get('lifecycle')!))return fail('INVALID_LIFECYCLE');
 try{
  const market=symbol as typeof ACTIVE_RESEARCH_SYMBOLS[number];
  const ranges:Partial<Record<Timeframe,{high_id:string;low_id:string}>>={};
  for(const t of PA_TFS){const hi=p.get(t==='H4'?'high_id':t.toLowerCase()+'_high_id'),lo=p.get(t==='H4'?'low_id':t.toLowerCase()+'_low_id');if(hi||lo){if(!hi||!lo)return fail('INVALID_RANGE_SELECTION');ranges[t]={high_id:hi,low_id:lo};}}
  let store=stores.get(deps);if(!store){store=snapshotCache();stores.set(deps,store);}
  const scope=JSON.stringify([market,side,ranges,asof]);
  let saved=store.recent.get(scope);
  const policy=freshnessPolicy(process.env);
  // A pinned detail page can continue reading its immutable closed bars.
  const pinned=pin && view!=='report' && !refresh && saved?.hash===pin;
  const currentMs=Date.now(), captured=saved?Date.parse(saved.core.as_of):NaN;
  const reusableHistory=view!=='report' && !refresh && !pin && !asof &&
    currentMs>=captured && currentMs-captured<300_000 && Math.floor(currentMs/14400000)===Math.floor(captured/14400000);
  checkHistoryRequest(request,Boolean(pinned || reusableHistory));
  if(!pinned && !reusableHistory){
   const now=Date.now(), window=Math.min(60,policy.delivery_seconds)*1000;
   const key=market+':'+Math.floor(now/window)+':'+Math.floor(now/14400000);
   const {value:data}=await store.frames.get(key,async()=>{
    const frames={} as Frames;
    for(const t of PA_TFS)frames[t]=await deps.getCandles(market,t,HISTORY[t].limit,refresh);
    return frames;
   },now,refresh);
   if(refresh || !saved || saved.data!==data){
    const core=buildPaEngine(data,side as PriceSide,{...(asof?{as_of:asof}:{}),ranges});
    if(PA_TFS.some(t=>ranges[t]&&core.frames[t].range_selection_error))return fail('INVALID_RANGE_SELECTION');
    saved={core,data,hash:snapshotHash(core)};
    if(store.recent.size>=12&&!store.recent.has(scope))store.recent.delete(store.recent.keys().next().value!);
    store.recent.set(scope,saved);
   }
  }
  const {core,data,hash}=saved!;
  if(pin&&pin!==hash)return fail('SNAPSHOT_CHANGED',409);
  const commit=process.env.VERCEL_GIT_COMMIT_SHA??null;
  if(view==='report'){
   const quote=await deps.getAnalysisQuote(market,undefined,refresh);
   const report=buildPaReport(core,data,quote,new Date().toISOString(),commit);
   validatePaReport(report,symbol);return json(report,report.status==='ERROR'?503:200);
  }
  if(!core.frames[tf as Timeframe].closed_candles && (view==='candles'||p.has('timeframe')))return fail('NO_CLOSED_BARS',503);
  if(!PA_TFS.some(t=>core.frames[t].closed_candles))return fail('NO_CLOSED_BARS',503);
  const base={mode:'PA_ONLY',symbol,price_side:side,as_of:core.as_of,snapshot_sha256:hash,generated_at:new Date().toISOString(),expires_at:new Date(Date.parse(core.as_of)+policy.delivery_seconds*1000).toISOString(),
   source:{provider:'Capital.com',environment:data.H4.environment,analysis_schema:'pa-engine-v6',price_side:side,engine_commit:commit,evidence_sha256:hash,demo_live_equivalence:'NOT_ESTABLISHED',full_ohlc_published:false},
   quote_required:false,last_closed_at:core.frames[tf as Timeframe].last_closed_at,data_quality:core.data_quality,warnings:core.warnings,history_scope:'AVAILABLE_PROVIDER_WINDOW_NOT_FULL_MARKET_HISTORY',source_type:asof?'ARCHIVE_AS_OF':pinned?'PINNED_CLOSED_HISTORY':reusableHistory?'RECENT_CLOSED_HISTORY':'CURRENT_CLOSED_HISTORY',coverage:core.coverage};
  let result:Record<string,unknown>;
  if(view==='candles'){
   const f=core.frames[tf as Timeframe],all=f.ohlc.filter(b=>(!from||b.time>=from)&&(!to||b.time<to));const rows=all.slice(offset,offset+limit).map(b=>({...b,is_closed:true}));
   result={...base,schema_version:'pa-candles-page-v6',timeframe:tf,candles:rows,total:all.length,offset,next_offset:offset+rows.length<all.length?offset+rows.length:null,omitted:all.length-rows.length,complete:rows.length===all.length,diagnostics:f.diagnostics,ohlc_validation:f.ohlc_validation,calendar:f.calendar,aggregation_check:reconcileOhlc(data,tf as Timeframe,side as PriceSide,core.as_of),provider_validation:{discarded_rows:data[tf as Timeframe].metadata.discarded_rows,discarded_sides:data[tf as Timeframe].metadata.discarded_sides,reasons:data[tf as Timeframe].metadata.discarded_reasons,validation_gaps:data[tf as Timeframe].metadata.validation_gaps,reconstructions:data[tf as Timeframe].metadata.aggregation?.reconstructions}};
  }else if(p.get('view')==='structure'){
   result={...base,schema_version:'pa-structure-v6',timeframe:tf,market_structure:core.market_structure[tf as Timeframe],dealing_ranges:core.dealing_ranges.filter(r=>r.timeframe===tf),definitions:core.definitions,omitted:0};
  }else if(p.get('view')==='interactions'){
   if(id&&!core.evidence.some(e=>e.id===id))return fail('EVIDENCE_NOT_IN_SNAPSHOT',404);
   const all=id?interactionsForEvidence(core,id):core.cross_timeframe_interactions,items=all.slice(offset,offset+limit);
   result={...base,schema_version:'pa-interactions-page-v6',interactions:items,total:all.length,offset,next_offset:offset+items.length<all.length?offset+items.length:null,omitted:all.length-items.length,complete:items.length===all.length};
  }else{
   
   const all=core.evidence.filter(e=>(!id||e.id===id)&&(!p.has('timeframe')||e.timeframe===tf)&&(!p.has('kind')||e.kind===p.get('kind'))&&(!p.has('lifecycle')||e.lifecycle?.state===p.get('lifecycle')||(p.get('lifecycle')==='FILLED'&&e.lifecycle?.fill?.max_observed_fraction===1)||(p.get('lifecycle')==='PARTIALLY_FILLED'&&!!e.lifecycle?.fill&&e.lifecycle.fill.max_observed_fraction>0&&e.lifecycle.fill.max_observed_fraction<1))&&(!from||e.confirmed_at>=from)&&(!to||e.confirmed_at<to)&&(min===null||e.bounds!==null&&e.bounds.upper>=Number(min))&&(max===null||e.bounds!==null&&e.bounds.lower<=Number(max)));
   if(id&&!all.length)return fail('EVIDENCE_NOT_IN_SNAPSHOT',404);
   const items=all.slice(offset,offset+(id?1:limit));result={...base,schema_version:'pa-evidence-page-v6',evidence:items,total:all.length,offset,next_offset:offset+items.length<all.length?offset+items.length:null,omitted:all.length-items.length,complete:items.length===all.length,definitions:core.definitions,...(id?{interaction_history:interactionsForEvidence(core,id),cross_timeframe_interactions:core.cross_timeframe_interactions.filter(x=>x.evidence_id===id||x.related_id===id)}:{})};
  }
  if(Buffer.byteLength(JSON.stringify(result))>1_000_000)return fail('PAGE_TOO_LARGE_REDUCE_LIMIT',413);
  return json(result);
 }catch(e){const code=e&&typeof e==='object'&&'code'in e?String(e.code):'';const limited=['RATE_LIMIT','CAPITAL_RATE_LIMIT','HISTORY_RATE_LIMIT','HISTORY_BUSY'].includes(code);console.warn(JSON.stringify({event:'pa_engine_failure',symbol,stage:limited?'http':'provider_or_validation',code:limited?'RATE_LIMIT':'UPSTREAM_OR_EVIDENCE_UNAVAILABLE'}));return json(paError(symbol,limited?'RATE_LIMIT':'UPSTREAM_OR_EVIDENCE_UNAVAILABLE'),limited?429:503,limited?(e && typeof e==='object' && 'retryAfter' in e && typeof e.retryAfter==='number' && e.retryAfter>0?e.retryAfter:60):0);}
}
