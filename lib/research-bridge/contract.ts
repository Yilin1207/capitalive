import {validatePaReport} from '../pa-engine/contract.ts';
// Portable, dependency-free contract shared by the API and the private-repository publisher.
export const MAX_REPORT_BYTES=65_536;
export const CONTRACT_REVISION='pa-engine-v6.1';
export type FailureStage='http'|'schema'|'size'|'expiry'|'provider'|'publish';
export type BridgeDiagnostic={stage:FailureStage;code:string;http_status:number|null;response_bytes:number|null;media_type:'json'|'html'|'other'|null;contract_revision:typeof CONTRACT_REVISION};
export class BridgeFailure extends Error {
  diagnostic:BridgeDiagnostic;
  constructor(value:BridgeDiagnostic){super(value.code);this.name='BridgeFailure';this.diagnostic=value;}
}
export function diagnostic(stage:FailureStage,code:string,metadata:Partial<Pick<BridgeDiagnostic,'http_status'|'response_bytes'|'media_type'>>={}):BridgeDiagnostic {
  const allowed=['NETWORK_ERROR','TIMEOUT','HTTP_STATUS','HTTP_REDIRECT','CONTENT_TYPE','INVALID_JSON','CONTRACT_REJECTED','CONTRACT_REVISION_MISMATCH','REPORT_TOO_LARGE','REPORT_EXPIRED','INVALID_REPORT_TIME','SECRET_IN_REPORT','UPSTREAM_UNAVAILABLE','CAPITAL_CONFIG','CAPITAL_AUTH','CAPITAL_RATE_LIMIT','REQUEST_RATE_LIMIT','HISTORY_RATE_LIMIT','HISTORY_BUSY','CANDLES_UNAVAILABLE','CAPITAL_TIMEOUT','CAPITAL_INVALID_RESPONSE','CAPITAL_UPSTREAM','INVALID_EVIDENCE','GITHUB_HTTP_ERROR','PRIVATE_REPOSITORY_REQUIRED','INVALID_PUBLICATION','CONFIGURATION_ERROR','PUBLISH_FAILED'];
  return {stage,code:allowed.includes(code)?code:stage==='publish'?'PUBLISH_FAILED':stage==='provider'?'UPSTREAM_UNAVAILABLE':'CONTRACT_REJECTED',http_status:metadata.http_status??null,response_bytes:metadata.response_bytes??null,media_type:metadata.media_type??null,contract_revision:CONTRACT_REVISION};
}
export function classifyFailure(error:unknown,fallback:FailureStage='schema'):BridgeDiagnostic {
  if(error instanceof BridgeFailure)return error.diagnostic;
  const message=error instanceof Error?error.message:'';
  if(message==='REPORT_TOO_LARGE')return diagnostic('size',message);
  if(message==='REPORT_EXPIRED'||message==='INVALID_REPORT_TIME')return diagnostic('expiry',message);
  if(message==='SECRET_IN_REPORT')return diagnostic('schema',message);
  if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))return diagnostic('http','TIMEOUT');
  if(message==='PRIVATE_REPOSITORY_REQUIRED'||message==='INVALID_PUBLICATION')return diagnostic('publish',message);
  if(message==='INVALID_BRIDGE_CONFIGURATION'||message==='WRONG_WORKFLOW_REPOSITORY')return diagnostic('publish','CONFIGURATION_ERROR');
  return diagnostic(fallback,fallback==='http'?'NETWORK_ERROR':fallback==='publish'?'PUBLISH_FAILED':'CONTRACT_REJECTED');
}
type Spec={type?:'object'|'array'|'string'|'number'|'boolean';properties?:Record<string,Spec>;record?:Spec;keyPattern?:RegExp;items?:Spec;enum?:unknown[];nullable?:boolean;optional?:boolean;pattern?:RegExp;max?:number};
const str=(pattern:RegExp,max=160):Spec=>({type:'string',pattern,max});
const en=(...values:unknown[]):Spec=>({enum:values});
const obj=(properties:Record<string,Spec>):Spec=>({type:'object',properties});
const arr=(items:Spec,max=250):Spec=>({type:'array',items,max});
const nullable=(s:Spec):Spec=>({...s,nullable:true});
const optional=(s:Spec):Spec=>({...s,optional:true});
const num:Spec={type:'number'},bool:Spec={type:'boolean'};
const time=str(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,24),hex=str(/^[a-f0-9]{64}$/,64),ref=str(/^e\d{1,4}$/,5);
const tf=en('MN1','W1','D1','H4'),code=str(/^[A-Z][A-Z0-9_]{0,100}$/,101),bias=en('Bullish','Bearish','Neutral');
const group=obj({items:arr(ref),total:num,omitted:num});
const interaction=obj({kind:code,timeframe:tf,candle:num});
const evidence=obj({id:str(/^(EURUSD|NAS100|JP225|EU50):(MN1|W1|D1|H4):(bid|ask):[A-Za-z0-9_.:\-]+$/,1600),timeframe:tf,kind:code,origin:time,confirmed_at:time,
  snr:optional(obj({revision:en('snr-formation-context-2'),level_policy:en('FIRST_CANDLE_CLOSE'),level_price:num,formation_confirmed:en(true),origin_confirmed_at:time,delivery_at:time,breakout_at:time,
    waiting_bars:num,formation_seconds:num,failed_test_bars:num,failed_test_episodes:num,test_windows:arr(num,1000),breakout_body:num,breakout_body_fraction:num,prior_body_sample:num,body_to_prior_median:nullable(num),
    impulse_leg_bars:num,impulse_leg_body_to_median:nullable(num),impulse_leg_efficiency:num,impulse_detected:bool,impulse_evidence:en('MEASURED_EXPANSION','MEASURED_EXPANSION_AND_X1_FVG','X1_FVG_AT_BREAK','BODY_METRICS_ONLY'),
    relative_strength:en('VERY_STRONG_FORMATION_CANDIDATE','CONTEXT_CONFLICT','REVIEW_REQUIRED'),strength_policy:en('REPEATED_EPISODES_AND_IMPULSE_FVG_OPTIONAL'),impulse_policy:en('PRIOR20_MEDIAN_2X_LEG_EFFICIENCY_060_MIN5_OR_X1_FVG'),probability:en(null),review_required:en(true),primary_kl:ref,x1_fvg:nullable(ref),opposing_kl:nullable(ref),opposing_bounds:optional(nullable(obj({lower:num,upper:num})))})),
  rb:optional(obj({revision:en('rb-first-close-2'),level_policy:en('FIRST_CANDLE_CLOSE'),level_price:num,formation_confirmed:en(true),basis:en('LIQUIDITY_RAID','FVG_INTERACTION','FVG_AND_LIQUIDITY_RAID'),relative_quality:en('RAID_BACKED','WEAKER_FVG_ONLY'),probability:en(null),significance:en('REVIEW_REQUIRED'),primary_kl:ref,liquidity:nullable(ref),fvg:nullable(ref)})),
  lower:nullable(num),upper:nullable(num),variant:en(3,null),polarity:en('high','low',null),direction:en('bullish','bearish','Bullish','Bearish','up','down',null),
  detector_state:en('OBSERVED','CANDIDATE','NEEDS_SPECIFICATION'),data_status:en('PARTIAL','UNVERIFIED'),
  rule:str(/^EDGE\.[A-Z0-9_]+\.v\d+$/,100),candle_refs:arr(num,1000),candle_evidence_sha256:hex,dependencies:arr(ref,20),
  lifecycle:nullable(obj({state:code,initial_role:optional(en('support','resistance')),fill:optional(nullable(obj({state:en('UNKNOWN','UNTOUCHED','TOUCHED','PARTIAL','FILLED'),max_observed_fraction:num,first_test_at:nullable(time),last_test_at:nullable(time),revision:optional(en('fvg-unfilled-1')),remaining:optional(nullable(obj({lower:num,upper:num}))),fully_tested_at:optional(nullable(time))}))),current_role:en('support','resistance',null),role_status:code,coverage:code,evaluated_through:time,invalidated_at:nullable(time),liquidity_consumed:bool,interactions:arr(interaction,20)}))});
const frame=obj({range_options:optional(obj({total:num,omitted:num,review_required:en(true)})),timeframe:tf,fetched_at:time,last_closed_at:nullable(time),closed_candles:num,data_status:code,warnings:arr(code,24),discarded_rows:num,
  structure:obj({bias:nullable(bias),events:group,swing_bias:nullable(bias),swing_basis:en('NEEDS_SPECIFICATION','OBSERVED_FRACTAL_SEQUENCE','INSUFFICIENT_CONFIRMED_PIVOTS'),swing_evidence:arr(ref,4)}),
  fractals:arr(obj({variant:en(3),polarity:en('high','low'),items:arr(ref,1),total:num,omitted:num}),4),snr:group,rb:group,fvg:group,ifvg:group,
  snr_quality:optional(obj({very_strong_candidates:num,context_conflicts:num,review_required:num})),
  rb_quality:optional(obj({raid_backed:num,fvg_only_weaker:num,counting:en('FINDINGS_PER_PRIMARY_KL')})),
  liquidity:obj({raids:group,idm:group,strong:group,irl:group}),
  dealing_range:nullable(obj({high:ref,low:ref,lower:num,upper:num,equilibrium:num,confirmed_at:time,state:code,invalidated_at:nullable(time)})),range_status:code,
  range_candidate:optional(nullable(obj({high:ref,low:ref,lower:num,upper:num,equilibrium:num,confirmed_at:time,method:en('LATEST_FRACTAL3_PROJECT_CANDIDATE','KL_REACTION_LOCAL_DR_CANDIDATE'),review_required:en(true)})))});
