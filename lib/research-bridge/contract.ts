// Portable, dependency-free contract shared by the API and the private-repository publisher.
export const MAX_REPORT_BYTES=65_536;
export const CONTRACT_REVISION='desk-report-v2.2';
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
  lower:nullable(num),upper:nullable(num),variant:en(3,null),polarity:en('high','low',null),direction:en('bullish','bearish','Bullish','Bearish','up','down',null),
  detector_state:en('OBSERVED','CANDIDATE','NEEDS_SPECIFICATION'),data_status:en('PARTIAL','UNVERIFIED'),
  rule:str(/^EDGE\.[A-Z0-9_]+\.v\d+$/,100),candle_refs:arr(num,1000),candle_evidence_sha256:hex,dependencies:arr(ref,20),
  lifecycle:nullable(obj({state:code,initial_role:optional(en('support','resistance')),fill:optional(nullable(obj({state:en('UNKNOWN','UNTOUCHED','TOUCHED','PARTIAL','FILLED'),max_observed_fraction:num,first_test_at:nullable(time),last_test_at:nullable(time)}))),current_role:en('support','resistance',null),role_status:code,coverage:code,evaluated_through:time,invalidated_at:nullable(time),liquidity_consumed:bool,interactions:arr(interaction,20)}))});
const frame=obj({range_options:optional(obj({total:num,omitted:num,review_required:en(true)})),timeframe:tf,fetched_at:time,last_closed_at:nullable(time),closed_candles:num,data_status:code,warnings:arr(code,24),discarded_rows:num,
  structure:obj({bias:nullable(bias),events:group,swing_bias:nullable(bias),swing_basis:en('NEEDS_SPECIFICATION'),swing_evidence:arr(ref,4)}),
  fractals:arr(obj({variant:en(3),polarity:en('high','low'),items:arr(ref,1),total:num,omitted:num}),4),snr:group,rb:group,fvg:group,ifvg:group,
  liquidity:obj({raids:group,idm:group,strong:group,irl:group}),
  dealing_range:nullable(obj({high:ref,low:ref,lower:num,upper:num,equilibrium:num,confirmed_at:time,state:code,invalidated_at:nullable(time)})),range_status:code,
  range_candidate:optional(nullable(obj({high:ref,low:ref,lower:num,upper:num,equilibrium:num,confirmed_at:time,method:en('LATEST_FRACTAL3_PROJECT_CANDIDATE','KL_REACTION_LOCAL_DR_CANDIDATE'),review_required:en(true)})))});
const scenario=obj({candidate_narrative:nullable(bias),confirmed_narrative:nullable(bias),status:code,
  evidence_quality:obj({status:code,human_reviewed:bool,independently_validated:en(false),probability:en(null)}),
  A:obj({selected:nullable(ref),items:arr(ref,3),total:num,omitted:num}),
  B:obj({selected:nullable(ref),validated:nullable(ref),status:code,items:arr(obj({level:ref,role_eligible:bool,author_timeframe_eligible:nullable(bool),reasons:arr(code,24),
    path:obj({items:arr(ref,4),total:nullable(num),omitted:nullable(num),completeness:en('UNASSESSED','COMPLETE','PARTIAL')})}),3),total:num,role_eligible:num,omitted:num}),
  C:nullable(obj({source:ref,timeframe:tf,price:num,condition:en('OWN_TF_CLOSE_BEYOND_FVG','MANUAL_OWN_TF_CLOSE_BEYOND')})),
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
  full_inspection:obj({path:en('/api/intelligence'),mode:en('inspection'),snapshot_sha256:hex,as_of:time,requires_authorization:en(true)})});
const schema=obj({published_at:optional(nullable(time)),freshness:optional(obj({quote_retrieved_at:nullable(time),quote_status:en('FRESH','STALE','MARKET_CLOSED'),data_quality:code,stale_reasons:arr(code,10),quote_max_seconds:num,h4_max_delay_seconds:num,h4_delay_seconds:num,source_age_seconds:num,delivery_max_seconds:num})),technical_only:optional(en(true)),details:optional(obj({path:en('/api/intelligence'),snapshot_sha256:hex})),schema_version:en('desk-report-v2'),symbol:en('EURUSD','NAS100','JP225','EU50'),status:en('ERROR','STALE','UNVERIFIED','PARTIAL'),generated_at:time,as_of:nullable(time),expires_at:time,
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
    const lifecycle=e.lifecycle as typeof e.lifecycle&{state?:string;current_role?:string|null;fill?:{state:string;max_observed_fraction:number;first_test_at:string|null;last_test_at:string|null}};
    if(technical.technical_only&&lifecycle&&(lifecycle.state==='INVALIDATED'&&!lifecycle.invalidated_at||['INVALIDATED','CONSUMED','UNVERIFIED'].includes(lifecycle.state??'')&&lifecycle.current_role!==null))throw Error('CONTRADICTORY_LIFECYCLE');
    const fill=lifecycle?.fill;
    if(fill){if(fill.max_observed_fraction<0||fill.max_observed_fraction>1||fill.state==='FILLED'&&fill.max_observed_fraction!==1)throw Error('INVALID_FILL');
      if([fill.first_test_at,fill.last_test_at].some(t=>t&&(t<e.confirmed_at||t>lifecycle!.evaluated_through)))throw Error('FUTURE_INTERACTION');
      if(fill.first_test_at&&fill.last_test_at&&fill.first_test_at>fill.last_test_at)throw Error('INVALID_FILL');}
  }
  for(const f of r.frames){
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
}
