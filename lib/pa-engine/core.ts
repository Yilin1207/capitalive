import {createHash} from 'node:crypto';
import type {CandleResponse,PriceSide,Timeframe} from '../candle-data';
import {closedFrame,type Frame,type Bar} from '../knowledge/data';
import {TF_ORDER,detectFractals,detectFvg,detectRaids,detectRejectionBlocks,detectSnr,detectIdm,selectRange,pivotLevels,type Finding,type KeyLevel} from '../knowledge/detectors';
import {detectDealingRange} from '../knowledge/dealing-range';
import {assessLevel,contextualLevels,type LevelState} from '../knowledge/level-state';
import {fvgTestTimeline,currentBounds} from '../knowledge/fvg-remaining';
import {calendarDiagnostics} from '../research/calendars';
import type {BarGrid} from '../ny-grid';
/** Grid of the bars actually analysed; captures without metadata.grid are on the provider UTC grid. */
export const barGrid=(d:CandleResponse):BarGrid=>d.metadata.grid??(d.timeframe==='MN1'?'utc_calendar':d.timeframe==='W1'?'utc_week':'utc');

export const PA_ENGINE_REVISION='pa-only-6.0.0';
export type PaOptions={as_of?:string;ranges?:Partial<Record<Timeframe,{high_id:string;low_id:string}>>};
export type PaEvidence=Finding&{
 symbol:string;price_side:PriceSide;bounds:{lower:number;upper:number}|null;remaining_bounds:{lower:number;upper:number}|null;
 formation_status:'CONFIRMED'|'NEEDS_SPECIFICATION';lifecycle:LevelState|null;
 role_status:string;current_role:'support'|'resistance'|null;formation_role:'support'|'resistance'|null;
 evaluated_through:string;limitations:string[];
};
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);

/** Separate arithmetic implementation checks normalized rows; it does not claim
 * independent market-price truth or a verified broker historical session calendar. */
export function verifyOhlc(data:CandleResponse,side:PriceSide,asOf:string){
 const failures:{time:string;reason:string}[]=[];
 const rows=data.candles;let previous=-Infinity;
 for(const c of rows){const t=Date.parse(c.time),date=new Date(t),end=data.timeframe==='MN1'?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1):t+({W1:604800,D1:86400,H4:14400}[data.timeframe])*1000;
  const o=c.open[side],h=c.high[side],l=c.low[side],v=c.close[side];
  if(!Number.isFinite(t)||t<=previous)failures.push({time:c.time,reason:'NON_INCREASING_OR_INVALID_TIME'});
  if(![o,h,l,v].every(x=>finite(x)&&x>0)||l!>Math.min(o!,v!)||h!<Math.max(o!,v!))failures.push({time:c.time,reason:'INVALID_OHLC_GEOMETRY'});
  if(['open','high','low','close'].some(k=>{const p=c[k as 'open'];return p.bid!==null&&p.ask!==null&&p.bid>p.ask;}))failures.push({time:c.time,reason:'CROSSED_BID_ASK'});
  if(c.is_closed&&(end>Date.parse(asOf)||end>Date.parse(data.fetched_at)))failures.push({time:c.time,reason:'CLOSED_FLAG_BEFORE_NOMINAL_END'});
  if(data.timeframe==='MN1'&&(date.getUTCDate()!==1||date.getUTCHours()!==0||date.getUTCMinutes()!==0))failures.push({time:c.time,reason:'NON_CALENDAR_MONTH_START'});
  previous=t;
 }
 return {revision:'normalized-ohlc-invariants-v1',checked_rows:rows.length,status:failures.length?'LIMITATIONS_FOUND':'ARITHMETIC_CHECKS_PASS',failures,
  independent_price_comparison:'NOT_AVAILABLE',historical_session_calendar:'NOT_INDEPENDENTLY_VERIFIED',closure_semantics:data.metadata.closure_basis,
  limitations:['Checks normalized provider data, not a second market-price source.','D1/W1 bucket closure is provider UTC nominal duration; historical session and holiday completeness are not proven.']};
}