const scenario=obj({candidate_narrative:nullable(bias),confirmed_narrative:nullable(bias),status:code,
  evidence_quality:obj({status:code,human_reviewed:bool,independently_validated:en(false),probability:en(null)}),
  A:obj({selected:nullable(ref),items:arr(ref,3),total:num,omitted:num}),
  B:obj({selected:nullable(ref),validated:nullable(ref),status:code,items:arr(obj({level:ref,role_eligible:bool,author_timeframe_eligible:nullable(bool),reasons:arr(code,24),
    path:obj({items:arr(ref,4),total:nullable(num),omitted:nullable(num),completeness:en('UNASSESSED','COMPLETE','PARTIAL')})}),3),total:num,role_eligible:num,omitted:num}),
  C:nullable(obj({source:ref,timeframe:tf,price:num,condition:en('OWN_TF_CLOSE_BEYOND_FVG','MANUAL_OWN_TF_CLOSE_BEYOND','OWN_TF_CLOSE_BEYOND_STRUCTURE')})),
  invalidations:obj({entry:nullable(bool),KL:nullable(bool),narrative:nullable(bool)}),blockers:arr(code,24),action:en('WAIT','NOT_EVALUATED')});
const rangeReview=obj({high:nullable(ref),low:nullable(ref),high_state:code,low_state:code,high_consumed:nullable(bool),low_consumed:nullable(bool),
  observed_boundaries_intact:bool,candidate_suitable_for_review:bool,review_status:en('REVIEW_REQUIRED'),active_dealing_range:bool,premium_discount:en(null,'PREMIUM','DISCOUNT','EQUILIBRIUM'),context_evidence:group,
  structural_invalidation:obj({condition:en('OWN_TF_CLOSE_OUTSIDE_SELECTED_RANGE'),lower:num,upper:num,observed:bool}),requirements:arr(code,10)});
const researchContext=obj({revision:en('context-5.1'),review_required:en(true),author_structure:obj({status:en('NEEDS_SPECIFICATION'),reason:code}),
  dealing_range_selection:optional(obj({timeframe:nullable(tf),reason:code,skipped:arr(obj({timeframe:tf,reason:code}),4),narrative_confirmed:en(false)})),
  candidate_narrative:bias,confirmed_narrative:nullable(bias),
  observed_price_behaviour:arr(obj({timeframe:tf,reference_close:nullable(num),reference_at:nullable(time),
    last_close_change:nullable(obj({from:time,to:time,delta:num,direction:en('UP','DOWN','FLAT')})),
    last_observed_fractal_leg:nullable(obj({from_id:ref,to_id:ref,from:time,to:time,confirmed_at:time,price_distance:num,elapsed_seconds:num,direction:en('UP','DOWN','FLAT')})),
    significance:en('NOT_ASSESSED'),trend_confirmed:en(false),evidence_ids:arr(ref,2)}),4),
  executive_evidence:obj({items:arr(obj({level:ref,review_status:en('DETECTED','ELIGIBLE_FOR_REVIEW'),human_validated:en(false),
    current_role:en('support','resistance',null),current_role_status:en('VERIFIED','UNVERIFIED'),role_transition_candidate:en('REVIEW_REQUIRED','NOT_ESTABLISHED'),reference_position:en('ABOVE','BELOW','INSIDE','UNKNOWN'),
    first_interaction_at:nullable(time),first_interaction_scope:code,structural_relevance:code,reference_transition:obj({from:code,to:code,basis:en('LAST_TWO_CLOSED_H4')}),full_test_status:code,
    htf_dependencies:group,interactions:group,relevance_reasons:arr(code,8),uncertainty:arr(code,8),lifecycle_reasons:arr(code,12),invalidation:code}),32),total:num,omitted:num,selection_policy:code}),
  conflicts:arr(obj({level_id:ref,timeframe:tf,kind:en('HTF_GEOMETRY_VS_OBSERVED_LTF_LEG'),evidence_ids:arr(ref,2),review_required:en(true)}),64),
  dealing_range_reviews:arr(obj({timeframe:tf,detection:optional(obj({revision:en('dr-sequence-1'),status:en('ESTABLISHED','AWAITING_CONFIRMED_PAIR','AWAITING_NEW_EXTREME'),reason:code,direction:en('Bullish','Bearish',null),high:nullable(ref),low:nullable(ref),lower:nullable(num),upper:nullable(num),equilibrium:nullable(num),start_at:nullable(time),end_at:nullable(time),confirmed_at:nullable(time),close_break_at:nullable(time),last_wick_raid_at:nullable(time),premium_discount:en('PREMIUM','DISCOUNT','EQUILIBRIUM',null),origin_context:group,parent_ranges:num,internal_fractals:num,local_candidates:num,transitions:num,internal_classification:en('INTERNAL_LIQUIDITY_NOT_AUTOMATIC_IDM'),significance:en('REVIEW_REQUIRED'),narrative_confirmed:en(false)})),selected:nullable(rangeReview),candidates:obj({items:arr(rangeReview,1),total:num,omitted:num})}),4),
  paths:arr(obj({target:ref,from:nullable(num),to:nullable(num),from_basis:en('ANCHOR_BOUNDARY','LAST_CLOSED_H4'),status:en('COMPLETE','PARTIAL','UNVERIFIED'),obstacles:group,ohlc_coverage:en('COMPLETE','PARTIAL'),free_path_proven:en(false),reasons:arr(code,10)}),3),
  full_inspection:obj({path:en('/api/intelligence'),mode:en('inspection'),snapshot_sha256:hex,as_of:time,requires_authorization:bool})});
const tda=obj({revision:en('tda-notion-1'),scope:en('SWING_MN1_TO_H4'),target_policy:en('X_OR_X_MINUS_1'),trigger_policy:en('FRACTAL_ONLY'),automatic_narrative_confirmation:en(false),selected_anchor:nullable(ref),unavailable_timeframes:arr(en('H1','M15'),2),
 anchors:obj({items:arr(obj({level:ref,eligible_as_poi:en(true),liquidity_available:nullable(bool),context:en('PRICE_AT_POI','REACTION_HISTORY','AWAITING_DELIVERY'),last_contact_at:nullable(time),review_required:en(true),vc:group,vc_timeframe:nullable(tf),vc_status:en('LOWER_TIMEFRAME_UNAVAILABLE','VC_OBSERVED','AWAITING_VC'),triggers:group,
 refinements:obj({items:arr(obj({trigger:ref,confirmed_at:time,vc:group,vc_timeframe:nullable(tf),status:en('LOWER_TIMEFRAME_UNAVAILABLE','VC_OBSERVED','AWAITING_VC'),parent_confirmation_required:en(false)}),2),total:num,omitted:num}),
 range:nullable(obj({timeframe:tf,high:ref,low:ref,confirmed_at:time})),premium_discount:en('DISCOUNT','PREMIUM','EQUILIBRIUM','UNVERIFIED'),opposing:group,
 delivery:nullable(obj({timeframe:tf,at:time,body:num,range:num,body_fraction:nullable(num),compression:en('QUALITATIVE_REVIEW'),uncorrected_expansion:en('QUALITATIVE_REVIEW')})),limitations:arr(code,8)}),3),total:num,omitted:num}),
 range_pois:arr(obj({timeframe:tf,high:ref,low:ref,confirmed_at:time,directional_anchor:en(false),triggers:group,review_required:en(true)}),4),
 potential_target:nullable(ref),target_status:en('POTENTIAL_TARGET_IDENTIFIED','TARGET_NOT_SELECTED'),path_completeness:en('COMPLETE','PARTIAL','UNKNOWN'),free_path_proven:en(false),probability:en(null)});


