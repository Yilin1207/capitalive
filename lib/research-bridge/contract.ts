// Portable, dependency-free contract shared by the API and the private-repository publisher.
export const MAX_REPORT_BYTES=65_536;
export const CONTRACT_REVISION='desk-report-v1.2';
export type FailureStage='http'|'schema'|'size'|'expiry'|'provider'|'publish';
export type BridgeDiagnostic={stage:FailureStage;code:string;http_status:number|null;response_bytes:number|null;media_type:'json'|'html'|'other'|null;contract_revision:typeof CONTRACT_REVISION};
export class BridgeFailure extends Error {
  diagnostic:BridgeDiagnostic;
  constructor(value:BridgeDiagnostic){super(value.code);this.name='BridgeFailure';this.diagnostic=value;}
}
export function diagnostic(stage:FailureStage,code:string,metadata:Partial<Pick<BridgeDiagnostic,'http_status'|'response_bytes'|'media_type'>>={}):BridgeDiagnostic {
  const allowed=['NETWORK_ERROR','TIMEOUT','HTTP_STATUS','HTTP_REDIRECT','CONTENT_TYPE','INVALID_JSON','CONTRACT_REJECTED','CONTRACT_REVISION_MISMATCH','REPORT_TOO_LARGE','REPORT_EXPIRED','INVALID_REPORT_TIME','SECRET_IN_REPORT','UPSTREAM_UNAVAILABLE','CAPITAL_CONFIG','CAPITAL_AUTH','CAPITAL_RATE_LIMIT','CAPITAL_TIMEOUT','CAPITAL_INVALID_RESPONSE','CAPITAL_UPSTREAM','INVALID_EVIDENCE','GITHUB_HTTP_ERROR','PRIVATE_REPOSITORY_REQUIRED','INVALID_PUBLICATION','CONFIGURATION_ERROR','PUBLISH_FAILED'];
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
const evidence=obj({id:str(/^(EURUSD|NAS100|EU50):(MN1|W1|D1|H4):(bid|ask):[A-Za-z0-9_.:\-]+$/,1600),timeframe:tf,kind:code,origin:time,confirmed_at:time,
  lower:nullable(num),upper:nullable(num),variant:en(3,5,null),polarity:en('high','low',null),direction:en('bullish','bearish','Bullish','Bearish','up','down',null),
  detector_state:en('OBSERVED','CANDIDATE','NEEDS_SPECIFICATION'),data_status:en('PARTIAL','UNVERIFIED'),
  rule:str(/^EDGE\.[A-Z0-9_]+\.v\d+$/,100),candle_refs:arr(num,1000),candle_evidence_sha256:hex,dependencies:arr(ref,20),
  lifecycle:nullable(obj({state:code,initial_role:optional(en('support','resistance')),fill:optional(nullable(obj({state:en('UNKNOWN','UNTOUCHED','TOUCHED','PARTIAL','FILLED'),max_observed_fraction:num,first_test_at:nullable(time),last_test_at:nullable(time)}))),current_role:en('support','resistance',null),role_status:code,coverage:code,evaluated_through:time,invalidated_at:nullable(time),liquidity_consumed:bool,interactions:arr(interaction,20)}))});
const frame=obj({range_options:optional(obj({total:num,omitted:num,review_required:en(true)})),timeframe:tf,fetched_at:time,last_closed_at:nullable(time),closed_candles:num,data_status:code,warnings:arr(code,24),discarded_rows:num,
  structure:obj({bias:nullable(bias),events:group,swing_bias:nullable(bias),swing_basis:en('PROJECT_OBSERVATION_NOT_AUTHOR_SOF'),swing_evidence:arr(ref,4)}),
  fractals:arr(obj({variant:en(3,5),polarity:en('high','low'),items:arr(ref,1),total:num,omitted:num}),4),snr:group,rb:group,fvg:group,ifvg:group,
  liquidity:obj({raids:group,idm:group,strong:group,irl:group}),
  dealing_range:nullable(obj({high:ref,low:ref,lower:num,upper:num,equilibrium:num,confirmed_at:time,state:code,invalidated_at:nullable(time)})),range_status:code,
  range_candidate:optional(nullable(obj({high:ref,low:ref,lower:num,upper:num,equilibrium:num,confirmed_at:time,method:en('LATEST_FRACTAL3_PROJECT_CANDIDATE'),review_required:en(true)})))});
const scenario=obj({candidate_narrative:nullable(bias),confirmed_narrative:nullable(bias),status:code,
  evidence_quality:obj({status:code,human_reviewed:bool,independently_validated:en(false),probability:en(null)}),
  A:obj({selected:nullable(ref),items:arr(ref,3),total:num,omitted:num}),
  B:obj({selected:nullable(ref),validated:nullable(ref),status:code,items:arr(obj({level:ref,role_eligible:bool,author_timeframe_eligible:nullable(bool),reasons:arr(code,24),
    path:obj({items:arr(ref,4),total:nullable(num),omitted:nullable(num),completeness:en('UNASSESSED','COMPLETE','PARTIAL')})}),3),total:num,role_eligible:num,omitted:num}),
  C:nullable(obj({source:ref,timeframe:tf,price:num,condition:en('OWN_TF_CLOSE_BEYOND_FVG','MANUAL_OWN_TF_CLOSE_BEYOND')})),
  invalidations:obj({entry:nullable(bool),KL:nullable(bool),narrative:nullable(bool)}),blockers:arr(code,24),action:en('WAIT','NOT_EVALUATED')});
const schema=obj({technical_only:optional(en(true)),details:optional(obj({path:en('/api/intelligence'),snapshot_sha256:hex})),schema_version:en('desk-report-v1'),symbol:en('EURUSD','NAS100','EU50'),status:en('ERROR','STALE','UNVERIFIED','PARTIAL'),generated_at:time,as_of:nullable(time),expires_at:time,
  error:en(null,'UPSTREAM_UNAVAILABLE','INVALID_REQUEST','INVALID_EVIDENCE','REPORT_TOO_LARGE','TRANSPORT_ERROR','UNTRUSTED_RESPONSE','HTTP_ERROR','SCHEMA_ERROR','EXPIRED_REPORT'),
  diagnostic:optional(obj({stage:en('http','schema','size','expiry','provider','publish'),code:en('NETWORK_ERROR','TIMEOUT','HTTP_STATUS','HTTP_REDIRECT','CONTENT_TYPE','INVALID_JSON','CONTRACT_REJECTED','CONTRACT_REVISION_MISMATCH','REPORT_TOO_LARGE','REPORT_EXPIRED','INVALID_REPORT_TIME','SECRET_IN_REPORT','UPSTREAM_UNAVAILABLE','CAPITAL_CONFIG','CAPITAL_AUTH','CAPITAL_RATE_LIMIT','CAPITAL_TIMEOUT','CAPITAL_INVALID_RESPONSE','CAPITAL_UPSTREAM','INVALID_EVIDENCE','GITHUB_HTTP_ERROR','PRIVATE_REPOSITORY_REQUIRED','INVALID_PUBLICATION','CONFIGURATION_ERROR','PUBLISH_FAILED'),http_status:nullable(num),response_bytes:nullable(num),media_type:en('json','html','other',null),contract_revision:en(CONTRACT_REVISION)})),
  source:nullable(obj({provider:en('Capital.com'),environment:en('demo','live'),analysis_schema:en('edge-knowledge-3'),price_side:en('bid','ask'),engine_commit:nullable(str(/^[a-f0-9]{40}$/,40)),evidence_sha256:hex,demo_live_equivalence:en('NOT_ESTABLISHED'),full_ohlc_published:en(false)})),
  quote:nullable(obj({bid:nullable(num),ask:nullable(num),spread:nullable(num),provider_timestamp:nullable(time),retrieved_at:nullable(time),source_type:en('REST','WEBSOCKET',null),market_status:en('TRADEABLE','CLOSED','EDITS_ONLY','OFFLINE','ON_AUCTION','ON_AUCTION_NO_EDITS','SUSPENDED',null),provider_age_seconds:nullable(num),fresh:bool,used_as_closed_evidence:en(false)})),
  frames:arr(frame,4),scenario:nullable(scenario),evidence:{type:'object',record:evidence,keyPattern:/^e\d{1,4}$/},
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
  if(r.status==='ERROR'&&!r.error)throw Error('MISSING_ERROR');
  if(r.scenario?.confirmed_narrative!==null&&r.scenario&&!r.scenario.evidence_quality.human_reviewed)throw Error('UNREVIEWED_CONFIRMATION');
  const technical=value as {technical_only?:boolean;scenario?:{action:string}|null;details?:{snapshot_sha256:string};source?:{evidence_sha256:string}|null};
  if(technical.technical_only&&technical.scenario?.action!=='NOT_EVALUATED')throw Error('TECHNICAL_RESPONSIBILITY_VIOLATION');
  if(technical.details&&technical.details.snapshot_sha256!==technical.source?.evidence_sha256)throw Error('SNAPSHOT_HASH_MISMATCH');
  const ids=new Set<string>();
  for(const w of r.candle_windows)if(w.length!==2||w[0]>=w[1]||!r.as_of||w[1]>r.as_of)throw Error('FUTURE_CANDLE');
  for(const e of Object.values(r.evidence)){
    if(!r.source||!e.id.startsWith(`${r.symbol}:${e.timeframe}:${r.source.price_side}:`)||ids.has(e.id))throw Error('INVALID_EVIDENCE_ID');ids.add(e.id);
    const unknownIdTokens=e.id.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,'').replace(/\b(EURUSD|NAS100|EU50|MN1|W1|D1|H4|bid|ask|high|low|FRACTAL|FVG|FVG_CLOSED_BREACH|RB_TWO_CANDLE|SNR_CLOSED_BREAK|RAID|BOS|CHOCH|IDM_INSIDE_POI|STRONG_PIVOT_CANDIDATE|DEALING_RANGE|INTERNAL_LIQUIDITY)\b/g,'').replace(/[:0-9.\-]/g,'');
    if(unknownIdTokens)throw Error('INVALID_EVIDENCE_ID');
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
    const candidate=(f as typeof f&{range_candidate?:{high:string;low:string;lower:number;upper:number;equilibrium:number;confirmed_at:string;review_required:boolean}}).range_candidate;
    if(!candidate)continue;
    const levels=r.evidence as unknown as Record<string,{kind:string;variant:number|null;polarity:string|null;timeframe:string;lower:number|null;upper:number|null;confirmed_at:string}>;
    const high=levels[candidate.high],low=levels[candidate.low];
    if(!high||!low||high.kind!=='FRACTAL'||low.kind!=='FRACTAL'||high.variant!==3||low.variant!==3||
      high.polarity!=='high'||low.polarity!=='low'||high.timeframe!==f.timeframe||low.timeframe!==f.timeframe||
      high.upper!==candidate.upper||low.lower!==candidate.lower||candidate.lower>=candidate.upper||
      candidate.confirmed_at!==(high.confirmed_at>low.confirmed_at?high.confirmed_at:low.confirmed_at)||
      Math.abs(candidate.equilibrium-(candidate.lower+candidate.upper)/2)>1e-10*Math.max(1,Math.abs(candidate.equilibrium)))throw Error('INVALID_RANGE_CANDIDATE');
  }
  function refs(v:unknown):void{if(typeof v==='string'&&/^e\d{1,4}$/.test(v)&&!Object.hasOwn(r.evidence,v))throw Error('MISSING_EVIDENCE');if(Array.isArray(v))v.forEach(refs);else if(v&&typeof v==='object')Object.values(v).forEach(refs);}refs(value);
  function counts(v:unknown):void{if(Array.isArray(v)){v.forEach(counts);return;}if(!v||typeof v!=='object')return;const x=v as Record<string,unknown>;
    if(Array.isArray(x.items)&&typeof x.total==='number'&&typeof x.omitted==='number'&&(!Number.isInteger(x.total)||!Number.isInteger(x.omitted)||x.omitted<0||x.total!==x.items.length+x.omitted))throw Error('INVALID_COVERAGE_COUNTS');
    Object.values(x).forEach(counts);
  }counts(value);
}