/** Remove legacy significance proxies while retaining exact formation evidence. */
function observation(f:Finding):Finding{
 const facts={...f.facts};
 const neutral={...f,counterarguments:f.counterarguments.filter(s=>!/narrative|entry|target|stop|profit|risk|trade|probability/i.test(s))};
 if(f.kind==='SNR_CLOSED_BREAK'){
  const q=facts.formation as Record<string,unknown>|undefined;
  if(q)facts.formation=Object.fromEntries(Object.entries(q).filter(([k])=>!['relative_strength','strength_policy','impulse_policy','impulse_detected','impulse_evidence','probability','prior_body_sample','body_to_prior_median','impulse_leg_body_to_median'].includes(k)));
  facts.significance='NEEDS_SPECIFICATION';
 }
 if(f.kind==='RB_TWO_CANDLE'){delete facts.relative_quality;delete facts.quality_is_probability;facts.significance='NEEDS_SPECIFICATION';}
 if(f.kind==='IDM_INSIDE_POI')return {...neutral,kind:'FRACTAL_INSIDE_POI',facts:{...facts,classification:'GEOMETRIC_OVERLAP_ONLY',idm_status:'NEEDS_SPECIFICATION'},state:'NEEDS_SPECIFICATION',specification:'NEEDS_SPECIFICATION',invalidation:'Geometric containment does not establish IDM significance.'};
 return {...neutral,facts,invalidation:f.kind==='RAID'||f.kind==='TOUCH'?'Strict crossing consumes liquidity; equality is a touch; neither proves a new support/resistance role.':f.kind==='RB_TWO_CANDLE'?'Closed two-candle formation; subsequent role and significance remain unverified.':f.kind==='SNR_CLOSED_BREAK'?'Own-TF counter-close withdraws the proposed role; no automatic role reversal.':f.invalidation};
}

function boundsOf(f:Finding,l?:KeyLevel){
 if(l)return {lower:l.lower,upper:l.upper};
 if(finite(f.facts.lower)&&finite(f.facts.upper))return {lower:f.facts.lower,upper:f.facts.upper};
 if(finite(f.facts.price))return {lower:f.facts.price,upper:f.facts.price};
 const q=f.facts.junction as {lower:number;upper:number}|undefined;return q&&finite(q.lower)&&finite(q.upper)?q:null;
}

function swingSequence(pivots:ReturnType<typeof detectFractals>){
 let high:number|null=null,low:number|null=null,segment:number|null=null;
 return [...pivots].sort((a,b)=>a.confirmed_at.localeCompare(b.confirmed_at)||a.id.localeCompare(b.id)).map(p=>{
  if(segment!==p.segment){high=null;low=null;segment=p.segment;}
  const old=p.polarity==='high'?high:low;
  const relation=old===null?'FIRST_OBSERVED':p.price===old?'EQUAL':p.polarity==='high'?(p.price>old?'HH':'LH'):(p.price>old?'HL':'LL');
  if(p.polarity==='high')high=p.price;else low=p.price;
  return {id:p.id,polarity:p.polarity,price:p.price,origin:p.origin,confirmed_at:p.confirmed_at,segment:p.segment,relation};
 });
}