const position=en('PREMIUM','DISCOUNT','EQUILIBRIUM','OUTSIDE','UNVERIFIED');
const methodBoundary=nullable(obj({evaluated_through:time,price:num,timeframe:tf,source_ids:arr(ref,2),known_at:time,kind:en('DR_BOUNDARY','FVG_FAR_BOUNDARY','RAID_BACKED_PA_EXTREME','H4_DR_BOUNDARY'),wick_breached:nullable(bool),wick_at:nullable(time),close_breached:nullable(bool),close_at:nullable(time),coverage:en('COMPLETE','UNVERIFIED')}));
const methodScore=nullable(en(1,2,3,4,5));
const narrativeMethod=obj({revision:en('narrative-method-1'),score_policy:en('QUALITY_1_TO_5_NOT_PROBABILITY'),delivery_policy:en('PRECONTACT_LAST6_PRIOR20_MIN5_EFF035_070_BODY1_15'),primary_context:nullable(tf),mn1_w1_conflict:bool,contexts:arr(obj({timeframe:tf,position}),4),selection_status:en('AMBIGUOUS_TOP_SCORE','CANDIDATE_SELECTED','NO_CURRENT_SCORED_REACTION'),automatic_confirmation:en(false),probability:en(null),
candidates:obj({items:arr(obj({selected:bool,A:obj({kind:en('FRACTAL','FVG','RB','SNR','DR_EQ'),timeframe:tf,lower:num,upper:num,entry:num,confirmed_at:time,source_ids:arr(ref,2)}),direction:en('Bullish','Bearish'),current_reaction:bool,
quality:obj({score:methodScore,factors:arr(obj({code:en('BASE','HTF_PRIORITY','FAVORABLE_LOCATION','REPEATED_HOLDS','RAID_BACKED','MN1_W1_CONFLICT','TREND_CONFLICT','OPPOSING_HTF_POI'),delta:en(-1,0,1,2)}),8),hold_episodes:num,anchor_position:position}),
delivery:nullable(obj({score:methodScore,timeframe:tf,from:nullable(time),through:nullable(time),contact_at:nullable(time),bars:num,efficiency:nullable(num),body_ratio:nullable(num),opposing:group,reason:en('INSUFFICIENT_APPROACH_HISTORY','NOT_APPROACHING_POI','IMPULSIVE_APPROACH','OPPOSING_PA_ON_APPROACH','WEAK_APPROACH','MIXED_APPROACH')})),
B:nullable(obj({level:ref,timeframe:tf,price:num,confirmed_at:time})),target_count:num,obstacles:group,C:methodBoundary,entry_stop:methodBoundary,rr:nullable(obj({risk:num,reward:num,ratio:num,costs_included:en(false),minimum_required:en(null)})),entry_status:en('NOT_ENTERED'),narrative_status:en('CANDIDATE'),confirmed_narrative:en(null),review_required:en(true)}),2),total:num,omitted:num})});

const schema=obj({narrative_method:optional(narrativeMethod),tda:optional(tda),published_at:optional(nullable(time)),freshness:optional(obj({quote_retrieved_at:nullable(time),quote_status:en('FRESH','STALE','MARKET_CLOSED'),data_quality:code,stale_reasons:arr(code,10),quote_max_seconds:num,h4_max_delay_seconds:num,h4_delay_seconds:num,source_age_seconds:num,delivery_max_seconds:num})),technical_only:optional(en(true)),details:optional(obj({path:en('/api/intelligence'),snapshot_sha256:hex})),schema_version:en('desk-report-v2'),symbol:en('EURUSD','NAS100','JP225','EU50'),status:en('ERROR','STALE','UNVERIFIED','PARTIAL'),generated_at:time,as_of:nullable(time),expires_at:time,
  error:en(null,'UPSTREAM_UNAVAILABLE','INVALID_REQUEST','INVALID_EVIDENCE','REPORT_TOO_LARGE','TRANSPORT_ERROR','UNTRUSTED_RESPONSE','HTTP_ERROR','SCHEMA_ERROR','EXPIRED_REPORT'),
  diagnostic:optional(obj({stage:en('http','schema','size','expiry','provider','publish'),code:en('NETWORK_ERROR','TIMEOUT','HTTP_STATUS','HTTP_REDIRECT','CONTENT_TYPE','INVALID_JSON','CONTRACT_REJECTED','CONTRACT_REVISION_MISMATCH','REPORT_TOO_LARGE','REPORT_EXPIRED','INVALID_REPORT_TIME','SECRET_IN_REPORT','UPSTREAM_UNAVAILABLE','CAPITAL_CONFIG','CAPITAL_AUTH','CAPITAL_RATE_LIMIT','REQUEST_RATE_LIMIT','HISTORY_RATE_LIMIT','HISTORY_BUSY','CANDLES_UNAVAILABLE','CAPITAL_TIMEOUT','CAPITAL_INVALID_RESPONSE','CAPITAL_UPSTREAM','INVALID_EVIDENCE','GITHUB_HTTP_ERROR','PRIVATE_REPOSITORY_REQUIRED','INVALID_PUBLICATION','CONFIGURATION_ERROR','PUBLISH_FAILED'),http_status:nullable(num),response_bytes:nullable(num),media_type:en('json','html','other',null),contract_revision:en(CONTRACT_REVISION)})),
  source:nullable(obj({provider:en('Capital.com'),environment:en('demo','live'),analysis_schema:en('edge-knowledge-5'),price_side:en('bid','ask'),engine_commit:nullable(str(/^[a-f0-9]{40}$/,40)),evidence_sha256:hex,demo_live_equivalence:en('NOT_ESTABLISHED'),full_ohlc_published:en(false)})),
  quote:nullable(obj({bid:nullable(num),ask:nullable(num),spread:nullable(num),provider_timestamp:nullable(time),retrieved_at:nullable(time),source_type:en('REST','WEBSOCKET',null),market_status:en('TRADEABLE','CLOSED','EDITS_ONLY','OFFLINE','ON_AUCTION','ON_AUCTION_NO_EDITS','SUSPENDED',null),provider_age_seconds:nullable(num),fresh:bool,used_as_closed_evidence:en(false)})),
  research_context:optional(researchContext),frames:arr(frame,4),scenario:nullable(scenario),evidence:{type:'object',record:evidence,keyPattern:/^e\d{1,4}$/},
  rules:{type:'object',keyPattern:/^EDGE\.[A-Z0-9_]+\.v\d+$/,record:obj({version:num,status:code,specification:code,basis:en('DOCUMENTED','PROJECT_HYPOTHESIS',null),source_revisions:arr(obj({id:str(/^[a-f0-9-]{32,36}$/,36),revision:time}),20)})},
  candle_windows:arr(arr(time,2),1000),coverage:nullable(obj({budget_tier:optional(num),selection_policy:en('RECENT_PER_CATEGORY_PLUS_ENGINE_SCENARIO_AND_REFERENCED_DEPENDENCIES'),findings_total:num,findings_included:num,findings_omitted:num,selected_evidence_complete:en(true),all_findings_included:bool,stale_reasons:arr(code,10),raw_ohlc_included:en(false)})),trading_enabled:en(false)});

function check(v:unknown,s:Spec,path='report'):void {
  const fail=()=>{throw Error(`Invalid desk-report contract at ${path}`);};
  if(v===null&&s.nullable)return;
  if(s.enum){if(!s.enum.includes(v))fail();return;}
  if(s.type==='array'){if(!Array.isArray(v)||v.length>(s.max??250))return fail();v.forEach((x,i)=>check(x,s.items!,`${path}[${i}]`));return;}
  if(s.type==='object'){
    if(!v||typeof v!=='object'||Array.isArray(v))return fail();const o=v as Record<string,unknown>;
    if(s.record){if(Object.keys(o).length>250)return fail();for(const [k,x]of Object.entries(o)){if(!s.keyPattern!.test(k))return fail();check(x,s.record,`${path}.${k}`);}return;}
    const props=s.properties!;if(Object.keys(o).some(k=>!Object.hasOwn(props,k))||Object.entries(props).some(([k,v])=>!v.optional&&!Object.hasOwn(o,k)))return fail();
    for(const [k,rule]of Object.entries(props))if(Object.hasOwn(o,k))check(o[k],rule,`${path}.${k}`);return;
  }
  if(typeof v!==s.type)return fail();
  if(s.type==='number'&&!Number.isFinite(v))fail();
  if(s.type==='string'&&(typeof v!=='string'||v.length>(s.max??160)||s.pattern&&!s.pattern.test(v)))fail();
  if(s.type==='string'&&s.pattern===time.pattern&&(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v))fail();
}

