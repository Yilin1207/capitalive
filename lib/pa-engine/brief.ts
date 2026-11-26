import {thesisLocation} from './thesis-location';
import {thesisObservations} from './thesis-observations';
import type {Grid} from '../ny-grid';
import {approach,atrD1,fractalsInsideKl,klEvents,nestedIn,premiumDiscount,strongFractals} from './brief-facts';
import {APPROACH_CONFIG} from './approach-config';
import {engineInfo,gridInfo,nearbyLevels,NEARBY_EXCLUDED_STATES,NEARBY_EXCLUDED_EXTRA,NEARBY_GROUPING,NEARBY_KINDS,PA_CONTRACT,PA_MAX_BYTES,PA_TFS,type NearbyLevel,type PaEngine,type PaReport} from './report';

/** Compact, link-rich view of one desk-report snapshot for external AI clients.
 * It reorganizes existing evidence only: no significance, direction or trade fields. */
export const BRIEF_SCHEMA='pa-brief-v1';
export const BRIEF_LEVELS_PER_SIDE=5;
export const BRIEF_CANDLES=5;
/** latest=N for the brief: last N closed candles per TF. */
export const BRIEF_MAX_CANDLES=50;
/** Per-asset size cap inside /api/brief?symbols=... (a single /api/brief keeps the 64 KiB desk cap). */
export const BATCH_BRIEF_MAX_BYTES=200_000;
export const BRIEF_FRACTALS=6;

/** Absolute URLs pinned to one snapshot; a 409 SNAPSHOT_CHANGED means: refetch the brief. */
export function paLinks(origin:string,symbol:string,side:string,snapshot:string,grid:Grid='ny',selection:Record<string,string>={}){
 // ':' is legal in a query string; keeping evidence ids readable also keeps the brief small.
 const url=(path:string,params:Record<string,string>)=>`${origin}${path}?${String(new URLSearchParams({symbol,side,grid,...selection,...params})).replace(/%3A/g,':')}`;
 return {
  brief:url('/api/brief',{}),
  desk_report:url('/api/desk-report',{}),
  market_context:url('/api/desk-report',{view:'market-context'}),
  evidence:(tf?:string)=>url('/api/pa-evidence',{...(tf?{timeframe:tf}:{}),limit:'50',snapshot_sha256:snapshot}),
  candles:(tf:string)=>url('/api/pa-candles',{timeframe:tf,limit:'200',snapshot_sha256:snapshot}),
  thesis:(tf:string,section:string)=>url('/api/pa-evidence',{view:'thesis',timeframe:tf,section,snapshot_sha256:snapshot}),
  structure:(tf:string)=>url('/api/pa-evidence',{view:'structure',timeframe:tf,snapshot_sha256:snapshot}),
  detail:(id:string)=>url('/api/pa-evidence',{id,snapshot_sha256:snapshot}),
  docs:`${origin}/llms.txt`,
 };
}

