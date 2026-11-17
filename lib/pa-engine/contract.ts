// Dependency-free contract: copied with the private publisher, no engine or credentials.
export const PA_CONTRACT_REVISION='pa-engine-v6.1';
const tfs=['MN1','W1','D1','H4'];
const date=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const obj=(v:unknown):Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const fail=():never=>{throw Error('PA contract INVALID_EVIDENCE');};
const keys=(v:unknown,allowed:string)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.split(' ').includes(k)))fail();};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const strings=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const normal=(s:string)=>s.replace(/[^a-z0-9]/gi,'').toLowerCase();
export function validatePaReport(value:unknown,symbol?:string,now?:number,secrets:string[]=[]):void{
 const r=obj(value),raw=JSON.stringify(value);if(!raw||Buffer.byteLength(raw)+1>65536)throw Error('REPORT_TOO_LARGE');
 if(secrets.some(s=>s.length>=8&&raw.includes(s))||/github_pat_|ghp_[A-Za-z0-9]|Bearer\s+[A-Za-z0-9._-]+/i.test(raw))throw Error('SECRET_IN_REPORT');
 const forbidden=new Set(['narrative','narrative_method','candidate_narrative','confirmed_narrative','scenario','scenarios','entry','entry_stop','stop_loss','take_profit','rr','verdict','target_selection','quality_score','probability','account','account_id','accounts','password','api_key','token','access_token','refresh_token','authorization','headers','cst','security_token','x_security_token','raw_response','raw_ohlc','credentials','client_secret'].map(normal));
 const walk=(v:unknown)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(forbidden.has(normal(k)))fail();walk(x);}};walk(r);
 const allowed=new Set('schema_version contract_revision mode technical_only symbol price_side status data_quality generated_at as_of published_at expires_at error source snapshot_sha256 quote freshness frames evidence market_structure dealing_ranges lifecycle_events cross_timeframe_interactions definitions coverage warnings omitted details trading_enabled diagnostic'.split(' '));
 if(Object.keys(r).some(k=>!allowed.has(k))||r.schema_version!=='pa-engine-v6'||r.mode!=='PA_ONLY'||r.trading_enabled!==false||!['EURUSD','NAS100','JP225'].includes(r.symbol)||symbol&&r.symbol!==symbol||!['ERROR','STALE','PARTIAL','UNVERIFIED'].includes(r.status)||!date(r.generated_at)||!date(r.expires_at)||r.expires_at<r.generated_at||r.published_at!==null&&r.published_at!==undefined&&!date(r.published_at))fail();
 if(now!==undefined&&r.status!=='ERROR'&&(Date.parse(r.expires_at)<=now||Date.parse(r.generated_at)>now))throw Error('REPORT_EXPIRED');
 if(!Array.isArray(r.evidence)||!strings(r.warnings)||!['PARTIAL','UNVERIFIED'].includes(r.data_quality))fail();
 if(r.status==='ERROR'&&r.source===null){
  if(r.evidence.length||r.as_of!==null||r.quote!==null||r.freshness!==null||Object.keys(obj(r.frames)).length||Object.keys(obj(r.market_structure)).length||r.coverage!==null||typeof r.error!=='string'||!/^[A-Z][A-Z0-9_]{0,99}$/.test(r.error))fail();
  for(const k of ['dealing_ranges','lifecycle_events','cross_timeframe_interactions'])if(!Array.isArray(r[k])||r[k].length)fail();
  if(r.omitted?.evidence!==0)fail();return;
 }
 if(r.contract_revision!==PA_CONTRACT_REVISION||r.technical_only!==true)fail();
 keys(r.source,'provider environment analysis_schema price_side engine_commit evidence_sha256 demo_live_equivalence full_ohlc_published');
 if(!date(r.as_of)||r.as_of>r.generated_at||!['bid','ask'].includes(r.price_side)||! /^[a-f0-9]{64}$/.test(r.snapshot_sha256)||r.source?.analysis_schema!=='pa-engine-v6'||r.source.price_side!==r.price_side||r.source.provider!=='Capital.com'||!['demo','live'].includes(r.source.environment)||r.source.full_ohlc_published!==false||r.source.evidence_sha256!==r.snapshot_sha256)fail();
 if(r.source.engine_commit!==null&&(typeof r.source.engine_commit!=='string'||!/^[a-f0-9]{40}$/.test(r.source.engine_commit))||r.source.demo_live_equivalence!=='NOT_ESTABLISHED')fail();
 if(!r.frames||Object.keys(r.frames).sort().join(',')!=='D1,H4,MN1,W1')fail();
 for(const tf of tfs){const f=r.frames[tf];if(f.timeframe!==tf||!Number.isInteger(f.closed_candles)||f.closed_candles<0||!Array.isArray(f.warnings)||f.last_closed_at!==null&&(!date(f.last_closed_at)||f.last_closed_at>r.as_of))fail();}
 if(['STALE','ERROR'].includes(r.status)&&(r.evidence.length||Object.keys(obj(r.market_structure)).length||r.dealing_ranges.length))fail();
 const ids=new Set<string>();for(const e of r.evidence){if(typeof e.id!=='string'||ids.has(e.id)||!e.id.startsWith(`${r.symbol}:${e.timeframe}:${r.price_side}:`)||!tfs.includes(e.timeframe)||e.symbol!==r.symbol||e.price_side!==r.price_side||!date(e.origin)||!date(e.confirmed_at)||e.origin>e.confirmed_at||e.confirmed_at>r.as_of||!Array.isArray(e.candle_evidence)||!e.candle_evidence.length||typeof e.rule_id!=='string'||!Number.isInteger(e.rule_version))fail();ids.add(e.id);
  keys(e,'id kind timeframe side origin confirmed_at data_status candle_evidence basis rule_id rule_version rule_status specification sources counterarguments invalidation facts state price polarity index segment variant symbol price_side bounds remaining_bounds formation_status lifecycle role_status current_role formation_role evaluated_through limitations');
  if(e.side!==r.price_side||!['FRACTAL','FVG','RAID','TOUCH','RB_TWO_CANDLE','SNR_CLOSED_BREAK','FRACTAL_INSIDE_POI','DEALING_RANGE','PREMIUM_DISCOUNT'].includes(e.kind)||!strings(e.limitations)||!date(e.evaluated_through)||e.evaluated_through>r.as_of||!['CONFIRMED','NEEDS_SPECIFICATION'].includes(e.formation_status))fail();
  if(e.kind==='FRACTAL'&&(e.facts.variant!==3||e.candle_evidence.length!==3))fail();
  if(['BOS','CHOCH','ORDER_BLOCK','BREAKER'].includes(e.kind))fail();
  if(e.bounds!==null&&(!Number.isFinite(e.bounds.lower)||!Number.isFinite(e.bounds.upper)||e.bounds.lower>e.bounds.upper))fail();
  for(const c of e.candle_evidence){keys(c,'time closed_at index open high low close');if(!date(c.time)||!date(c.closed_at)||c.time>=c.closed_at||c.closed_at>e.confirmed_at||['open','high','low','close'].some(k=>!finite(c[k])||c[k]<=0)||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close))fail();}
  if(e.lifecycle?.evaluated_through>r.as_of||e.evaluated_through>r.as_of)fail();
 }
 if(r.coverage.findings_included!==r.evidence.length||r.coverage.findings_total!==r.evidence.length+r.omitted.evidence||r.coverage.findings_omitted!==r.omitted.evidence||r.omitted.evidence<0)fail();
 const q=r.quote;keys(q,'bid ask spread provider_timestamp retrieved_at source_type market_status provider_age_seconds fresh used_as_closed_evidence');
 if(q.used_as_closed_evidence!==false||typeof q.fresh!=='boolean'||!['REST','WEBSOCKET'].includes(q.source_type)||q.market_status!==null&&typeof q.market_status!=='string')fail();
 if(q.bid===null||q.ask===null){if(q.bid!==null||q.ask!==null||q.spread!==null||q.fresh)fail();}
 else if(!finite(q.bid)||q.bid<=0||!finite(q.ask)||q.ask<q.bid||!finite(q.spread)||Math.abs(q.spread-(q.ask-q.bid))>1e-8)fail();
 if(q.provider_timestamp!==null&&(!date(q.provider_timestamp)||q.provider_timestamp>r.generated_at)||q.retrieved_at!==null&&(!date(q.retrieved_at)||q.retrieved_at>r.generated_at))fail();
 keys(r.freshness,'quote_status quote_retrieved_at data_quality stale_reasons quote_max_seconds h4_max_delay_seconds h4_delay_seconds source_age_seconds delivery_max_seconds');
 const f=r.freshness;if(!strings(f.stale_reasons)||f.quote_retrieved_at!==q.retrieved_at||f.data_quality!==r.data_quality||!finite(f.quote_max_seconds)||f.quote_max_seconds<=0||!finite(f.delivery_max_seconds)||f.delivery_max_seconds<=0||!['FRESH','STALE','MARKET_CLOSED'].includes(f.quote_status))fail();
 if(q.provider_timestamp===null){if(q.provider_age_seconds!==null||q.fresh)fail();}
 else if(!finite(q.provider_age_seconds)||q.provider_age_seconds<0||Math.abs(q.provider_age_seconds-(Date.parse(r.generated_at)-Date.parse(q.provider_timestamp))/1000)>0.001)fail();
 if(q.fresh!== (f.quote_status==='FRESH')||q.fresh&&(!q.provider_timestamp||q.provider_age_seconds>f.quote_max_seconds||q.market_status==='CLOSED'))fail();
 if(f.quote_status==='MARKET_CLOSED'&&(q.market_status!=='CLOSED'||!q.retrieved_at||(Date.parse(r.generated_at)-Date.parse(q.retrieved_at))/1000>f.delivery_max_seconds||q.fresh))fail();
 if(['PARTIAL','UNVERIFIED'].includes(r.status)&&(f.stale_reasons.length||f.quote_status==='STALE'))fail();
 if(r.status==='STALE'&&!f.stale_reasons.length)fail();
}