/** Unknown keys, raw OHLC, free text and unresolved evidence refs fail closed before publication. */
export function validateReport(value:unknown,symbol?:string,now?:number,secrets:string[]=[]):void {
  if(value&&typeof value==='object'&&'schema_version'in value&&value.schema_version==='pa-engine-v6'){validatePaReport(value,symbol,now,secrets);return;}
  const serialized=JSON.stringify(value);
  if(Buffer.byteLength(serialized)+1>MAX_REPORT_BYTES)throw Error('REPORT_TOO_LARGE');
  if(secrets.some(s=>s.length>=8&&serialized.includes(s))||/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(serialized))throw Error('SECRET_IN_REPORT');
  check(value,schema);
  // All fields have been checked above; the local structural view avoids depending on engine types.
  const r=value as {symbol:string;status:string;generated_at:string;as_of:string|null;expires_at:string;error:string|null;frames:{timeframe:string;last_closed_at:string|null}[];source:{price_side:string}|null;scenario:{confirmed_narrative:string|null;evidence_quality:{human_reviewed:boolean}}|null;candle_windows:string[][];rules:Record<string,unknown>;evidence:Record<string,{id:string;timeframe:string;origin:string;confirmed_at:string;rule:string;candle_refs:number[];lifecycle:{evaluated_through:string;invalidated_at:string|null;interactions:{candle:number}[]}|null}>};
  if(symbol&&r.symbol!==symbol)throw Error('WRONG_SYMBOL');
  const generated=Date.parse(r.generated_at),asof=r.as_of?Date.parse(r.as_of):null;
  if(!Number.isFinite(generated)||!Number.isFinite(Date.parse(r.expires_at))||r.expires_at<r.generated_at||asof!==null&&(!Number.isFinite(asof)||asof>generated)||now!==undefined&&(generated>now+30_000||generated<now-15*60_000))throw Error('INVALID_REPORT_TIME');
  if(now!==undefined&&r.status!=='ERROR'&&Date.parse(r.expires_at)<=now)throw Error('REPORT_EXPIRED');
  if(r.status!=='ERROR'&&(!r.source||!r.as_of||!r.scenario||r.frames.length!==4||new Set(r.frames.map(f=>f.timeframe)).size!==4))throw Error('INCOMPLETE_REPORT');
  const timing=value as {published_at?:string|null;freshness?:{quote_retrieved_at:string|null;quote_status:string;quote_max_seconds:number;delivery_max_seconds:number;h4_max_delay_seconds:number;stale_reasons:string[]};quote?:{retrieved_at:string|null;provider_timestamp:string|null;provider_age_seconds:number|null;fresh:boolean;market_status:string|null}|null;frames:{fetched_at:string}[]};
  if(r.status!=='ERROR'){
    const f=timing.freshness,q=timing.quote;
    if(!f||!q||!Object.hasOwn(timing,'published_at'))throw Error('MISSING_FRESHNESS');
    if(f.quote_max_seconds<60||f.quote_max_seconds>120||f.delivery_max_seconds<30||f.delivery_max_seconds>120||f.h4_max_delay_seconds<60||f.h4_max_delay_seconds>600)throw Error('INVALID_FRESHNESS_POLICY');
    if(f.quote_retrieved_at!==q.retrieved_at||timing.frames.some(x=>Date.parse(x.fetched_at)>generated)||q.retrieved_at&&Date.parse(q.retrieved_at)>generated||timing.published_at&&Date.parse(timing.published_at)<generated)throw Error('INVALID_REPORT_TIME');
    const age=q.provider_timestamp?(generated-Date.parse(q.provider_timestamp))/1000:null;
    if(age!==q.provider_age_seconds||age!==null&&age<0)throw Error('INVALID_QUOTE_TIME');
    if(f.quote_status==='FRESH'&&(!q.fresh||age===null||age>f.quote_max_seconds)||q.fresh&&f.quote_status!=='FRESH')throw Error('FALSE_FRESHNESS');
    if(f.quote_status==='MARKET_CLOSED'&&(q.market_status!=='CLOSED'||!q.retrieved_at||generated-Date.parse(q.retrieved_at)>f.delivery_max_seconds*1000))throw Error('FALSE_FRESHNESS');
    if(Date.parse(r.expires_at)>generated+f.delivery_max_seconds*1000||f.quote_status==='FRESH'&&Date.parse(r.expires_at)>Date.parse(q.provider_timestamp!)+f.quote_max_seconds*1000)throw Error('INVALID_EXPIRY');
    if(f.stale_reasons.length&&r.status!=='STALE')throw Error('FALSE_FRESHNESS');
  }
  if(r.status==='ERROR'&&!r.error)throw Error('MISSING_ERROR');
  if(r.scenario?.confirmed_narrative!==null&&r.scenario&&!r.scenario.evidence_quality.human_reviewed)throw Error('UNREVIEWED_CONFIRMATION');
  const technical=value as {technical_only?:boolean;scenario?:{action:string}|null;details?:{snapshot_sha256:string};source?:{evidence_sha256:string}|null};
  if(technical.technical_only&&technical.scenario?.action!=='NOT_EVALUATED')throw Error('TECHNICAL_RESPONSIBILITY_VIOLATION');
  if(technical.details&&technical.details.snapshot_sha256!==technical.source?.evidence_sha256)throw Error('SNAPSHOT_HASH_MISMATCH');
  const context=(value as {research_context?:{
    confirmed_narrative:string|null;observed_price_behaviour:{timeframe:string;last_observed_fractal_leg:{from_id:string;to_id:string;price_distance:number;direction:string;confirmed_at:string}|null}[];
    executive_evidence:{items:{level:string;current_role:string|null;current_role_status:string;first_interaction_at:string|null}[]};
    dealing_range_reviews:{timeframe:string;selected:null|{high:string|null;low:string|null;observed_boundaries_intact:boolean;candidate_suitable_for_review:boolean};candidates:{items:{high:string|null;low:string|null;observed_boundaries_intact:boolean;candidate_suitable_for_review:boolean}[]}}[];
    paths:{status:string;obstacles:{omitted:number};ohlc_coverage:string}[];full_inspection:{snapshot_sha256:string;as_of:string}
  }}).research_context;
  if(context){
    if(context.confirmed_narrative!==r.scenario?.confirmed_narrative||context.full_inspection.snapshot_sha256!==technical.source?.evidence_sha256||context.full_inspection.as_of!==r.as_of)throw Error('CONTEXT_SNAPSHOT_MISMATCH');
    if(context.observed_price_behaviour.length!==4||new Set(context.observed_price_behaviour.map(o=>o.timeframe)).size!==4)throw Error('INCOMPLETE_CONTEXT');
    function contextTimes(v:unknown){if(Array.isArray(v))v.forEach(contextTimes);else if(v&&typeof v==='object')Object.values(v).forEach(contextTimes);else if(typeof v==='string'&&time.pattern!.test(v)&&(!r.as_of||v>r.as_of))throw Error('FUTURE_CONTEXT');}contextTimes(context);
    const es=r.evidence as unknown as Record<string,{kind:string;lower:number;upper:number;confirmed_at:string;timeframe:string;lifecycle:{state:string;role_status:string;current_role:string|null;coverage:string;liquidity_consumed:boolean;evaluated_through:string}|null}>;
    for(const o of context.observed_price_behaviour){const leg=o.last_observed_fractal_leg;if(!leg)continue;const a=es[leg.from_id],b=es[leg.to_id];
      if(!a||!b||a.kind!=='FRACTAL'||b.kind!=='FRACTAL'||a.timeframe!==o.timeframe||b.timeframe!==o.timeframe||Math.abs(leg.price_distance-(b.lower-a.lower))>1e-9||leg.direction!==(leg.price_distance>0?'UP':leg.price_distance<0?'DOWN':'FLAT')||leg.confirmed_at!==[a.confirmed_at,b.confirmed_at].sort().at(-1))throw Error('INVALID_OBSERVED_LEG');}
    for(const l of context.executive_evidence.items){const e=es[l.level];if(!e||!e.lifecycle||l.current_role_status==='UNVERIFIED'&&l.current_role!==null||l.current_role_status==='VERIFIED'&&(e.lifecycle.role_status!=='RETEST_CONFIRMED'||e.lifecycle.current_role!==l.current_role)||l.first_interaction_at&&(l.first_interaction_at<e.confirmed_at||l.first_interaction_at>e.lifecycle.evaluated_through))throw Error('INVALID_ROLE_CONTEXT');}
    for(const f of context.dealing_range_reviews)for(const v of [...f.candidates.items,...(f.selected?[f.selected]:[])]){
      const high=v.high?es[v.high]:null,low=v.low?es[v.low]:null;
      const intact=!!high&&!!low&&[high,low].every(e=>e.kind==='FRACTAL'&&e.timeframe===f.timeframe&&e.lifecycle?.state==='ACTIVE'&&!e.lifecycle.liquidity_consumed&&e.lifecycle.coverage==='COMPLETE_OBSERVED_INTERVAL');
      if(v.observed_boundaries_intact!==intact||v.candidate_suitable_for_review&&!intact)throw Error('INVALID_RANGE_REVIEW');}
    for(const p of context.paths)if(p.status==='COMPLETE'&&(p.obstacles.omitted!==0||p.ohlc_coverage!=='COMPLETE'))throw Error('FALSE_PATH_COMPLETENESS');
    type Detection={status:string;direction:string|null;high:string|null;low:string|null;lower:number|null;upper:number|null;equilibrium:number|null;start_at:string|null;end_at:string|null;confirmed_at:string|null;close_break_at:string|null;premium_discount:string|null};
    const reviews=context.dealing_range_reviews as (typeof context.dealing_range_reviews[number]&{detection?:Detection;selected:null|{high:string|null;low:string|null;active_dealing_range?:boolean;premium_discount?:string|null}})[];
    for(const f of reviews){const d=f.detection;if(!d){if(f.selected?.active_dealing_range)throw Error('FALSE_DR_CONFIRMATION');continue;}
      if(d.status==='AWAITING_CONFIRMED_PAIR'){if(d.high!==null||d.low!==null||d.premium_discount!==null)throw Error('UNCONFIRMED_DR');continue;}
      const h=d.high?es[d.high]:null,l=d.low?es[d.low]:null;
      if(!h||!l||h.kind!=='FRACTAL'||l.kind!=='FRACTAL'||h.timeframe!==f.timeframe||l.timeframe!==f.timeframe||d.lower!==l.lower||d.upper!==h.upper||d.lower!>=d.upper!||d.equilibrium!==(d.lower!+d.upper!)/2||!d.start_at||!d.end_at||d.start_at>=d.end_at||d.confirmed_at!==[h.confirmed_at,l.confirmed_at].sort().at(-1))throw Error('INVALID_DIRECTIONAL_DR');
      const evidence=r.evidence as unknown as Record<string,{candle_refs:number[];polarity:string}>;
      const highAt=r.candle_windows[evidence[d.high!].candle_refs[1]]?.[0],lowAt=r.candle_windows[evidence[d.low!].candle_refs[1]]?.[0];
      if(evidence[d.high!].polarity!=='high'||evidence[d.low!].polarity!=='low'||d.direction!==(lowAt<highAt?'Bullish':'Bearish')||d.start_at!==[highAt,lowAt].sort()[0]||d.end_at!==[highAt,lowAt].sort()[1])throw Error('INVALID_DR_ORDER');
      const active=d.status==='ESTABLISHED';
      const observation=context.observed_price_behaviour.find(o=>o.timeframe===f.timeframe) as {reference_close?:number|null}|undefined;
      if(active&&(observation?.reference_close==null||observation.reference_close<d.lower!||observation.reference_close>d.upper!||d.premium_discount!==(observation.reference_close<d.equilibrium!?'DISCOUNT':observation.reference_close>d.equilibrium!?'PREMIUM':'EQUILIBRIUM')))throw Error('INVALID_DR_POSITION');
      if(active&&d.close_break_at!==null||!active&&d.premium_discount!==null||active&&d.premium_discount===null||d.close_break_at&&d.close_break_at<d.confirmed_at!)throw Error('INVALID_DR_STATE');
      if(f.selected?.active_dealing_range&&(f.selected.high!==d.high||f.selected.low!==d.low||!active||f.selected.premium_discount!==d.premium_discount))throw Error('FALSE_DR_CONFIRMATION');
    }
    const selection=(context as typeof context&{dealing_range_selection?:{timeframe:string|null;skipped:{timeframe:string;reason:string}[]}}).dealing_range_selection;
    if(selection){const ordered=['MN1','W1','D1','H4'].map(tf=>reviews.find(f=>f.timeframe===tf)),first=ordered.find(f=>f?.detection?.status==='ESTABLISHED');
      if(selection.timeframe!==(first?.timeframe??null)||selection.skipped.map(x=>x.timeframe).join(',')!==ordered.slice(0,first?ordered.indexOf(first):4).map(f=>f?.timeframe).join(','))throw Error('INVALID_DR_FALLBACK');}
  }
  const ids=new Set<string>();
  type RbEvidence={kind:string;rule:string;timeframe:string;direction:string;polarity:string;lower:number;upper:number;origin:string;confirmed_at:string;candle_refs:number[];dependencies:string[];rb?:{level_price:number;basis:string;relative_quality:string;primary_kl:string;liquidity:string|null;fvg:string|null}};
  const rbEvidence=r.evidence as unknown as Record<string,RbEvidence>;
  for(const e of Object.values(rbEvidence)){
    if(e.rule==='EDGE.RB.v2'&&!e.rb)throw Error('MISSING_RB_METADATA');
    const b=e.rb;if(!b)continue;
    const primary=rbEvidence[b.primary_kl],liquidity=b.liquidity?rbEvidence[b.liquidity]:null,fvg=b.fvg?rbEvidence[b.fvg]:null;
    const first=r.candle_windows[e.candle_refs[0]],second=r.candle_windows[e.candle_refs[1]];
    if(e.kind!=='RB_TWO_CANDLE'||e.rule!=='EDGE.RB.v2'||e.candle_refs.length!==2||!first||!second||first[1]!==second[0]||second[1]!==e.confirmed_at||e.lower!==b.level_price||e.upper!==b.level_price||!['bullish','bearish'].includes(e.direction))throw Error('INVALID_RB_GEOMETRY');
    if(!primary||b.primary_kl!==b.liquidity&&b.primary_kl!==b.fvg||!liquidity&&!fvg||liquidity&&liquidity.kind!=='FRACTAL'||fvg&&fvg.kind!=='FVG')throw Error('INVALID_RB_CONTEXT');
    if(liquidity&&(liquidity.polarity!==(e.direction==='bullish'?'low':'high')||(e.direction==='bullish'?b.level_price<=liquidity.upper:b.level_price>=liquidity.lower))||fvg&&fvg.direction!==e.direction)throw Error('INVALID_RB_DIRECTION');
    for(const id of [b.primary_kl,b.liquidity,b.fvg].filter((id):id is string=>!!id)){const kl=rbEvidence[id];if(!kl||!e.dependencies.includes(id)||kl.confirmed_at>first[0]||['MN1','W1','D1','H4'].indexOf(kl.timeframe)>['MN1','W1','D1','H4'].indexOf(e.timeframe))throw Error('NONCAUSAL_RB_CONTEXT');}
    if(b.relative_quality!==(liquidity?'RAID_BACKED':'WEAKER_FVG_ONLY')||b.basis!==(liquidity?(fvg?'FVG_AND_LIQUIDITY_RAID':'LIQUIDITY_RAID'):'FVG_INTERACTION'))throw Error('FALSE_RB_QUALITY');
  }
  type SnrMeta={level_price:number;origin_confirmed_at:string;delivery_at:string;breakout_at:string;waiting_bars:number;formation_seconds:number;failed_test_bars:number;failed_test_episodes:number;test_windows:number[];breakout_body:number;breakout_body_fraction:number;prior_body_sample:number;body_to_prior_median:number|null;impulse_leg_bars:number;impulse_leg_body_to_median:number|null;impulse_leg_efficiency:number;impulse_detected:boolean;impulse_evidence:string;relative_strength:string;primary_kl:string;x1_fvg:string|null;opposing_kl:string|null;opposing_bounds?:{lower:number;upper:number}|null};
  const snrs=r.evidence as unknown as Record<string,RbEvidence&{snr?:SnrMeta}>;
  for(const e of Object.values(snrs)){
    if(e.rule==='EDGE.SNR.v2'&&!e.snr)throw Error('MISSING_SNR_METADATA');const s=e.snr;if(!s)continue;
    const cw=e.candle_refs.map(i=>r.candle_windows[i]),kl=snrs[s.primary_kl],x1=s.x1_fvg?snrs[s.x1_fvg]:null,opposing=s.opposing_kl?snrs[s.opposing_kl]:null;
    if(e.kind!=='SNR_CLOSED_BREAK'||e.rule!=='EDGE.SNR.v2'||cw.length!==4||cw.some(w=>!w)||cw[0][1]!==cw[1][0]||cw[1][1]!==s.origin_confirmed_at||cw[2][1]!==s.delivery_at||cw[3][1]!==s.breakout_at||s.breakout_at!==e.confirmed_at||cw[2][0]<s.origin_confirmed_at||s.delivery_at>s.breakout_at||e.lower!==s.level_price||e.upper!==s.level_price||!['bullish','bearish'].includes(e.direction))throw Error('INVALID_SNR_GEOMETRY');
    if(!kl||!['FRACTAL','FVG'].includes(kl.kind)||!e.dependencies.includes(s.primary_kl)||kl.confirmed_at>cw[2][0]||['MN1','W1','D1','H4'].indexOf(kl.timeframe)>['MN1','W1','D1','H4'].indexOf(e.timeframe))throw Error('NONCAUSAL_SNR_CONTEXT');
    if(kl.kind==='FRACTAL'?kl.polarity!==(e.direction==='bullish'?'low':'high'):kl.direction!==e.direction)throw Error('INVALID_SNR_DIRECTION');
    if([s.waiting_bars,s.failed_test_bars,s.failed_test_episodes,s.prior_body_sample,s.impulse_leg_bars].some(n=>!Number.isInteger(n)||n<0)||s.failed_test_episodes>s.failed_test_bars||s.failed_test_bars>s.waiting_bars||s.failed_test_bars!==s.test_windows.length||s.prior_body_sample>20||s.impulse_leg_bars>s.waiting_bars+1||s.formation_seconds!==(Date.parse(s.breakout_at)-Date.parse(s.origin_confirmed_at))/1000||s.breakout_body<0||s.breakout_body_fraction<0||s.breakout_body_fraction>1||s.impulse_leg_efficiency<0||s.impulse_leg_efficiency>1||s.body_to_prior_median!==null&&s.body_to_prior_median<0||s.impulse_leg_body_to_median!==null&&s.impulse_leg_body_to_median<0)throw Error('INVALID_SNR_METRICS');
    let episodes=0,last:string|null=null;for(const i of s.test_windows){const w=r.candle_windows[i];if(!Number.isInteger(i)||!w||w[0]<s.origin_confirmed_at||w[1]>cw[3][0]||last&&w[0]<last)throw Error('NONCAUSAL_SNR_TEST');if(w[0]!==last)episodes++;last=w[1];}if(episodes!==s.failed_test_episodes)throw Error('INVALID_SNR_TEST_EPISODES');
    for(const id of [s.x1_fvg,s.opposing_kl].filter((id):id is string=>!!id)){if(!snrs[id]||!e.dependencies.includes(id)||snrs[id].confirmed_at>e.confirmed_at)throw Error('NONCAUSAL_SNR_CONTEXT');}
    if(s.x1_fvg&&(!x1||x1.kind!=='FVG'||x1.direction!==e.direction||['MN1','W1','D1','H4'].indexOf(x1.timeframe)!==['MN1','W1','D1','H4'].indexOf(e.timeframe)+1||x1.confirmed_at<cw[3][0]||x1.origin<(last??cw[2][0])||x1.lower>s.level_price||x1.upper<s.level_price))throw Error('INVALID_SNR_X1');
    if(s.opposing_kl&&(!opposing||opposing.confirmed_at>cw[3][0]||['MN1','W1','D1','H4'].indexOf(opposing.timeframe)>['MN1','W1','D1','H4'].indexOf(e.timeframe)||(e.direction==='bullish'?(s.opposing_bounds?.lower??opposing.lower)<=s.level_price:(s.opposing_bounds?.upper??opposing.upper)>=s.level_price)))throw Error('INVALID_SNR_OPPOSING');
    if(s.opposing_bounds&&(!opposing||s.opposing_bounds.lower<opposing.lower||s.opposing_bounds.upper>opposing.upper||s.opposing_bounds.lower>s.opposing_bounds.upper))throw Error('INVALID_SNR_OPPOSING_BOUNDS');
    if(opposing&&(opposing.kind==='FRACTAL'?opposing.polarity!==(e.direction==='bullish'?'high':'low'):opposing.kind!=='FVG'||opposing.direction===(e.direction)))throw Error('INVALID_SNR_OPPOSING_ROLE');
    const measured=s.prior_body_sample>=5&&s.impulse_leg_body_to_median!==null&&s.impulse_leg_body_to_median>=2&&s.impulse_leg_efficiency>=0.6&&s.impulse_leg_bars>0,impulse=measured||!!x1;
    if(s.impulse_detected!==impulse||s.impulse_evidence!==(measured?(x1?'MEASURED_EXPANSION_AND_X1_FVG':'MEASURED_EXPANSION'):x1?'X1_FVG_AT_BREAK':'BODY_METRICS_ONLY')||s.relative_strength!==(opposing?'CONTEXT_CONFLICT':s.failed_test_episodes>=2&&impulse?'VERY_STRONG_FORMATION_CANDIDATE':'REVIEW_REQUIRED'))throw Error('FALSE_SNR_STRENGTH');
  }
  for(const w of r.candle_windows)if(w.length!==2||w[0]>=w[1]||!r.as_of||w[1]>r.as_of)throw Error('FUTURE_CANDLE');
  for(const e of Object.values(r.evidence)){
    if(['BOS','CHOCH','ORDER_BLOCK','BREAKER'].includes((e as {kind?:string}).kind??''))throw Error('UNSUPPORTED_AUTHOR_RULE');
    if(!r.source||!e.id.startsWith(`${r.symbol}:${e.timeframe}:${r.source.price_side}:`)||ids.has(e.id))throw Error('INVALID_EVIDENCE_ID');ids.add(e.id);
    const unknownIdTokens=e.id.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,'').replace(/\b(EURUSD|NAS100|JP225|EU50|MN1|W1|D1|H4|bid|ask|high|low|FRACTAL|FVG|FVG_CLOSED_BREACH|RB_TWO_CANDLE|SNR_CLOSED_BREAK|RAID|BOS|CHOCH|IDM_INSIDE_POI|STRONG_PIVOT_CANDIDATE|DEALING_RANGE|INTERNAL_LIQUIDITY)\b/g,'').replace(/[:0-9.\-]/g,'');
    if(unknownIdTokens)throw Error('INVALID_EVIDENCE_ID');
    if((e as {kind?:string}).kind==='FRACTAL'&&((e as {variant?:number}).variant!==3||e.candle_refs.length!==3||e.rule!=='EDGE.FRACTAL_3.v1'||!e.id.includes(':3:')))throw Error('UNSUPPORTED_FRACTAL_VARIANT');
    const end=Date.parse(e.confirmed_at);if(asof===null||!Number.isFinite(end)||end>asof||Date.parse(e.origin)>end)throw Error('FUTURE_EVIDENCE');
    if(!Object.hasOwn(r.rules,e.rule))throw Error('MISSING_RULE');
    if(!e.candle_refs.length||!e.candle_refs.some(index=>r.candle_windows[index]?.[1]===e.confirmed_at))throw Error('MISSING_CONFIRMATION_CANDLE');
    for(const index of e.candle_refs){const w=r.candle_windows[index];if(!Number.isInteger(index)||!w||w.length!==2||!Number.isFinite(Date.parse(w[0]))||!Number.isFinite(Date.parse(w[1]))||w[0]>=w[1]||w[1]>e.confirmed_at)throw Error('FUTURE_CANDLE');}
    if(e.lifecycle){if(e.lifecycle.evaluated_through>r.as_of!||e.lifecycle.invalidated_at&&e.lifecycle.invalidated_at>e.lifecycle.evaluated_through)throw Error('FUTURE_STATE');for(const i of e.lifecycle.interactions){const w=r.candle_windows[i.candle];if(!Number.isInteger(i.candle)||!w||w[0]<e.confirmed_at||w[1]>e.lifecycle.evaluated_through||w[0]>=w[1])throw Error('FUTURE_INTERACTION');}}
    const lifecycle=e.lifecycle as typeof e.lifecycle&{state?:string;initial_role?:string;current_role?:string|null;fill?:{state:string;max_observed_fraction:number;first_test_at:string|null;last_test_at:string|null;revision?:string;remaining?:{lower:number;upper:number}|null;fully_tested_at?:string|null}};
    if(technical.technical_only&&lifecycle&&(lifecycle.state==='INVALIDATED'&&!lifecycle.invalidated_at||['INVALIDATED','TESTED','CONSUMED','UNVERIFIED'].includes(lifecycle.state??'')&&lifecycle.current_role!==null))throw Error('CONTRADICTORY_LIFECYCLE');
    const fill=lifecycle?.fill;
    if(fill?.revision==='fvg-unfilled-1'){
      const f=fill.max_observed_fraction,original=e as typeof e&{lower:number;upper:number},rem=fill.remaining,role=lifecycle!.initial_role;
      if((fill.state==='FILLED')!==(f===1)||f===1&&!['TESTED','INVALIDATED'].includes(lifecycle!.state!)||lifecycle!.state==='TESTED'&&f!==1||f===1&&!fill.fully_tested_at||f<1&&fill.fully_tested_at)throw Error('CONTRADICTORY_FVG_TEST');
      if(fill.fully_tested_at&&(fill.fully_tested_at<e.confirmed_at||fill.fully_tested_at>lifecycle!.evaluated_through))throw Error('FUTURE_FVG_TEST');
      if(f===1||lifecycle!.state==='INVALIDATED'){if(rem!==null)throw Error('TESTED_FVG_HAS_REMAINDER');}
      else {const lower=role==='support'?original.lower:original.lower+(original.upper-original.lower)*f,upper=role==='support'?original.upper-(original.upper-original.lower)*f:original.upper,tolerance=Math.max(1,Math.abs(original.upper))*1e-12;
        if(!rem||!['support','resistance'].includes(role??'')||rem.lower>=rem.upper||Math.abs(rem.lower-lower)>tolerance||Math.abs(rem.upper-upper)>tolerance)throw Error('INVALID_FVG_REMAINDER');}
    }
    if(fill){if(fill.max_observed_fraction<0||fill.max_observed_fraction>1||fill.state==='FILLED'&&fill.max_observed_fraction!==1)throw Error('INVALID_FILL');
      if([fill.first_test_at,fill.last_test_at].some(t=>t&&(t<e.confirmed_at||t>lifecycle!.evaluated_through)))throw Error('FUTURE_INTERACTION');
      if(fill.first_test_at&&fill.last_test_at&&fill.first_test_at>fill.last_test_at)throw Error('INVALID_FILL');}
  }
  for(const f of r.frames){
    const snrFrame=f as typeof f&{snr:{total:number};snr_quality?:{very_strong_candidates:number;context_conflicts:number;review_required:number}};
    if(snrFrame.snr_quality){const counts=Object.values(snrFrame.snr_quality);if(counts.some(n=>!Number.isInteger(n)||n<0)||counts.reduce((a,b)=>a+b,0)!==snrFrame.snr.total)throw Error('INVALID_SNR_COUNTS');}
    const rbFrame=f as typeof f&{rb:{total:number};rb_quality?:{raid_backed:number;fvg_only_weaker:number}};
    if(rbFrame.rb_quality){const q=rbFrame.rb_quality;if(!Number.isInteger(q.raid_backed)||!Number.isInteger(q.fvg_only_weaker)||q.raid_backed<0||q.fvg_only_weaker<0||q.raid_backed+q.fvg_only_weaker!==rbFrame.rb.total)throw Error('INVALID_RB_COUNTS');}
    if(f.last_closed_at&&(!r.as_of||f.last_closed_at>r.as_of))throw Error('FUTURE_FRAME');
    const options=(f as typeof f&{range_options?:{total:number;omitted:number};range_candidate?:unknown}).range_options;
    if(options&&(!Number.isInteger(options.total)||!Number.isInteger(options.omitted)||options.omitted<0||options.total-options.omitted!==((f as {range_candidate?:unknown}).range_candidate?1:0)))throw Error('INVALID_COVERAGE_COUNTS');
    type Pair={high:string;low:string;lower:number;upper:number;equilibrium:number;confirmed_at:string};
    const pairs=f as typeof f&{range_candidate?:Pair|null;dealing_range?:Pair|null};
    for(const candidate of [pairs.range_candidate,pairs.dealing_range]){
    if(!candidate)continue;
    const levels=r.evidence as unknown as Record<string,{kind:string;variant:number|null;polarity:string|null;timeframe:string;lower:number|null;upper:number|null;confirmed_at:string}>;
    const high=levels[candidate.high],low=levels[candidate.low];
    if(!high||!low||high.kind!=='FRACTAL'||low.kind!=='FRACTAL'||high.variant!==3||low.variant!==3||
      high.polarity!=='high'||low.polarity!=='low'||high.timeframe!==f.timeframe||low.timeframe!==f.timeframe||
      high.upper!==candidate.upper||low.lower!==candidate.lower||candidate.lower>=candidate.upper||
      candidate.confirmed_at!==(high.confirmed_at>low.confirmed_at?high.confirmed_at:low.confirmed_at)||
      Math.abs(candidate.equilibrium-(candidate.lower+candidate.upper)/2)>1e-10*Math.max(1,Math.abs(candidate.equilibrium)))throw Error('INVALID_RANGE_CANDIDATE');
    }
  }
  function refs(v:unknown):void{if(typeof v==='string'&&/^e\d{1,4}$/.test(v)&&!Object.hasOwn(r.evidence,v))throw Error('MISSING_EVIDENCE');if(Array.isArray(v))v.forEach(refs);else if(v&&typeof v==='object')Object.values(v).forEach(refs);}refs(value);
  function counts(v:unknown):void{if(Array.isArray(v)){v.forEach(counts);return;}if(!v||typeof v!=='object')return;const x=v as Record<string,unknown>;
    if(Array.isArray(x.items)&&typeof x.total==='number'&&typeof x.omitted==='number'&&(!Number.isInteger(x.total)||!Number.isInteger(x.omitted)||x.omitted<0||x.total!==x.items.length+x.omitted))throw Error('INVALID_COVERAGE_COUNTS');
    Object.values(x).forEach(counts);
  }counts(value);
  validateTdaRelations(value);
  validateNarrativeMethod(value);
}

