import {TF_ORDER,type KeyLevel,type Pivot,type Range} from './detectors';
import type {Frame} from './data';
import type {Timeframe} from '../candle-data';
import type {LevelState} from './level-state';
import type {selectTarget} from './target-selection';
import {REVIEW_QUESTIONS,reviewErrors,type HumanReview} from './human-review';
export function resolveContext(levels:KeyLevel[],reference:number|null,requestedId?:string,reactionIds:string[]=[]){
 const hits=reference===null?[]:levels.filter(l=>['MN1','W1','D1'].includes(l.timeframe)&&l.qualified&&(reference>=l.lower&&reference<=l.upper||reactionIds.includes(l.id))).sort((a,b)=>TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe)||a.id.localeCompare(b.id));
 const top=hits.filter(l=>l.timeframe===hits[0]?.timeframe),a=requestedId?levels.find(l=>l.id===requestedId&&['MN1','W1','D1'].includes(l.timeframe)&&l.qualified)??null:top.length===1?top[0]:null;
 const conflicts=hits.filter(l=>l.role!==hits[0]?.role);
 return {bias:'Neutral' as const,candidate_bias:!a||conflicts.length&&!requestedId?'Neutral':a.role==='support'?'Bullish':'Bearish',a,conflicts,alternatives:top.map(l=>l.id),reason:requestedId&&!a?'REQUESTED_ANCHOR_UNAVAILABLE':conflicts.length?'CONFLICTING_HTF_KL':top.length>1&&!requestedId?'AMBIGUOUS_HTF_ANCHOR':a?requestedId?'EXPLICIT_ANCHOR_REQUIRES_REVIEW':'KL_CONTAINMENT_ONLY_NOT_NARRATIVE':'NO_ELIGIBLE_MN1_W1_D1_POI'};
}
export function swingFlow(frame:Frame,pivots:Pivot[]){
 // No approved author HH/HL-count shortcut for qualitative SOF.
 void frame; void pivots;
 return {bias:'Neutral',status:'NEEDS_SPECIFICATION',evidence_ids:[] as string[]};
}

