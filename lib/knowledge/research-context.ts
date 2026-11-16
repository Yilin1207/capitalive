import {TF_ORDER, type Finding, type KeyLevel, type Pivot, type Range} from './detectors';
import type {Frame} from './data';
import type {LevelState, FvgFill} from './level-state';
import type {Timeframe} from '../candle-data';

type State = LevelState & {fill?:FvgFill|null};
const terminal=(s:State)=>['INVALIDATED','CONSUMED'].includes(s.state);
const position=(price:number|null,l:{lower:number;upper:number})=>price===null?'UNKNOWN':price<l.lower?'BELOW':price>l.upper?'ABOVE':'INSIDE';
const intersects=(a:{lower:number;upper:number},b:{lower:number;upper:number})=>a.lower<=b.upper&&a.upper>=b.lower;
const direction=(delta:number)=>delta>0?'UP':delta<0?'DOWN':'FLAT';
const unique=(ids:string[])=>[...new Set(ids)];

/** Facts, not a trend/significance classifier. No rolling threshold or generic bias. */
export function observedPriceBehaviour(frame:Frame,findings:Finding[]) {
  const last=frame.bars.at(-1),previous=frame.bars.at(-2);
  const pivots=findings.filter((f):f is Pivot=>f.kind==='FRACTAL'&&f.facts.variant===3&&f.confirmed_at<=frame.as_of)
    .sort((a,b)=>a.origin.localeCompare(b.origin)||a.id.localeCompare(b.id));
  const to=pivots.at(-1),from=to?[...pivots].reverse().find(p=>p.origin<to.origin&&p.segment===to.segment&&p.polarity!==to.polarity):undefined;
  return {timeframe:frame.timeframe,reference_close:last?.close??null,reference_at:last?.end??null,
    last_close_change:last&&previous&&last.segment===previous.segment?{from:previous.end,to:last.end,delta:last.close-previous.close,direction:direction(last.close-previous.close)}:null,
    last_observed_fractal_leg:from&&to?{from_id:from.id,to_id:to.id,from:from.origin,to:to.origin,confirmed_at:from.confirmed_at>to.confirmed_at?from.confirmed_at:to.confirmed_at,price_distance:to.price-from.price,elapsed_seconds:(Date.parse(to.origin)-Date.parse(from.origin))/1000,direction:direction(to.price-from.price)}:null,
    significance:'NOT_ASSESSED' as const,trend_confirmed:false as const,evidence_ids:from&&to?[from.id,to.id]:[]};
}

/** A filled zone can retain its own-TF premise without proving present support. */
export function levelLifecycleExplanation(s:State,reference:number|null,firstInteraction:string|null=null) {
  const reasons=[`FORMATION_${s.state==='CANDIDATE'?'CANDIDATE':'CONFIRMED'}`,`LIFECYCLE_${s.state}`];
  if(s.fill)reasons.push(`FILL_${s.fill.state}`);
  if(s.fill?.state==='FILLED'&&s.state==='ACTIVE')reasons.push('FULL_FILL_IS_NOT_OWN_TF_INVALIDATION');
  if(s.lower_tf_breach)reasons.push('LOWER_TF_BREACH_IS_NOT_ROLE_REVERSAL');
  if(s.liquidity_consumed)reasons.push('LIQUIDITY_CONSUMED_DOES_NOT_PROVE_ZONE_ROLE_REVERSAL');
  if(s.coverage!=='COMPLETE_OBSERVED_INTERVAL')reasons.push('INTERACTION_HISTORY_UNVERIFIED');
  const verified=s.role_status==='RETEST_CONFIRMED'&&!terminal(s)&&s.coverage==='COMPLETE_OBSERVED_INTERVAL';
  return {formation:s.state==='CANDIDATE'?'CANDIDATE':'CONFIRMED',formation_at:s.confirmed_at,
    first_interaction_at:firstInteraction,
    first_interaction_scope:s.coverage==='COMPLETE_OBSERVED_INTERVAL'?'FIRST_OBSERVED_CLOSED_INTERACTION':'FIRST_OBSERVED_WITH_HISTORY_GAPS',
    fill:s.fill??null,own_tf_invalidated_at:s.invalidated_at,liquidity_consumed:s.liquidity_consumed,
    original_geometry_role:s.initial_role,current_role:verified?s.current_role:null,
    current_role_status:verified?'VERIFIED':'UNVERIFIED',role_transition_candidate:s.lower_tf_breach?'REVIEW_REQUIRED':'NOT_ESTABLISHED',
    reference_position:position(reference,s),structural_relevance:terminal(s)?'HISTORICAL_REVIEW_ONLY':'REVIEW_REQUIRED',reasons};
}