function validateNarrativeMethod(value:unknown){
 type E={kind:string;timeframe:string;lower:number;upper:number;confirmed_at:string;polarity:string;direction:string;lifecycle:{state:string;liquidity_consumed:boolean;fill?:{remaining?:{lower:number;upper:number}|null}}|null};
 type Boundary={evaluated_through:string;price:number;timeframe:string;source_ids:string[];known_at:string;kind:string;wick_breached:boolean|null;wick_at:string|null;close_breached:boolean|null;close_at:string|null;coverage:string};
 type Candidate={selected:boolean;direction:string;current_reaction:boolean;A:{kind:string;timeframe:string;lower:number;upper:number;entry:number;confirmed_at:string;source_ids:string[]};quality:{score:number|null;factors:{code:string;delta:number}[];hold_episodes:number;anchor_position:string};delivery:null|{score:number|null;from:string|null;through:string|null;contact_at:string|null;bars:number;efficiency:number|null;body_ratio:number|null;opposing:{total:number};reason:string};B:null|{level:string;timeframe:string;price:number;confirmed_at:string};C:Boundary|null;entry_stop:Boundary|null;rr:null|{risk:number;reward:number;ratio:number}};
 const r=value as {as_of:string;evidence:Record<string,E>;frames:{timeframe:string;structure:{swing_basis:string;swing_bias:string;swing_evidence:string[]}}[];narrative_method?:{contexts:{timeframe:string;position:string}[];primary_context:string|null;mn1_w1_conflict:boolean;selection_status:string;candidates:{items:Candidate[]}}};
 const m=r.narrative_method;if(!m)return;const order=['MN1','W1','D1','H4'],get=(id:string)=>{const e=r.evidence[id];if(!e)throw Error('MISSING_METHOD_EVIDENCE');return e;},clip=(n:number)=>Math.max(1,Math.min(5,n));
 if(m.contexts.map(c=>c.timeframe).join(',')!==order.join(',')||m.primary_context!==(m.contexts.slice(0,3).find(c=>c.position!=='UNVERIFIED')?.timeframe??null))throw Error('INVALID_CONTEXT_PRIORITY');
 const [mn,w]=m.contexts,conflict=m.primary_context==='MN1'&&['PREMIUM','DISCOUNT'].includes(mn.position)&&['PREMIUM','DISCOUNT'].includes(w.position)&&mn.position!==w.position;if(conflict!==m.mn1_w1_conflict)throw Error('INVALID_CONTEXT_CONFLICT');
 for(const f of r.frames){const s=f.structure,es=s.swing_evidence.map(get);if(es.some(e=>e.kind!=='FRACTAL'||e.timeframe!==f.timeframe))throw Error('INVALID_TREND_EVIDENCE');
  const h=es.filter(e=>e.polarity==='high'),l=es.filter(e=>e.polarity==='low');if(s.swing_basis==='OBSERVED_FRACTAL_SEQUENCE'){
   if(h.length!==2||l.length!==2||h[0].confirmed_at>h[1].confirmed_at||l[0].confirmed_at>l[1].confirmed_at)throw Error('INVALID_TREND_SEQUENCE');
   const bias=h[1].upper>h[0].upper&&l[1].lower>l[0].lower?'Bullish':h[1].upper<h[0].upper&&l[1].lower<l[0].lower?'Bearish':'Neutral';if(s.swing_bias!==bias)throw Error('FALSE_FRACTAL_TREND');
  }else if(s.swing_basis==='INSUFFICIENT_CONFIRMED_PIVOTS'&&(s.swing_bias!=='Neutral'||h.length===2&&l.length===2))throw Error('FALSE_FRACTAL_TREND');
 }
 for(const c of m.candidates.items){const a=c.A,up=c.direction==='Bullish';if(a.lower>a.upper||a.entry!==(up?a.upper:a.lower)||a.confirmed_at>r.as_of||!a.source_ids.length)throw Error('INVALID_METHOD_A');
  const sources=a.source_ids.map(get);if(sources.some(e=>e.confirmed_at>a.confirmed_at))throw Error('FUTURE_METHOD_A');
  if(a.kind==='DR_EQ'){const h=sources.find(e=>e.polarity==='high'),l=sources.find(e=>e.polarity==='low');if(a.timeframe!=='H4'||sources.length!==2||!h||!l||sources.some(e=>e.kind!=='FRACTAL'||e.timeframe!=='H4')||a.entry!==(h.upper+l.lower)/2||a.lower!==a.upper)throw Error('INVALID_EQ_FALLBACK');}
  else {const e=sources[0];if(sources.length!==1||e.timeframe!==a.timeframe||e.confirmed_at!==a.confirmed_at||e.kind!==({RB:'RB_TWO_CANDLE',SNR:'SNR_CLOSED_BREAK'}[a.kind]??a.kind)||a.lower<e.lower||a.upper>e.upper||e.kind==='FVG'&&e.lifecycle?.state!=='ACTIVE')throw Error('INVALID_METHOD_A');}
  const q=c.quality;if(q.factors.map(f=>f.code).join(',')!=='BASE,HTF_PRIORITY,FAVORABLE_LOCATION,REPEATED_HOLDS,RAID_BACKED,MN1_W1_CONFLICT,TREND_CONFLICT,OPPOSING_HTF_POI'||q.factors[5].delta!==(conflict?-1:0)||!Number.isInteger(q.hold_episodes)||q.hold_episodes<0)throw Error('INVALID_SCORE_FACTORS');
  const known=m.primary_context!==null&&['PREMIUM','DISCOUNT','EQUILIBRIUM'].includes(q.anchor_position),computed=clip(clip(q.factors.slice(0,5).reduce((n,f)=>n+f.delta,0))+q.factors.slice(5).reduce((n,f)=>n+f.delta,0));if(q.score!==(known?computed:null))throw Error('FALSE_QUALITY_SCORE');
  const d=c.delivery;if(d){if(d.from&&d.through&&(d.from>d.through||d.through>r.as_of||d.contact_at&&d.through>d.contact_at)||d.contact_at&&d.contact_at>r.as_of||d.efficiency!==null&&(d.efficiency<0||d.efficiency>1)||d.body_ratio!==null&&d.body_ratio<0)throw Error('FUTURE_APPROACH_EVIDENCE');
   if(d.score!==null){if(d.bars<3||d.bars>6||d.efficiency===null||d.body_ratio===null||!d.from||!d.through)throw Error('UNSUPPORTED_APPROACH_SCORE');const strong=d.efficiency>=0.7&&d.body_ratio>=1.5,weak=d.efficiency<=0.35&&d.body_ratio<=1,score=strong?(d.opposing.total?1:2):d.opposing.total?2:weak?5:d.body_ratio<=1?4:3;if(d.score!==score||['INSUFFICIENT_APPROACH_HISTORY','NOT_APPROACHING_POI'].includes(d.reason))throw Error('FALSE_APPROACH_SCORE');}
  }
  for(const b of [c.C,c.entry_stop])if(b){if(!b.source_ids.length||b.known_at<a.confirmed_at||b.known_at>r.as_of||b.evaluated_through>r.as_of||b.source_ids.map(get).some(e=>e.confirmed_at>b.known_at)||[b.wick_at,b.close_at].some(t=>t&&(t<b.known_at||t>b.evaluated_through))||b.wick_breached!==(b.wick_at?true:b.coverage==='COMPLETE'?false:null)||b.close_breached!==(b.close_at?true:b.coverage==='COMPLETE'?false:null))throw Error('INVALID_METHOD_C');}
  if(c.entry_stop&&(c.entry_stop.wick_breached!==false||!(up?c.entry_stop.price<a.entry:c.entry_stop.price>a.entry)))throw Error('INVALID_ENTRY_STOP');
  if(c.B){const b=get(c.B.level),bounds=b.lifecycle?.fill?.remaining??b; if(c.B.price!==(up?bounds.lower:bounds.upper)||b.kind==='FRACTAL'&&b.polarity!==(up?'high':'low')||b.kind==='FVG'&&b.direction!==(up?'bearish':'bullish'))throw Error('INVALID_TARGET_GEOMETRY');if(!['FRACTAL','FVG'].includes(b.kind)||b.timeframe!==c.B.timeframe||b.confirmed_at!==c.B.confirmed_at||b.lifecycle?.state!=='ACTIVE'||b.lifecycle.liquidity_consumed||!order.slice(order.indexOf(a.timeframe),order.indexOf(a.timeframe)+2).includes(b.timeframe)||!(up?c.B.price>a.entry:c.B.price<a.entry))throw Error('INVALID_METHOD_B');}
  if(c.rr){if(!c.B||!c.entry_stop||!c.C||c.C.close_breached!==false)throw Error('RR_WITHOUT_ABC');const risk=up?a.entry-c.entry_stop.price:c.entry_stop.price-a.entry,reward=up?c.B.price-a.entry:a.entry-c.B.price;if(risk<=0||reward<=0||c.rr.risk!==risk||c.rr.reward!==reward||Math.abs(c.rr.ratio-reward/risk)>1e-10)throw Error('INVALID_RISK_REWARD');}
  if(c.selected&&(!c.current_reaction||q.score===null||c.C?.close_breached===true||m.selection_status!=='CANDIDATE_SELECTED'))throw Error('FALSE_METHOD_SELECTION');
 }
 if(m.candidates.items.filter(c=>c.selected).length!==(m.selection_status==='CANDIDATE_SELECTED'?1:0))throw Error('MISSING_METHOD_SELECTION');
}