export function buildPaBrief(report:PaReport,core:PaEngine,origin:string,grid:Grid='ny',options:{candles?:number;maxBytes?:number;selection?:Record<string,string>}={}){
 const candles=options.candles??BRIEF_CANDLES,maxBytes=options.maxBytes??PA_MAX_BYTES;
 const available=report.coverage.observations_available,snapshot=report.snapshot_sha256;
 const link=paLinks(origin,core.symbol,core.side,snapshot,grid,options.selection);
 const nearby=available?nearbyLevels(core,BRIEF_LEVELS_PER_SIDE):null;
 const lifecycle=new Map(core.evidence.map(e=>[e.id,e.lifecycle?.state??null]));
 const atr=available?atrD1(core):null;
 // One detail URL per grouped evidence id, in `ids` order; distance also in D1 ATR; live higher-TF zones containing the level.
 const withUrl=(tf:(typeof PA_TFS)[number])=>(x:NearbyLevel)=>({...x,urls:x.ids.map(link.detail),distance_atr_d1:atr?Number((x.distance/atr.value).toFixed(4)):null,nested_in:nestedIn(core,tf,x),kl_events:klEvents(core,x)});
 let levelsOmitted=0;
 const timeframes=Object.fromEntries(PA_TFS.map(tf=>{
  const f=core.frames[tf],n=nearby?.block.timeframes[tf]??null,dr=report.dealing_ranges.find(r=>r.timeframe===tf);
  const eligible=n?n.eligible.above+n.eligible.below+n.eligible.at_price:0,included=n?n.above.length+n.below.length+n.at_price.length:0;
  levelsOmitted+=eligible-included;
  const kinds:Record<string,number>={};
  if(available)for(const e of core.evidence)if(e.timeframe===tf)kinds[e.kind]=(kinds[e.kind]??0)+1;
  return [tf,{
   timeframe:tf,grid:f.grid,data_quality:f.data_quality,warnings:f.warnings,last_closed_at:f.last_closed_at,closed_candles:f.closed_candles,
   last_closed_candles:f.ohlc.slice(-candles).map(b=>({time:b.time,closed_at:b.end,open:b.open,high:b.high,low:b.low,close:b.close})),
   dealing_range:dr?{active_dr:dr.active_dr,htf_priority:dr.htf_priority,status:dr.status,current:dr.current,current_h4_position:dr.current_h4_position,reference:dr.reference,
    premium_discount:premiumDiscount({...dr,explicit_range:core.dealing_ranges.find(r=>r.timeframe===tf)?.explicit_range},nearby?.block.reference.price??null)}:null,
   levels:n?{above:n.above.map(withUrl(tf)),below:n.below.map(withUrl(tf)),at_price:n.at_price.map(withUrl(tf)),eligible:n.eligible,omitted:eligible-included}:null,
   approach:available?approach(core,tf,atr?.value??null,n):null,
   strong_fractals:available?strongFractals(core,tf):null,
   fractals_inside_kl:available?fractalsInsideKl(core,tf):null,
   recent_fractals:available?core.market_structure[tf].swing_sequence.slice(-BRIEF_FRACTALS).map(p=>({id:p.id,polarity:p.polarity,price:p.price,confirmed_at:p.confirmed_at,relation:p.relation,state:lifecycle.get(p.id)??null,url:link.detail(p.id)})):null,
   findings_by_kind:available?kinds:null,
   links:{evidence:link.evidence(tf),candles:link.candles(tf),structure:link.structure(tf)},
  }];
 }));
 const brief={
  schema_version:BRIEF_SCHEMA,contract_revision:PA_CONTRACT,mode:'PA_ONLY',technical_only:true,
  symbol:core.symbol,price_side:core.side,grid:gridInfo(core,grid),engine:engineInfo(report.source.engine_commit),status:report.status,data_quality:report.data_quality,observations_available:available,
  generated_at:report.generated_at,as_of:report.as_of,expires_at:report.expires_at,snapshot_sha256:snapshot,
  source:report.source,quote:report.quote,freshness:report.freshness,warnings:report.warnings,
  reference:nearby?.block.reference??null,atr_d1:atr,approach_config:{...APPROACH_CONFIG,status:Object.values(APPROACH_CONFIG).includes(null)?'NEEDS_SPECIFICATION':'USER_APPROVED'},
  selection_policy:{levels:'NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE',recent_fractals:'MOST_RECENT_CONFIRMED_NOT_SIGNIFICANCE',last_closed_candles:'LAST_CLOSED_BARS',last_closed_candles_per_tf:candles},
  level_rules:{kinds:[...NEARBY_KINDS],grouping:NEARBY_GROUPING,limit_applies_to:'GROUPED_LEVELS',excluded_states:[...NEARBY_EXCLUDED_STATES,...NEARBY_EXCLUDED_EXTRA],state_field:'lifecycle.state',per_side_limit:BRIEF_LEVELS_PER_SIDE,distance_unit:'PRICE',distance_atr_d1:'distance / atr_d1.value (unit only)',nested_in:'LIVE_HIGHER_TF_RB_SNR_FVG_CONTAINS_LEVEL_GEOMETRY_ONLY',strong_fractals:'THE EDGE Strong High/Low (HRL) facts as two separate flags: VC_AT_FRACTAL = RB/SNR of the same TF formed on one of the fractal candles; RAIDED_PRIOR_FRACTAL = a fractal candle was the first strict crossing of an earlier same-polarity fractal; component observations only; Q10 classifications are in thesis_inputs.opposite_side',fractals_inside_kl:'Fractals of this TF inside a live KL of the same or next higher TF (X-1 trigger geometry); see thesis_inputs.execution for confirmed Fractals inside the active DR',kl_events:'CLOSED_CANDLES_OWN_AND_LOWER_TF_AFTER_FORMATION: TOUCH inside / REJECTION close back beyond near edge / ACCEPTANCE close beyond far edge / RAID fractal wick beyond, close back; colour and wick share are not criteria',fvg_bounds:'UNFILLED_REMAINDER'},
  thesis_inputs:available?{as_of:core.as_of,...thesisLocation(core),...thesisObservations(core)}:null,
  timeframes,
  coverage:{findings_total:core.evidence.length,history_scope:'AVAILABLE_PROVIDER_WINDOW_NOT_FULL_MARKET_HISTORY',all_findings_via:'links.evidence_all'},
  omitted:{levels:levelsOmitted,levels_size_trimmed:0,fact_details_size_trimmed:[] as string[],findings_not_listed:'ALL_FINDINGS_PAGINATED_VIA_LINKS'},
  definitions:core.definitions,
  links:{self:link.brief,desk_report:link.desk_report,market_context:link.market_context,evidence_all:link.evidence(),...Object.fromEntries(PA_TFS.map(tf=>['thesis_idm_'+tf.toLowerCase(),link.thesis(tf,'idm')])),thesis_events_d1:link.thesis('D1','kl_events'),thesis_events_w1:link.thesis('W1','kl_events'),docs:link.docs},
  trading_enabled:false as const,
 };
 // Size fallback 1: fact details yield before levels (counts and totals stay; listed in omitted).
 const tooLarge=()=>Buffer.byteLength(JSON.stringify(brief))+1>maxBytes;
 const steps:[string,()=>void][]=[
  ['KL_EVENTS_LAST',()=>{for(const t of Object.values(brief.timeframes))if(t.levels)for(const l of [...t.levels.above,...t.levels.below,...t.levels.at_price])if(l.kl_events)l.kl_events.last=[];}],
  ['STRONG_FRACTALS_AND_INSIDE_KL_ITEMS_BEYOND_FIRST',()=>{for(const t of Object.values(brief.timeframes)){t.strong_fractals?.items.splice(1);t.fractals_inside_kl?.items.splice(1);}}],
 ];
 for(const [name,apply] of steps){if(!tooLarge())break;apply();brief.omitted.fact_details_size_trimmed.push(name);}
 // Size fallback 2: drop the farthest shown level across all TFs (ties: later id first); counted in omitted.
 while(Buffer.byteLength(JSON.stringify(brief))+1>maxBytes){
  let worst:{levels:{omitted:number};list:{distance:number;id:string}[]}|null=null;
  for(const t of Object.values(brief.timeframes))if(t.levels)for(const list of [t.levels.above,t.levels.below,t.levels.at_price]){
   const item=list.at(-1),w=worst?.list.at(-1);
   if(item&&(!w||item.distance>w.distance||item.distance===w.distance&&item.id>w.id))worst={levels:t.levels,list};
  }
  if(!worst)break;
  worst.list.pop();worst.levels.omitted++;brief.omitted.levels++;brief.omitted.levels_size_trimmed++;
 }
 // Large explicit candle windows keep all requested OHLC. Optional lists can be
 // read from the pinned pages; record each omission rather than truncating candles.
 if(tooLarge()){
  for(const t of Object.values(brief.timeframes))if(t.recent_fractals)t.recent_fractals.length=0;
  brief.omitted.fact_details_size_trimmed.push('RECENT_FRACTALS_USE_STRUCTURE_LINKS');
 }
 if(tooLarge()&&brief.thesis_inputs){
  const {execution,opposite_side}=brief.thesis_inputs;
  for(const list of Object.values(execution.idm)){list.items.length=0;list.omitted=list.total;}
  for(const tf of ['D1','W1'] as const)for(const list of Object.values(opposite_side[tf]))list.items.length=0;
  opposite_side.strong_near_price.items.length=0;
  brief.omitted.fact_details_size_trimmed.push('THESIS_ITEMS_USE_PINNED_PAGES');
 }
 if(tooLarge())throw Error('BRIEF_TOO_LARGE');
 return brief;
}
export type PaBrief=ReturnType<typeof buildPaBrief>;
