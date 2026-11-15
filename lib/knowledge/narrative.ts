import {TF_ORDER,type KeyLevel,type Pivot,type Range} from './detectors';
import type {Frame} from './data';
import type {Timeframe} from '../candle-data';
import type {LevelState} from './level-state';
import type {selectTarget} from './target-selection';
export function resolveContext(levels:KeyLevel[],reference:number|null){
 const hits=reference===null?[]:levels.filter(l=>['MN1','W1'].includes(l.timeframe)&&l.qualified&&reference>=l.lower&&reference<=l.upper).sort((a,b)=>TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe)||a.id.localeCompare(b.id));
 const top=hits.filter(l=>l.timeframe===hits[0]?.timeframe),a=top.length===1?top[0]:null;
 const conflicts=hits.filter(l=>l.role!==hits[0]?.role);
 return {bias:'Neutral' as const,candidate_bias:!a||conflicts.length?'Neutral':a.role==='support'?'Bullish':'Bearish',a,conflicts,alternatives:top.map(l=>l.id),reason:conflicts.length?'CONFLICTING_HTF_KL':top.length>1?'AMBIGUOUS_HTF_ANCHOR':a?'KL_CONTAINMENT_ONLY_NOT_NARRATIVE':'NO_ACTIVE_MN1_W1_KL'};
}
export function swingFlow(frame:Frame,pivots:Pivot[]){
 const available=pivots.filter(p=>p.segment===frame.bars.at(-1)?.segment&&p.confirmed_at<=frame.as_of);
 const highs=available.filter(p=>p.polarity==='high').slice(-2),lows=available.filter(p=>p.polarity==='low').slice(-2);
 const bias=highs.length<2||lows.length<2?'Neutral':highs[1].price>highs[0].price&&lows[1].price>lows[0].price?'Bullish':highs[1].price<highs[0].price&&lows[1].price<lows[0].price?'Bearish':'Neutral';
 return {bias,status:'PROJECT_SWING_OBSERVATION_NOT_AUTHOR_SOF',evidence_ids:[...highs,...lows].map(p=>p.id)};
}
export type NarrativeFrame={timeframe:Timeframe;structure_bias:string;order_flow:ReturnType<typeof swingFlow>;range:Range|null;findings:{id:string;kind:string;facts:Record<string,unknown>;confirmed_at:string}[]};
export function assessInvalidations(anchor:LevelState|undefined,entryStopCrossed:boolean|null=null){return {entry_invalidated:entryStopCrossed,KL_invalidated:anchor?.state==='INVALIDATED',narrative_invalidated:anchor?.state==='INVALIDATED',review_required:anchor?.state!=='ACTIVE',basis:entryStopCrossed?'Local stop observation does not propagate to HTF A/B/C':'Evaluate entry and HTF anchor independently'};}
export function narrativeAssessment(context:ReturnType<typeof resolveContext>,states:LevelState[],frames:NarrativeFrame[],target:ReturnType<typeof selectTarget>,reference:number|null,reliable:boolean){
 const a=context.a,s=states.find(s=>s.id===a?.id),bias=context.candidate_bias;
 const reasons:string[]=[];
 if(!reliable)reasons.push('INPUT_OR_SOURCE_UNVERIFIED');
 if(!a||bias==='Neutral')reasons.push(context.reason);
 if(s?.state!=='ACTIVE')reasons.push('ANCHOR_NOT_PROVEN_ACTIVE');
 if(!s?.reaction)reasons.push('NO_CLOSED_HTF_OR_X_MINUS_1_REACTION');
 if(s?.lower_tf_breach)reasons.push('ANCHOR_LOWER_TF_BREACH');
 const structure=frames.filter(f=>['MN1','W1','D1'].includes(f.timeframe)).map(f=>({timeframe:f.timeframe,bias:f.structure_bias,order_flow:f.order_flow}));
 for(const f of structure){if(f.bias!=='Neutral'&&f.bias!==bias)reasons.push(`OPPOSING_${f.timeframe}_STRUCTURE`);if(f.order_flow.bias!=='Neutral'&&f.order_flow.bias!==bias)reasons.push(`OPPOSING_${f.timeframe}_SWING_FLOW`);}
 const anchorFrame=frames.find(f=>f.timeframe===a?.timeframe),range=anchorFrame?.range;
 const rangeCurrent=!!range&&!!s&&range.confirmed_at<=s.as_of&&reference!==null&&reference>=range.lower&&reference<=range.upper;
 const location=rangeCurrent?reference!<range!.equilibrium?'DISCOUNT':reference!>range!.equilibrium?'PREMIUM':'EQ':'UNVERIFIED';
 if(!rangeCurrent)reasons.push('EXPLICIT_CURRENT_HTF_DR_REQUIRED');
 else if(bias==='Bullish'&&location!=='DISCOUNT'||bias==='Bearish'&&location!=='PREMIUM')reasons.push('HTF_RANGE_LOCATION_NOT_SUPPORTIVE');
 if(!anchorFrame||anchorFrame.structure_bias!==bias||anchorFrame.order_flow.bias!==bias||bias==='Neutral')reasons.push('HTF_STRUCTURE_AND_SWING_FLOW_NOT_ALIGNED');
 if(target.status!=='TARGET_VALIDATED')reasons.push('TARGET_UNVERIFIED');
 // Delivery thresholds / author SOF remain undefined: keep context-based scenarios under review.
 reasons.push('DELIVERY_AND_AUTHOR_ORDER_FLOW_REQUIRE_SPECIFICATION');
 return {...assessInvalidations(s),status:a?'CANDIDATE_NARRATIVE':'REVIEW_REQUIRED',bias:'Neutral' as const,candidate_bias:bias,review_required:true,structural_prerequisites_met:reasons.every(r=>r==='DELIVERY_AND_AUTHOR_ORDER_FLOW_REQUIRE_SPECIFICATION'),blockers:[...new Set(reasons)],context:{structure,range:range??null,premium_discount:location,reaction:s?.reaction??null,delivery:{status:'NEEDS_SPECIFICATION',test_episodes:s?.test_episodes??0,last_test:s?.last_test??null},target_status:target.status},cancellation_policy:'A local entry stop is not HTF narrative cancellation; re-evaluate A/B/C on their own evidence.'};
}
