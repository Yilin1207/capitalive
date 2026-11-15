import {TF_ORDER,type KeyLevel} from './detectors';
import type {LevelState} from './level-state';
import {provenance} from './rules';
export type Direction='up'|'down';
export function selectTarget(levels:KeyLevel[],states:LevelState[],reference:number|null,direction:Direction|null,a:KeyLevel|null,requestedId?:string){
 const role=direction==='up'?'resistance':'support';
 const candidates=levels.filter(l=>['MN1','W1','D1'].includes(l.timeframe)&&l.id!==a?.id&&reference!==null&&(direction==='up'?l.lower>reference:direction==='down'?l.upper<reference:false)).map(l=>{
  const s=states.find(s=>s.id===l.id)!;const reasons:string[]=[];
  if(!s||s.state!=='ACTIVE')reasons.push(`LEVEL_${s?.state??'UNVERIFIED'}`);
  if(s?.current_role!==role)reasons.push('DIRECTIONAL_ROLE_UNVERIFIED');
  if(s?.role_status==='UNVERIFIED')reasons.push('ROLE_NOT_CONFIRMED');
  if(s?.liquidity_consumed&&s.role_status!=='RETEST_CONFIRMED')reasons.push('TARGET_LIQUIDITY_ALREADY_CONSUMED');
  if(s?.coverage!=='COMPLETE_OBSERVED_INTERVAL')reasons.push('TARGET_HISTORY_UNOBSERVED');
  if(l.kind==='FVG'&&s?.lower_tf_breach)reasons.push('FVG_LOWER_TF_BREACH_REVIEW_REQUIRED');
  if(!l.qualified)reasons.push('BOUNDARY_OR_CONTEXT_UNSPECIFIED');
  return {id:l.id,timeframe:l.timeframe,kind:l.kind,price:direction==='up'?l.lower:l.upper,initial_role:l.role,current_role:s?.current_role??null,role_status:s?.role_status??'UNVERIFIED',role_eligible:reasons.length===0,reasons,evidence_ids:[l.source_finding.id,...s?.role_evidence.map(e=>`${e.timeframe}:${e.time}`)??[]]};
 });
 // X -> X-1 -> X-2 structural target hierarchy (MN1 -> W1 -> D1). Never rank a target by nearest price.
 // Structural anchor first, not nearest price. Ambiguity requires explicit selection.
 // Never skip an unverified choice to silently choose a farther convenient target.
 const allowedTfs=a?TF_ORDER.slice(TF_ORDER.indexOf(a.timeframe),TF_ORDER.indexOf(a.timeframe)+3):TF_ORDER;
 const qualified=candidates.filter(c=>c.role_eligible&&allowedTfs.includes(c.timeframe));
 const structuralTf=a&&qualified.some(c=>c.timeframe===a.timeframe)?a.timeframe:TF_ORDER.find(tf=>qualified.some(c=>c.timeframe===tf));
 const pool=requestedId?candidates.filter(c=>c.id===requestedId):qualified.filter(c=>c.timeframe===structuralTf);
 const chosen=pool.length===1?pool[0]:null;
 const path=(choice:typeof candidates[number])=>levels.filter(l=>l.id!==choice.id&&l.id!==a?.id&&['MN1','W1','D1'].includes(l.timeframe)&&(direction==='up'?l.upper>reference!&&l.lower<choice.price:l.lower<reference!&&l.upper>choice.price)).flatMap(l=>{
  const s=states.find(s=>s.id===l.id);if(s?.state==='INVALIDATED')return [];
  // Consumed original fractal liquidity is not reused as a confirmed obstacle.
  if(s?.state==='CONSUMED'&&s.role_status!=='RETEST_CONFIRMED')return [];
  if(s?.state==='ACTIVE'&&s.current_role!==role)return [];
  return [{id:l.id,timeframe:l.timeframe,kind:l.kind,lower:l.lower,upper:l.upper,current_role:s?.current_role??null,state:s?.state??'UNVERIFIED',certainty:s?.state==='ACTIVE'&&s.current_role===role?'CONFIRMED_OBSTACLE':'POTENTIAL_OBSTACLE_REVIEW_REQUIRED',evidence_id:l.source_finding.id}];
 });
 const obstacles=chosen?path(chosen):[];
 const blockers=[...(!direction?['NO_DIRECTIONAL_CONTEXT']:[]),...(!chosen?[requestedId?'REQUESTED_TARGET_UNAVAILABLE':pool.length>1?'AMBIGUOUS_STRUCTURAL_TARGETS':'NO_STRUCTURAL_TARGET']:chosen.reasons),...(chosen&&!allowedTfs.includes(chosen.timeframe)?['TARGET_OUTSIDE_AUTHOR_X_OR_X_MINUS_1']:[]),...(obstacles.length?['A_TO_B_PATH_HAS_OBSTACLES']:[])];
 const validated=chosen&&blockers.length===0?chosen:null;
 return {...provenance('EDGE.TARGET_ROLE.v2'),status:validated?'TARGET_VALIDATED':'TARGET_UNVERIFIED',as_of:states[0]?.as_of??null,selection_policy:requestedId?'EXPLICIT_TARGET_NO_FALLBACK':'UNIQUE_ROLE_ELIGIBLE_STRUCTURAL_TF_NO_DISTANCE_RANKING',requested_id:requestedId??null,target_candidates:candidates,candidate_reviews:candidates.filter(c=>c.role_eligible).map(c=>({id:c.id,role_eligible:c.role_eligible,author_timeframe_eligible:allowedTfs.includes(c.timeframe),path_obstacle_ids:path(c).map(o=>o.id)})),selected_candidate:chosen,validated_target:validated,obstacles,blockers,counterarguments:[...provenance('EDGE.TARGET_ROLE.v2').counterarguments,...blockers],invalidation:'Withdraw when role, continuity, liquidity state or intervening obstacles change. Target validation means observed structural eligibility, not TP probability.'};
}