/** Full detected universe, before any compact projection. Significance is not inferred. */
export function validatePathCompleteness(levels:KeyLevel[],states:State[],frames:Record<Timeframe,Frame>,from:number|null,to:number|null,exclude:string[]=[],shownIds?:string[]) {
  const observed=from!==null&&to!==null&&from!==to;
  const lower=Math.min(from??0,to??0),upper=Math.max(from??0,to??0),stateMap=new Map(states.map(s=>[s.id,s]));
  const obstacles=observed?levels.filter(l=>!exclude.includes(l.id)&&l.upper>lower&&l.lower<upper).flatMap(l=>{
    const s=stateMap.get(l.id);if(s&&terminal(s))return [];
    return [{id:l.id,timeframe:l.timeframe,kind:l.kind,lifecycle:s?.state??'UNVERIFIED',significance:'REVIEW_REQUIRED' as const}];
  }):[];
  const dataComplete=TF_ORDER.every(tf=>frames[tf].bars.length>0&&frames[tf].warnings.length===0);
  const historyComplete=obstacles.every(o=>stateMap.get(o.id)?.coverage==='COMPLETE_OBSERVED_INTERVAL');
  const omitted=shownIds?obstacles.filter(o=>!shownIds.includes(o.id)).length:0;
  return {status:!observed||TF_ORDER.some(tf=>!frames[tf].bars.length)?'UNVERIFIED':!dataComplete||!historyComplete||omitted?'PARTIAL':'COMPLETE',
    from,to,obstacles,total:obstacles.length,omitted,ohlc_coverage:dataComplete?'COMPLETE':'PARTIAL',
    scope:'ALL_DETECTED_AUTHOR_TYPES_ALL_FOUR_TF',free_path_proven:false,
    reasons:unique([...(observed?[]:['PATH_ENDPOINTS_UNAVAILABLE']),...(!dataComplete?['OHLC_COVERAGE_NOT_VERIFIED']:[]),...(!historyComplete?['LEVEL_HISTORY_NOT_VERIFIED']:[]),...(omitted?['OBSTACLES_OMITTED']:[]),'SIGNIFICANCE_REQUIRES_REVIEW'])};
}

