import type {Frame,Bar} from './data';
import {TF_ORDER,type Finding,type KeyLevel,type Range} from './detectors';
import type {LevelState} from './level-state';
import {currentBounds,levelAt} from './fvg-remaining';

export const TDA_REVISION='tda-notion-1';
const order=(tf:string)=>TF_ORDER.indexOf(tf as Frame['timeframe']);
const overlap=(a:{low:number;high:number},b:{lower:number;upper:number})=>a.low<=b.upper&&a.high>=b.lower;
const direction=(f:Finding)=>f.facts.direction==='bullish'||f.facts.proposed_role==='support'?'support':f.facts.direction==='bearish'||f.facts.proposed_role==='resistance'?'resistance':null;
const ids=(xs:Finding[])=>[...new Set(xs.map(x=>x.id))];
type RangeRow={timeframe:Frame['timeframe'];range:Range|null;state:string};

/** Research relationships, not trade qualification or a probability score.
 * Event-time geometry is distinct from today's unfilled FVG remainder. */
export function tdaRelationships(frames:Record<Frame['timeframe'],Frame>,findings:Finding[],levels:KeyLevel[],states:LevelState[],ranges:RangeRow[],reference:number|null){
 const stateById=new Map(states.map(s=>[s.id,s]));
 const closed=findings.filter(f=>f.confirmed_at<=frames[f.timeframe].as_of&&f.candle_evidence.every(c=>c.closed_at<=f.confirmed_at));
 const pa=closed.filter(f=>['RB_TWO_CANDLE','SNR_CLOSED_BREAK','FVG'].includes(f.kind));
 const pivots=closed.filter(f=>f.kind==='FRACTAL'&&f.facts.variant===3);
 const known=(l:KeyLevel,at:string)=>l.confirmed_at<=at&&(!l.invalidated_at||l.invalidated_at>at)?levelAt(l,at):null;
 function relation(l:KeyLevel,f:Finding){
  const start=f.candle_evidence[0]?.time??f.origin,k=known(l,start);
  if(!k||f.side!==l.side||direction(f)!==l.role||!f.candle_evidence.some(c=>c.time>=l.confirmed_at&&overlap(c,k)))return false;
  return !l.continuity_end||f.confirmed_at<=l.continuity_end;
 }
 const anchors=levels.filter(l=>['MN1','W1','D1','H4'].includes(l.timeframe)).map(l=>{
  const s=stateById.get(l.id)!;const current=currentBounds(l,s),rank=order(l.timeframe),next=TF_ORDER[rank+1];
  const usable=!!s&&s.coverage==='COMPLETE_OBSERVED_INTERVAL'&&s.confirmed_at<=frames[l.timeframe].as_of&&
   (l.kind==='FVG'?s.state==='ACTIVE':l.kind==='FRACTAL'?['ACTIVE','CONSUMED'].includes(s.state):['ACTIVE','CANDIDATE'].includes(s.state));
  const observations=TF_ORDER.slice(rank,rank+2).flatMap(tf=>frames[tf].bars.filter(b=>{const k=known(l,b.time);return k&&b.end<=s.evaluated_through&&overlap(b,k);}).map(b=>({tf,b}))).sort((a,b)=>a.b.end.localeCompare(b.b.end));
  const contact=observations.at(-1),inside=reference!==null&&reference>=current.lower&&reference<=current.upper;
  const vcs=next?pa.filter(f=>f.timeframe===next&&relation(l,f)):[];
  const triggers=pivots.filter(f=>[l.timeframe,next].includes(f.timeframe)&&f.id!==l.id&&f.side===l.side&&f.confirmed_at>=l.confirmed_at&&f.facts.polarity===(l.role==='support'?'low':'high')&&f.candle_evidence.every(c=>c.time>=l.confirmed_at)).filter(f=>{
   const k=known(l,f.candle_evidence[0].time),price=Number(f.facts.price);return k&&price>=k.lower&&price<=k.upper;
  });
  const refinements=triggers.map(t=>{
   const tf=TF_ORDER[order(t.timeframe)+1],price=Number(t.facts.price),triggerLevel:KeyLevel={id:t.id,kind:'FRACTAL',side:t.side,timeframe:t.timeframe,lower:price,upper:price,role:l.role,confirmed_at:t.confirmed_at,qualified:true,source_finding:t};
   const raid=tf?frames[tf].bars.find(b=>b.time>=t.confirmed_at&&(l.role==='support'?b.low<price:b.high>price)):null;
   const vc=tf?pa.filter(f=>f.timeframe===tf&&relation(triggerLevel,f)&&(!raid||f.confirmed_at>=raid.end)):[];
   return {trigger_id:t.id,trigger_timeframe:t.timeframe,confirmed_at:t.confirmed_at,vc_ids:ids(vc),vc_timeframe:tf??null,status:tf?vc.length?'VC_OBSERVED':'AWAITING_VC':'LOWER_TIMEFRAME_UNAVAILABLE',parent_confirmation_required:false};
  });
  const range=ranges.find(r=>r.timeframe===l.timeframe&&r.range&&r.state==='ACTIVE')??ranges.find(r=>r.range&&r.state==='ACTIVE');
  const q=range?.range,location=q&&reference!==null&&reference>=q.lower&&reference<=q.upper?reference<q.equilibrium?'DISCOUNT':reference>q.equilibrium?'PREMIUM':'EQUILIBRIUM':'UNVERIFIED';
  const destination=levels.filter(o=>o.id!==l.id&&order(o.timeframe)<=rank&&o.role!==l.role&&stateById.get(o.id)?.state==='ACTIVE'&&current.lower<=currentBounds(o,stateById.get(o.id)).upper&&current.upper>=currentBounds(o,stateById.get(o.id)).lower).map(o=>o.id);
  const latest=contact?.b;const delivery=latest?{timeframe:contact.tf,at:latest.end,body:Math.abs(latest.close-latest.open),range:latest.high-latest.low,body_fraction:latest.high===latest.low?null:Math.abs(latest.close-latest.open)/(latest.high-latest.low),compression:'QUALITATIVE_REVIEW',uncorrected_expansion:'QUALITATIVE_REVIEW'}:null;
  return {id:l.id,timeframe:l.timeframe,kind:l.kind,role:l.role,lower:current.lower,upper:current.upper,confirmed_at:l.confirmed_at,lifecycle:s.state,
   eligible_as_poi:usable,liquidity_available:l.kind==='FRACTAL'?!s.liquidity_consumed:null,review_required:true,
   context:inside?'PRICE_AT_POI':contact?'REACTION_HISTORY':'AWAITING_DELIVERY',last_contact_at:latest?.end??null,
   vc_ids:ids(vcs),vc_timeframe:next??null,vc_status:!next?'LOWER_TIMEFRAME_UNAVAILABLE':vcs.length?'VC_OBSERVED':'AWAITING_VC',
   trigger_ids:ids(triggers),refinements,range: q?{timeframe:range!.timeframe,high_id:q.high_id,low_id:q.low_id,confirmed_at:q.confirmed_at}:null,premium_discount:location,opposing_ids:destination,delivery,
   limitations:[...(!usable?['POI_HISTORY_OR_LIFECYCLE_UNVERIFIED']:[]),...(s.liquidity_consumed?['CONSUMED_LIQUIDITY_NOT_REUSED_AS_TARGET']:[]),'POI_SIGNIFICANCE_REQUIRES_REVIEW','VC_IS_NOT_REVERSAL_GUARANTEE','NEAR_POI_DISTANCE_UNSPECIFIED']};
 });
 const rangePois=ranges.filter(r=>r.range&&r.state==='ACTIVE').map(r=>{const q=r.range!;return {timeframe:r.timeframe,high_id:q.high_id,low_id:q.low_id,lower:q.lower,upper:q.upper,confirmed_at:q.confirmed_at,equilibrium:q.equilibrium,
   trigger_ids:ids(pivots.filter(p=>[r.timeframe,TF_ORDER[order(r.timeframe)+1]].includes(p.timeframe)&&p.confirmed_at>=q.confirmed_at&&p.candle_evidence.every(c=>c.time>=q.confirmed_at)&&Number(p.facts.price)>=q.lower&&Number(p.facts.price)<=q.upper)),
   directional_anchor:false,review_required:true,reason:'DR_IS_POI_CONTEXT_DIRECTION_REQUIRES_BOUNDARY_REACTION'};});
 return {revision:TDA_REVISION,scope:'SWING_MN1_TO_H4',target_policy:'X_OR_X_MINUS_1',trigger_policy:'FRACTAL_ONLY',automatic_narrative_confirmation:false,scaling_policy:'STOP_WHEN_EVIDENCE_SUFFICIENT_NO_MANDATORY_CHAIN',anchors,range_pois:rangePois,unavailable_timeframes:['H1','M15'],probability:null};
}

/** Promote formation to POI research eligibility only, never to confirmed trade status. */
export function tdaAnchorLevels(levels:KeyLevel[],tda:ReturnType<typeof tdaRelationships>){
 return levels.filter(l=>tda.anchors.some(a=>a.id===l.id&&a.eligible_as_poi)).map(l=>({...l,qualified:true}));
}
