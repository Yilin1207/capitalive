import type {Grid} from '../ny-grid';
import {atrD1,nestedIn,premiumDiscount} from './brief-facts';
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
export function paLinks(origin:string,symbol:string,side:string,snapshot:string,grid:Grid='ny'){
 // ':' is legal in a query string; keeping evidence ids readable also keeps the brief small.
 const url=(path:string,params:Record<string,string>)=>`${origin}${path}?${String(new URLSearchParams({symbol,side,grid,...params})).replace(/%3A/g,':')}`;
 return {
  brief:url('/api/brief',{}),
  desk_report:url('/api/desk-report',{}),
  market_context:url('/api/desk-report',{view:'market-context'}),
  evidence:(tf?:string)=>url('/api/pa-evidence',{...(tf?{timeframe:tf}:{}),limit:'50',snapshot_sha256:snapshot}),
  candles:(tf:string)=>url('/api/pa-candles',{timeframe:tf,limit:'200',snapshot_sha256:snapshot}),
  structure:(tf:string)=>url('/api/pa-evidence',{view:'structure',timeframe:tf,snapshot_sha256:snapshot}),
  detail:(id:string)=>url('/api/pa-evidence',{id,snapshot_sha256:snapshot}),
  docs:`${origin}/llms.txt`,
 };
}

export function buildPaBrief(report:PaReport,core:PaEngine,origin:string,grid:Grid='ny',options:{candles?:number;maxBytes?:number}={}){
 const candles=options.candles??BRIEF_CANDLES,maxBytes=options.maxBytes??PA_MAX_BYTES;
 const available=report.coverage.observations_available,snapshot=report.snapshot_sha256;
 const link=paLinks(origin,core.symbol,core.side,snapshot,grid);
 const nearby=available?nearbyLevels(core,BRIEF_LEVELS_PER_SIDE):null;
 const lifecycle=new Map(core.evidence.map(e=>[e.id,e.lifecycle?.state??null]));
 const atr=available?atrD1(core):null;
 // One detail URL per grouped evidence id, in `ids` order; distance also in D1 ATR; live higher-TF zones containing the level.
 const withUrl=(tf:(typeof PA_TFS)[number])=>(x:NearbyLevel)=>({...x,urls:x.ids.map(link.detail),distance_atr_d1:atr?Number((x.distance/atr.value).toFixed(4)):null,nested_in:nestedIn(core,tf,x)});
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
   dealing_range:dr?{status:dr.status,current:dr.current,current_h4_position:dr.current_h4_position,reference:dr.reference,
    premium_discount:premiumDiscount({...dr,explicit_range:core.dealing_ranges.find(r=>r.timeframe===tf)?.explicit_range},nearby?.block.reference.price??null)}:null,
   levels:n?{above:n.above.map(withUrl(tf)),below:n.below.map(withUrl(tf)),at_price:n.at_price.map(withUrl(tf)),eligible:n.eligible,omitted:eligible-included}:null,
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
  reference:nearby?.block.reference??null,atr_d1:atr,
  selection_policy:{levels:'NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE',recent_fractals:'MOST_RECENT_CONFIRMED_NOT_SIGNIFICANCE',last_closed_candles:'LAST_CLOSED_BARS',last_closed_candles_per_tf:candles},
  level_rules:{kinds:[...NEARBY_KINDS],grouping:NEARBY_GROUPING,limit_applies_to:'GROUPED_LEVELS',excluded_states:[...NEARBY_EXCLUDED_STATES,...NEARBY_EXCLUDED_EXTRA],state_field:'lifecycle.state',per_side_limit:BRIEF_LEVELS_PER_SIDE,distance_unit:'PRICE',distance_atr_d1:'distance / atr_d1.value (unit only)',nested_in:'LIVE_HIGHER_TF_RB_SNR_FVG_CONTAINS_LEVEL_GEOMETRY_ONLY',fvg_bounds:'UNFILLED_REMAINDER'},
  timeframes,
  coverage:{findings_total:core.evidence.length,history_scope:'AVAILABLE_PROVIDER_WINDOW_NOT_FULL_MARKET_HISTORY',all_findings_via:'links.evidence_all'},
  omitted:{levels:levelsOmitted,levels_size_trimmed:0,findings_not_listed:'ALL_FINDINGS_PAGINATED_VIA_LINKS'},
  definitions:core.definitions,
  links:{self:link.brief,desk_report:link.desk_report,market_context:link.market_context,evidence_all:link.evidence(),docs:link.docs},
  trading_enabled:false as const,
 };
 // Size fallback: drop the farthest shown level across all TFs (ties: later id first); counted in omitted.
 while(Buffer.byteLength(JSON.stringify(brief))+1>maxBytes){
  let worst:{levels:{omitted:number};list:{distance:number;id:string}[]}|null=null;
  for(const t of Object.values(brief.timeframes))if(t.levels)for(const list of [t.levels.above,t.levels.below,t.levels.at_price]){
   const item=list.at(-1),w=worst?.list.at(-1);
   if(item&&(!w||item.distance>w.distance||item.distance===w.distance&&item.id>w.id))worst={levels:t.levels,list};
  }
  if(!worst)throw Error('BRIEF_TOO_LARGE');
  worst.list.pop();worst.levels.omitted++;brief.omitted.levels++;brief.omitted.levels_size_trimmed++;
 }
 return brief;
}
export type PaBrief=ReturnType<typeof buildPaBrief>;