/** Cross-field checks shared with the publisher, beyond JSON shape validation. */
function validateTdaRelations(value:unknown){
 type Group={items:string[];total:number;omitted:number};
 type Pair={timeframe:string;high:string;low:string;confirmed_at:string};
 type Evidence={kind:string;timeframe:string;confirmed_at:string;lower:number;upper:number;polarity:string;direction:string;candle_refs:number[];lifecycle:{state:string;coverage:string;liquidity_consumed:boolean}|null};
 type Anchor={level:string;liquidity_available:boolean|null;last_contact_at:string|null;vc:Group;vc_timeframe:string|null;vc_status:string;triggers:Group;refinements:{items:{trigger:string;confirmed_at:string;vc:Group;vc_timeframe:string|null;status:string}[]};range:Pair|null;delivery:{at:string}|null};
 const r=value as {as_of:string;scenario:{A:{selected:string|null}}|null;evidence:Record<string,Evidence>;candle_windows:string[][];tda?:{selected_anchor:string|null;anchors:{items:Anchor[]};range_pois:(Pair&{triggers:Group})[];potential_target:string|null;target_status:string}};
 const t=r.tda;if(!t)return;const order=['MN1','W1','D1','H4'],next=(tf:string)=>order[order.indexOf(tf)+1]??null;
 const get=(id:string)=>{const e=r.evidence[id];if(!e)throw Error('MISSING_TDA_EVIDENCE');return e;};
 const checkVc=(parent:Evidence,g:Group,tf:string|null,status:string)=>{
  if(tf!==next(parent.timeframe)||status!==(tf?g.total?'VC_OBSERVED':'AWAITING_VC':'LOWER_TIMEFRAME_UNAVAILABLE'))throw Error('INVALID_TDA_VC_TIMEFRAME');
  for(const id of g.items){const e=get(id),first=r.candle_windows[e.candle_refs[0]];
   if(!['FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(e.kind)||e.timeframe!==tf||!first||first[0]<parent.confirmed_at||e.confirmed_at<=parent.confirmed_at)throw Error('NONCAUSAL_TDA_VC');
   const bullish=parent.kind==='FRACTAL'?parent.polarity==='low':parent.direction==='bullish';if((e.direction==='bullish')!==bullish)throw Error('INVALID_TDA_DIRECTION');
  }
 };
 const trigger=(parent:Evidence,id:string)=>{const e=get(id),first=r.candle_windows[e.candle_refs[0]];
  if(e.kind!=='FRACTAL'||![parent.timeframe,next(parent.timeframe)].includes(e.timeframe)||!first||first[0]<parent.confirmed_at||e.lower<parent.lower||e.upper>parent.upper)throw Error('INVALID_TDA_TRIGGER');return e;};
 const pair=(q:Pair)=>{const h=get(q.high),l=get(q.low);if(h.kind!=='FRACTAL'||l.kind!=='FRACTAL'||h.polarity!=='high'||l.polarity!=='low'||h.timeframe!==q.timeframe||l.timeframe!==q.timeframe||l.lower>=h.upper||q.confirmed_at!==[h.confirmed_at,l.confirmed_at].sort().at(-1))throw Error('INVALID_TDA_RANGE');};
 if(t.selected_anchor!==(r.scenario?.A.selected??null))throw Error('INVALID_TDA_ANCHOR');
 for(const a of t.anchors.items){const e=get(a.level),s=e.lifecycle;
  if(!s||s.coverage!=='COMPLETE_OBSERVED_INTERVAL'||!(e.kind==='FVG'?s.state==='ACTIVE':e.kind==='FRACTAL'?['ACTIVE','CONSUMED'].includes(s.state):['RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(e.kind)&&['ACTIVE','CANDIDATE'].includes(s.state)))throw Error('INVALID_TDA_POI');
  if(a.liquidity_available!==(e.kind==='FRACTAL'?!s.liquidity_consumed:null))throw Error('FALSE_TDA_LIQUIDITY');
  if(a.last_contact_at&&(a.last_contact_at<e.confirmed_at||a.last_contact_at>r.as_of)||a.delivery&&(a.delivery.at!==a.last_contact_at||a.delivery.at>r.as_of))throw Error('FUTURE_TDA_CONTACT');
  checkVc(e,a.vc,a.vc_timeframe,a.vc_status);for(const id of a.triggers.items)trigger(e,id);
  for(const x of a.refinements.items){const f=trigger(e,x.trigger);if(x.confirmed_at!==f.confirmed_at)throw Error('FUTURE_TDA_TRIGGER');checkVc(f,x.vc,x.vc_timeframe,x.status);}
  if(a.range)pair(a.range);
 }
 for(const q of t.range_pois){pair(q);const h=get(q.high),l=get(q.low);for(const id of q.triggers.items)trigger({...h,confirmed_at:q.confirmed_at,lower:l.lower},id);}
 if((t.potential_target!==null)!==(t.target_status==='POTENTIAL_TARGET_IDENTIFIED'))throw Error('FALSE_TDA_TARGET');
 if(t.potential_target){const b=get(t.potential_target),a=t.selected_anchor?get(t.selected_anchor):null;if(!['FRACTAL','FVG'].includes(b.kind)||b.lifecycle?.state!=='ACTIVE'||b.lifecycle?.liquidity_consumed||a&&![a.timeframe,next(a.timeframe)].includes(b.timeframe))throw Error('INVALID_TDA_TARGET');}
}