/** All active PA analysis is composed here, without importing interpretation engines. */
export function buildPaEngine(data:Record<Timeframe,CandleResponse>,side:PriceSide,options:PaOptions={}){
 if(!['bid','ask'].includes(side)||TF_ORDER.some(tf=>!data[tf]||data[tf].timeframe!==tf||data[tf].provider!=='Capital.com'||!Number.isFinite(Date.parse(data[tf].fetched_at)))||new Set(TF_ORDER.map(tf=>data[tf].symbol)).size!==1||new Set(TF_ORDER.map(tf=>data[tf].environment)).size!==1)throw Error('INVALID_DATASET_IDENTITY');
 const fetched=TF_ORDER.map(tf=>data[tf].fetched_at).sort()[0];
 if(options.as_of&&!Number.isFinite(Date.parse(options.as_of)))throw Error('INVALID_AS_OF');
 const asOf=options.as_of&&options.as_of<fetched?options.as_of:fetched;
 const frames=Object.fromEntries(TF_ORDER.map(tf=>[tf,closedFrame(data[tf],side,asOf)])) as Record<Timeframe,Frame>;
 const bases=TF_ORDER.map(tf=>{const frame=frames[tf],pivots=detectFractals(frame,3),fvg=detectFvg(frame);return {tf,frame,pivots,fvg};});
 const levels:KeyLevel[]=bases.flatMap(b=>[...pivotLevels(b.pivots),...b.fvg.levels].map(l=>{
  const origin=b.frame.bars.find(c=>c.end===l.confirmed_at),segment=b.frame.bars.filter(c=>c.segment===origin?.segment);
  return {...l,continuity_end:origin?.segment===b.frame.bars.at(-1)?.segment?asOf:segment.at(-1)?.end??l.confirmed_at};
 }));
 for(const l of levels)if(l.kind==='FVG')l.fvg_test_steps=fvgTestTimeline(l,Object.values(frames));
 const rows=bases.map(({tf,frame,pivots,fvg})=>{
  const context=levels.filter(l=>TF_ORDER.indexOf(l.timeframe)<=TF_ORDER.indexOf(tf));
  const explicit=selectRange(frame,pivots,options.ranges?.[tf]);
  const detected=detectDealingRange(frame,pivots,context);
  const {narrative_confirmed,significance,...dr}=detected;void narrative_confirmed;void significance;
  const findings=[...pivots,...fvg.findings,...detectRaids(frame,pivots),...detectRejectionBlocks(frame,context),...detectSnr(frame,context,levels,false),...detectIdm(frame,pivots,context),...explicit.findings].map(observation);
  return {tf,frame,pivots,findings,dr,explicit};
 });
 const findings=rows.flatMap(r=>r.findings),detected=[...levels,...contextualLevels(findings)],byId=new Map(detected.map(l=>[l.id,l]));
 const through=frames.H4.bars.at(-1)?.end??asOf;
 const states=new Map(detected.map(l=>{
  const state=assessLevel(l,frames,asOf,through);
  if(l.kind==='RB'||l.kind==='SNR'){
   const ownBreak=frames[l.timeframe].bars.find(b=>b.time>=l.confirmed_at&&b.end<=through&&(l.role==='support'?b.close<l.lower:b.close>l.upper));
   if(ownBreak){state.state='INVALIDATED';state.invalidated_at=ownBreak.end;state.current_role=null;state.role_status='UNVERIFIED';}
  }
  return [l.id,state] as const;
 }));
 const evidence:PaEvidence[]=findings.map(f=>{
  const l=byId.get(f.id),raw=states.get(f.id),role=raw?.role_status==='RETEST_CONFIRMED'?raw.current_role:null;
  // ORIGINAL_GEOMETRY is a formation description, never proven support/resistance.
  const lifecycle=raw?{...raw,current_role:role,counterarguments:raw.counterarguments.filter(s=>!/narrative|entry|target|stop|profit|risk|trade|probability/i.test(s))}:null;
  const bounds=boundsOf(f,l),remaining=l&&raw&&l.kind==='FVG'?raw.fill?.remaining??null:bounds;
  return {...f,symbol:data.H4.symbol,price_side:side,bounds,remaining_bounds:remaining,formation_status:f.state==='NEEDS_SPECIFICATION'?'NEEDS_SPECIFICATION':'CONFIRMED',lifecycle,role_status:raw?.role_status??'UNVERIFIED',current_role:role,formation_role:l?.role??null,evaluated_through:through,limitations:[...new Set([...f.counterarguments,...frames[f.timeframe].warnings,...(raw?.counterarguments??[])])]};
 });
 const outputFrames=Object.fromEntries(rows.map(({tf,frame,findings,explicit})=>[tf,{timeframe:tf,grid:barGrid(data[tf]),as_of:asOf,data_quality:frame.status,warnings:frame.warnings,diagnostics:frame.diagnostics??[],last_closed_at:frame.bars.at(-1)?.end??null,closed_candles:frame.bars.length,ohlc:frame.bars,evidence_ids:findings.map(f=>f.id),calendar:calendarDiagnostics(data[tf]),ohlc_validation:verifyOhlc(data[tf],side,asOf),range_selection_error:options.ranges?.[tf]?explicit.reason:null}])) as Record<Timeframe,{timeframe:Timeframe;grid:BarGrid;as_of:string;data_quality:Frame['status'];warnings:string[];diagnostics:NonNullable<Frame['diagnostics']>;last_closed_at:string|null;closed_candles:number;ohlc:Bar[];evidence_ids:string[];calendar:ReturnType<typeof calendarDiagnostics>;ohlc_validation:ReturnType<typeof verifyOhlc>;range_selection_error:string|null}>;
 const marketStructure=Object.fromEntries(rows.map(({tf,frame,pivots,dr})=>[tf,{liquidity_position_context:dr.status==='ESTABLISHED'&&dr.current?{high_id:dr.current.high_id,low_id:dr.current.low_id,confirmed_at:dr.current.confirmed_at,evaluated_through:frame.bars.at(-1)?.end??asOf,scope:'CURRENT_ESTABLISHED_DR',semantics:'PRICE_POSITION_ONLY_NOT_AVAILABLE_LIQUIDITY_OR_IDM'}:null,fractal_sequence:pivots.map(p=>({id:p.id,polarity:p.polarity,price:p.price,origin:p.origin,confirmed_at:p.confirmed_at,segment:p.segment,range_position:dr.status!=='ESTABLISHED'||!dr.current?'UNVERIFIED':p.price===dr.current.lower||p.price===dr.current.upper?'BOUNDARY':p.price>dr.current.lower&&p.price<dr.current.upper?'INTERNAL':'EXTERNAL'})),swing_sequence:swingSequence(pivots),structural_boundaries:dr.current?{high_id:dr.current.high_id,low_id:dr.current.low_id,lower:dr.current.lower,upper:dr.current.upper}:null,observed_closes:dr.current?frame.bars.filter(b=>b.time>=dr.current!.confirmed_at&&(b.close<dr.current!.lower||b.close>dr.current!.upper)).map(b=>({time:b.time,closed_at:b.end,close:b.close,relative_to_range:b.close<dr.current!.lower?'BELOW':'ABOVE'})):[],interpretation:'HISTORICAL_OBSERVATIONS_ONLY'}]));
 const lifecycleEvents=evidence.flatMap(e=>{const s=e.lifecycle;if(!s)return [];return [s.first_raid,s.last_test,s.reaction,s.lower_tf_breach].filter((x):x is NonNullable<typeof x>=>!!x).map(x=>({evidence_id:e.id,...x}));});
 const interactions=findings.flatMap(f=>['kl_id','pivot_id','poi_id','rb_liquidity_id','rb_fvg_id','snr_x1_fvg_id','snr_opposing_kl_id'].flatMap(key=>{
  const id=f.facts[key];const target=typeof id==='string'?byId.get(id):null;
  return target&&target.timeframe!==f.timeframe?[{evidence_id:f.id,related_id:target.id,relationship:key,timeframe:f.timeframe,related_timeframe:target.timeframe,confirmed_at:f.confirmed_at}]:[];
 }));
 const warnings=[...new Set(TF_ORDER.flatMap(tf=>frames[tf].warnings))];
 const fingerprint=createHash('sha256').update(JSON.stringify({revision:PA_ENGINE_REVISION,side,as_of:asOf,frames:outputFrames,ranges:options.ranges??{}})).digest('hex');
 return {schema_version:'pa-engine-v6' as const,mode:'PA_ONLY' as const,revision:PA_ENGINE_REVISION,symbol:data.H4.symbol,side,as_of:asOf,evaluated_through:through,input_sha256:fingerprint,frames:outputFrames,evidence,market_structure:marketStructure,
  dealing_ranges:rows.map(({tf,dr,explicit})=>({timeframe:tf,...dr,explicit_range:explicit.range,reference:{price:frames[tf].bars.at(-1)?.close??null,at:frames[tf].bars.at(-1)?.end??null,basis:'LAST_CLOSED_OWN_TF' as const},current_h4_position:dr.status==='ESTABLISHED'&&dr.current&&frames.H4.bars.length?(frames.H4.bars.at(-1)!.close<dr.current.lower||frames.H4.bars.at(-1)!.close>dr.current.upper?'OUTSIDE':frames.H4.bars.at(-1)!.close<dr.current.equilibrium?'DISCOUNT':frames.H4.bars.at(-1)!.close>dr.current.equilibrium?'PREMIUM':'EQUILIBRIUM'):null})),
  lifecycle_events:lifecycleEvents,cross_timeframe_interactions:interactions,coverage:{evidence_total:evidence.length,closed_candles_total:TF_ORDER.reduce((n,tf)=>n+frames[tf].bars.length,0),history_complete:false,scope:'FINITE_CLOSED_PROVIDER_WINDOW',interaction_history:'SUMMARY_EVENTS; FULL_OBSERVED_CONTACTS_BY_EVIDENCE_ID'},warnings,omitted:{evidence:0,ohlc:0,interaction_history:'FULL_CONTACTS_REQUIRE_EVIDENCE_DETAIL'},data_quality:TF_ORDER.some(tf=>frames[tf].status==='UNVERIFIED')?'UNVERIFIED':'PARTIAL',
  definitions:{fractal:'AUTHOR_FRACTAL_3_ONLY',idm:'NEEDS_SPECIFICATION',compression_lrl:'NEEDS_SPECIFICATION',approach_character:'FACTS_ONLY_THRESHOLDS_NEEDS_SPECIFICATION',rb_from_fvg_without_body_close:'OPEN_QUESTION_USER_DECISION',strong_high_low:'NEEDS_SPECIFICATION',internal_external_liquidity:'GEOMETRIC_POSITION_RELATIVE_TO_ESTABLISHED_DR_ONLY',significance:'NOT_EVALUATED',numerical_strength_thresholds:'DISABLED',independent_ohlc_price_validation:'NOT_AVAILABLE'},trading_enabled:false};
}
export type PaEngine=ReturnType<typeof buildPaEngine>;