export function validateDealingRangeEvidence(range:Range,states:State[],frame:Frame,levels:KeyLevel[]) {
  const high=states.find(s=>s.id===range.high_id),low=states.find(s=>s.id===range.low_id),last=frame.bars.at(-1);
  const boundary=(s:State|undefined)=>({id:s?.id??null,origin:s?.origin??null,confirmed_at:s?.confirmed_at??null,state:s?.state??'UNVERIFIED',consumed:s?.liquidity_consumed??null,raid_at:s?.first_raid?.confirmed_at??null,coverage:s?.coverage??'UNVERIFIED'});
  const intact=[high,low].every(s=>s&&s.state==='ACTIVE'&&!s.liquidity_consumed&&s.coverage==='COMPLETE_OBSERVED_INTERVAL');
  const inside=!!last&&last.close>=range.lower&&last.close<=range.upper;
  const context=levels.filter(l=>TF_ORDER.indexOf(l.timeframe)<=TF_ORDER.indexOf(frame.timeframe)&&l.confirmed_at<=range.confirmed_at&&
    [high,low].some(s=>s&&l.id!==s.id&&l.confirmed_at<=s.origin&&l.lower<=s.lower&&l.upper>=s.upper)).map(l=>l.id);
  return {high:boundary(high),low:boundary(low),geometry_valid:range.lower<range.upper,observed_boundaries_intact:intact,
    candidate_suitable_for_review:intact&&inside,review_status:'REVIEW_REQUIRED',active_dealing_range:false,
    premium_discount:null,geometric_equilibrium:(range.lower+range.upper)/2,context_evidence_ids:unique(context),
    structural_invalidation:{condition:'OWN_TF_CLOSE_OUTSIDE_SELECTED_RANGE',lower:range.lower,upper:range.upper,observed:!inside},
    requirements:unique(['AUTHOR_SIGNIFICANCE','IMPULSE_ORIGIN','RANGE_EXPANSION_VS_NEW_RANGE','HTF_CONTEXT',...(!intact?['BOUNDARY_CONSUMED_OR_UNVERIFIED']:[]),...(!inside?['PRICE_OUTSIDE_RANGE']:[])])};
}