export type NarrativeFrame={timeframe:Timeframe;structure_bias:string;order_flow:ReturnType<typeof swingFlow>;range:Range|null;range_state?:{state:string;invalidated_at:string|null};dr_detection?:{status:string;current:Range|null};findings:{id:string;kind:string;facts:Record<string,unknown>;confirmed_at:string}[]};
export function assessInvalidations(anchor:LevelState|undefined,entryStopCrossed:boolean|null=null){return {entry_invalidated:entryStopCrossed,KL_invalidated:anchor?.state==='INVALIDATED',narrative_invalidated:anchor?.state==='INVALIDATED',review_required:anchor?.state!=='ACTIVE',basis:entryStopCrossed?'Local stop observation does not propagate to HTF A/B/C':'Evaluate entry and HTF anchor independently'};}
export function narrativeAssessment(context:ReturnType<typeof resolveContext>,states:LevelState[],frames:NarrativeFrame[],target:ReturnType<typeof selectTarget>,reference:number|null,reliable:boolean,review?:HumanReview,evidenceHash='',hasC=false,poiEligible=false){
 const a=context.a,s=states.find(s=>s.id===a?.id),bias=context.candidate_bias;
 const reasons:string[]=[];
 if(!reliable)reasons.push('INPUT_OR_SOURCE_UNVERIFIED');
 if(!a||bias==='Neutral')reasons.push(context.reason);
 if(s?.state!=='ACTIVE'&&!poiEligible)reasons.push('ANCHOR_NOT_PROVEN_ACTIVE');
 if(!s?.reaction)reasons.push('NO_CLOSED_HTF_OR_X_MINUS_1_REACTION');
 if(s?.lower_tf_breach)reasons.push('ANCHOR_LOWER_TF_BREACH');
 const structure=frames.filter(f=>['MN1','W1','D1'].includes(f.timeframe)).map(f=>({timeframe:f.timeframe,bias:f.structure_bias,order_flow:f.order_flow}));
 // Qualitative structure is context, not a prerequisite invented for TDA.

 const anchorFrame=frames.find(f=>f.timeframe===a?.timeframe),automaticFrame=(anchorFrame?.dr_detection?.status==='ESTABLISHED'?anchorFrame:frames.find(f=>f.dr_detection?.status==='ESTABLISHED')),range=anchorFrame?.range??automaticFrame?.dr_detection?.current;
 const rangeActive=anchorFrame?.range?anchorFrame.range_state?.state==='ACTIVE':!!automaticFrame;
 const rangeCurrent=!!range&&!!s&&rangeActive&&range.confirmed_at<=s.as_of&&reference!==null&&reference>=range.lower&&reference<=range.upper;
 const location=rangeCurrent?reference!<range!.equilibrium?'DISCOUNT':reference!>range!.equilibrium?'PREMIUM':'EQ':'UNVERIFIED';
 if(!rangeCurrent)reasons.push('EXPLICIT_CURRENT_HTF_DR_REQUIRED');
 else if(bias==='Bullish'&&location!=='DISCOUNT'||bias==='Bearish'&&location!=='PREMIUM')reasons.push('HTF_RANGE_LOCATION_NOT_SUPPORTIVE');
 if(target.status!=='TARGET_VALIDATED')reasons.push('TARGET_PATH_REQUIRES_REVIEW');
 // These are review questions, not invented quantitative SOF / VC thresholds.
 // Hard evidence gates cannot be waived by a human statement.
 const hard:string[]=[];
 if(!reliable)hard.push('INPUT_OR_SOURCE_UNVERIFIED');
 if(review){hard.push(...reviewErrors(review));if(review.evidence_sha256!==evidenceHash)hard.push('STALE_OR_DIFFERENT_REVIEW_EVIDENCE');}
 if(review?.decision!=='Neutral'){
  if(!a||s?.state!=='ACTIVE'&&!poiEligible||bias==='Neutral')hard.push('NO_ACTIVE_DIRECTIONAL_ANCHOR');
  if(anchorFrame?.range&&!rangeCurrent)hard.push('SELECTED_DR_INVALID_OR_OUTSIDE');
  if(!target.candidate_target)hard.push('TARGET_UNVERIFIED');
  if(!hasC)hard.push('STRUCTURAL_INVALIDATION_REQUIRED');
  if(review&&review.decision!==bias)hard.push('REVIEW_DIRECTION_CONTRADICTS_SELECTED_ANCHOR');
 }
 const confirmed=!!review&&hard.length===0;
 const blockers=confirmed?[]:[...new Set([...reasons,...hard,...(!review?['HUMAN_REVIEW_REQUIRED']:[])])];
 return {...assessInvalidations(s),status:confirmed?review!.decision==='Neutral'?'CONFIRMED_NEUTRAL':'CONFIRMED_NARRATIVE':a?'CANDIDATE_NARRATIVE':'REVIEW_REQUIRED',bias:confirmed?review!.decision:'Neutral' as const,candidate_bias:bias,confirmed_narrative:confirmed?review!.decision:null,mode:'HUMAN_REVIEW',review_required:!confirmed,structural_prerequisites_met:hard.length===0,blockers,
  structural_bias:structure.map(f=>({timeframe:f.timeframe,bias:f.bias,basis:'NEEDS_SPECIFICATION'})),macro_bias:{status:'NOT_PROVIDED',bias:null},evidence_confidence:{status:reliable?'PARTIAL':'UNVERIFIED',human_reviewed:confirmed,independently_validated:false,probability:null},
  human_review:{evidence_sha256:evidenceHash,questions:REVIEW_QUESTIONS,review:review??null,accepted:confirmed,scope:'Research scenario only; qualitative judgment is attributed to the reviewer, not to an automatic author rule'},
  review_observations:[...new Set(reasons)],
  context:{structure,range:range??null,premium_discount:location,reaction:s?.reaction??null,raid:s?.first_raid??null,delivery:{status:'QUALITATIVE_REVIEW',test_episodes:s?.test_episodes??0,last_test:s?.last_test??null,evidence_ids:frames.flatMap(f=>f.findings.filter(x=>['COMPRESSION_UNSPECIFIED','DISPLACEMENT_UNSPECIFIED','LIQUIDITY_RAID'].includes(x.kind)).map(x=>x.id))},target_status:target.status},cancellation_policy:'A local entry stop is not HTF narrative cancellation; re-evaluate A/B/C on their own evidence.'};
}