/** Unabridged contacts inside the finite closed input window, available on demand. */
export function interactionsForEvidence(engine:PaEngine,id:string){
 const evidence=engine.evidence.find(e=>e.id===id);if(!evidence||!evidence.bounds)return [];
 const {lower,upper}=evidence.bounds;
 const beyond=(b:Bar)=>evidence.formation_role==='support'?b.low<lower:evidence.formation_role==='resistance'?b.high>upper:false;
 const closedBeyond=(b:Bar)=>evidence.formation_role==='support'?b.close<lower:evidence.formation_role==='resistance'?b.close>upper:false;
 return TF_ORDER.slice(TF_ORDER.indexOf(evidence.timeframe)).flatMap(tf=>engine.frames[tf].ohlc.filter(b=>b.time>=evidence.confirmed_at&&b.end<=engine.evaluated_through&&(b.high>=lower&&b.low<=upper||beyond(b))).map(b=>({evidence_id:id,timeframe:tf,time:b.time,confirmed_at:b.end,kind:beyond(b)?'STRICT_CROSSING':'CONTACT',own_timeframe:tf===evidence.timeframe,own_tf_close_breach:tf===evidence.timeframe&&closedBeyond(b),candle:{open:b.open,high:b.high,low:b.low,close:b.close},close_position:b.close<lower?'BELOW':b.close>upper?'ABOVE':'WITHIN',role_reversal_confirmed:false}))).sort((a,b)=>a.confirmed_at.localeCompare(b.confirmed_at)||TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe));
}