export function buildResearchContext(frames:Record<Timeframe,Frame>,findings:Finding[],levels:KeyLevel[],states:State[],reference:number|null) {
  const stateMap=new Map(states.map(s=>[s.id,s]));
  const observed=TF_ORDER.map(tf=>observedPriceBehaviour(frames[tf],findings.filter(f=>f.timeframe===tf)));
  const levelReviews=levels.flatMap(l=>{
    const s=stateMap.get(l.id);if(!s)return [];
    const lowerTfs=TF_ORDER.slice(TF_ORDER.indexOf(l.timeframe)+1,TF_ORDER.indexOf(l.timeframe)+3);
    const interactions=findings.filter(f=>lowerTfs.includes(f.timeframe)&&f.confirmed_at>l.confirmed_at&&['RB_TWO_CANDLE','SNR_CLOSED_BREAK','FVG','RAID'].includes(f.kind)&&
      (f.facts.kl_id===l.id||f.facts.pivot_id===l.id||f.candle_evidence.some(c=>c.time>=l.confirmed_at&&c.high>=l.lower&&c.low<=l.upper)))
      .map(f=>({id:f.id,timeframe:f.timeframe,confirmed_at:f.confirmed_at,relationship:f.facts.kl_id===l.id||f.facts.pivot_id===l.id?'EXPLICIT_DETECTOR_DEPENDENCY':'CLOSED_INTERACTION_WITH_FORMATION',qualification:f.state==='OBSERVED'?'OBSERVED':'CANDIDATE'}));
    const overlaps=levels.filter(o=>o.id!==l.id&&TF_ORDER.indexOf(o.timeframe)<TF_ORDER.indexOf(l.timeframe)&&intersects(l,o)&&stateMap.get(o.id)?.state==='ACTIVE').map(o=>o.id);
    const firstInteraction=TF_ORDER.slice(TF_ORDER.indexOf(l.timeframe)).flatMap(tf=>frames[tf].bars.filter(b=>b.time>=l.confirmed_at&&b.end<=s.evaluated_through&&b.high>=l.lower&&b.low<=l.upper).map(b=>b.end)).sort()[0]??null;
    const observation=levelLifecycleExplanation(s,reference,firstInteraction),previous=frames.H4.bars.at(-2)?.close??null;
    return [{id:l.id,timeframe:l.timeframe,pa_type:l.kind,lower:l.lower,upper:l.upper,origin:s.origin,confirmed_at:s.confirmed_at,lifecycle:s.state,
      review_status:terminal(s)||s.coverage!=='COMPLETE_OBSERVED_INTERVAL'?'DETECTED':'ELIGIBLE_FOR_REVIEW',human_validated:false,
      lifecycle_explanation:observation,htf_dependencies:overlaps,interactions,
      reference_transition:{from:position(previous,l),to:position(reference,l),basis:'LAST_TWO_CLOSED_H4'},
      full_test_status:s.fill?.state==='FILLED'?'FULL_GEOMETRIC_FILL':'AUTHOR_FULL_TEST_NEEDS_REVIEW',
      relevance_reasons:unique([...(position(reference,l)==='INSIDE'?['CLOSED_H4_INSIDE_LEVEL']:[]),...(interactions.length?['X_MINUS_1_OR_2_INTERACTION']:[]),...(overlaps.length?['OVERLAPPING_HTF_LEVEL']:[]),...(['MN1','W1'].includes(l.timeframe)?['HTF_CONTEXT_CANDIDATE']:[]),'SIGNIFICANCE_REQUIRES_REVIEW']),
      uncertainty:unique([...(s.coverage!=='COMPLETE_OBSERVED_INTERVAL'?['HISTORY_UNVERIFIED']:[]),'CURRENT_ROLE_NOT_HUMAN_VALIDATED','NO_AUTOMATIC_IMPORTANCE_SCORE']),
      evidence_ids:unique([l.id,...overlaps,...interactions.map(i=>i.id)]),invalidation:l.kind==='FVG'?'OWN_TF_CLOSE_BEYOND_FAR_BOUNDARY':l.kind==='FRACTAL'?'STRICT_CROSSING_CONSUMES_LIQUIDITY_NOT_ZONE_ROLE':'AUTHOR_BOUNDARIES_REQUIRE_REVIEW'}];
  });
  const distance=(l:{lower:number;upper:number})=>reference===null?Infinity:reference<l.lower?l.lower-reference:reference>l.upper?reference-l.upper:0;
  // Display buckets, not significance weights: containing, linked reaction, then nearest on each side.
  const containingHtf=levelReviews.filter(l=>['MN1','W1'].includes(l.timeframe)&&l.lifecycle==='ACTIVE'&&position(reference,l)==='INSIDE').map(l=>l.id);
  const executiveIds=unique([...containingHtf,...TF_ORDER.flatMap(tf=>{
    const pool=levelReviews.filter(l=>l.timeframe===tf&&!['INVALIDATED','CONSUMED'].includes(l.lifecycle));
    const compare=(a:typeof pool[number],b:typeof pool[number])=>Number(position(reference,b)==='INSIDE')-Number(position(reference,a)==='INSIDE')||Number(b.interactions.length>0)-Number(a.interactions.length>0)||distance(a)-distance(b)||b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id);
    const sides=[pool.filter(l=>reference!==null&&l.lower<=reference).sort(compare)[0],pool.filter(l=>reference!==null&&l.upper>=reference).sort(compare)[0]];
    return unique(sides.filter(x=>!!x).map(x=>x!.id));
  })]);
  const conflicts=levelReviews.filter(l=>executiveIds.includes(l.id)&&['MN1','W1'].includes(l.timeframe)&&position(reference,l)==='INSIDE').flatMap(l=>observed.filter(o=>['D1','H4'].includes(o.timeframe)&&o.last_observed_fractal_leg&&
    (l.lifecycle_explanation.original_geometry_role==='support'?o.last_observed_fractal_leg.direction==='DOWN':o.last_observed_fractal_leg.direction==='UP')).map(o=>({level_id:l.id,timeframe:o.timeframe,kind:'HTF_GEOMETRY_VS_OBSERVED_LTF_LEG',evidence_ids:o.evidence_ids,review_required:true})));
  return {revision:'context-5.1',observed_price_behaviour:observed,
    author_structure:{status:'NEEDS_SPECIFICATION',reason:'AUTHOR_SIGNIFICANCE_AND_ORDER_FLOW_NOT_ALGORITHMICALLY_DEFINED'},
    review_required:true,levels:levelReviews,executive_ids:executiveIds,conflicts,
    selection_policy:'TF_BUCKETS_CONTAINMENT_LINKED_REACTION_NEAREST_PER_SIDE_NOT_SIGNIFICANCE',evidence_ids:executiveIds};
}
