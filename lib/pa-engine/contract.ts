import {ACTIVE_RESEARCH_SYMBOLS} from '../active-research-markets.ts';
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
const FORBIDDEN_KEYS=new Set(['narrative','narrative_method','candidate_narrative','confirmed_narrative','scenario','scenarios','entry','entry_stop','stop_loss','take_profit','rr','verdict','target_selection','quality_score','probability','account','account_id','accounts','password','api_key','token','access_token','refresh_token','authorization','headers','cst','security_token','x_security_token','raw_response','raw_ohlc','credentials','client_secret'].map(normal));
/** Shared by every published technical payload: no forecast/trade keys, no credentials. */
function assertPublishable(value:unknown,raw:string,secrets:string[],label:string){
 if(secrets.some(s=>s.length>=8&&raw.includes(s))||/github_pat_|ghp_[A-Za-z0-9]|Bearer\s+[A-Za-z0-9._-]+/i.test(raw))throw Error(`SECRET_IN_${label}`);
 const walk=(v:unknown)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(FORBIDDEN_KEYS.has(normal(k)))fail();walk(x);}};walk(value);
}
const LEVEL_KINDS=['FRACTAL','FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK'];
const CONTEXT_KEYS=['kl_id','pivot_id','poi_id','rb_liquidity_id','rb_fvg_id','snr_x1_fvg_id','snr_opposing_kl_id'];
/** One geometric level row. `ids`/`contexts`/`formation_status` are optional for reports built before grouping. */
function checkLevel(x:Record<string,any>,c:{symbol:string;side:string;tf:string;where:string;ref:number;tol:number;ids:Set<string>;previous:number;extra?:string}){
 keys(x,'id ids kind lower upper bounds_basis state formation_status fill distance contexts'+(c.extra?' '+c.extra:''));
 const prefix=`${c.symbol}:${c.tf}:${c.side}:`;
 if(typeof x.id!=='string'||c.ids.has(x.id)||!x.id.startsWith(prefix)||!LEVEL_KINDS.includes(x.kind)||!finite(x.lower)||!finite(x.upper)||x.lower>x.upper||!finite(x.distance)||x.distance<0||x.distance<c.previous)fail();
 if(typeof x.state!=='string'||(['BROKEN','INVALIDATED'].includes(x.state)||x.state==='CONSUMED'&&x.kind!=='FRACTAL')||!['FVG_REMAINING','ORIGINAL'].includes(x.bounds_basis))fail();
 if(x.kind==='FVG'?typeof x.fill!=='string'||x.fill==='FILLED':x.fill!==null||x.bounds_basis!=='ORIGINAL')fail();
 if(x.formation_status!==undefined&&!['CONFIRMED','NEEDS_SPECIFICATION'].includes(x.formation_status))fail();
 const members:string[]=x.ids===undefined?[x.id]:x.ids;
 if(!strings(members)||!members.length||members[0]!==x.id||members.some((id,i)=>i>0&&id<=members[i-1])||members.some(id=>!id.startsWith(prefix+x.kind+':')||c.ids.has(id)))fail();
 if(x.contexts!==undefined){if(!Array.isArray(x.contexts))fail();let last='';
  for(const k of x.contexts){keys(k,'id relationships evidence_ids');
   if(typeof k.id!=='string'||!k.id||k.id<=last||!strings(k.relationships)||!k.relationships.length||k.relationships.some((r:string)=>!CONTEXT_KEYS.includes(r))||!strings(k.evidence_ids)||!k.evidence_ids.length||k.evidence_ids.some((id:string)=>!members.includes(id)))fail();last=k.id;}}
 const expected=c.where==='above'?x.lower-c.ref:c.where==='below'?c.ref-x.upper:0;
 if(c.where==='above'&&!(x.lower>c.ref)||c.where==='below'&&!(x.upper<c.ref)||c.where==='at_price'&&(x.lower>c.ref||x.upper<c.ref)||Math.abs(x.distance-expected)>c.tol)fail();
 for(const id of members)c.ids.add(id);
 return x.distance as number;
}
/** Optional block (absent in reports built before it existed). Geometry only: distance to the
 * last closed H4 close, never significance; consumed/invalidated/filled levels are never listed. */
function validateNearby(r:Record<string,any>){
 const n=r.nearby_levels,omitted=r.omitted?.nearby_levels;
 if(omitted!==undefined&&(!Number.isInteger(omitted)||omitted<0))fail();
 if(n===undefined||n===null)return;
 if(['STALE','ERROR'].includes(r.status))fail();
 keys(n,'reference selection_policy grouping state_field distance_unit per_side_limit excluded_states size_trimmed timeframes');
 keys(n.reference,'price at basis');
 const ref=n.reference.price,limit=n.per_side_limit,tol=1e-6*Math.max(1,Math.abs(ref));
 if(!finite(ref)||ref<=0||!date(n.reference.at)||n.reference.at>r.as_of||n.reference.basis!=='LAST_CLOSED_H4_CLOSE'||n.selection_policy!=='NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE'||n.grouping!==undefined&&n.grouping!=='KIND_TIMEFRAME_FORMATION_CANDLES_BOUNDS'||n.state_field!=='lifecycle.state'||n.distance_unit!=='PRICE'||!Number.isInteger(limit)||limit<1||!strings(n.excluded_states)||!Number.isInteger(n.size_trimmed)||n.size_trimmed<0||omitted===undefined||omitted<n.size_trimmed)fail();
 if(Object.keys(obj(n.timeframes)).sort().join(',')!=='D1,H4,MN1,W1')fail();
 const ids=new Set<string>();
 for(const tf of tfs){const f=n.timeframes[tf];keys(f,'above below at_price eligible');keys(f.eligible,'above below at_price');
  for(const where of ['above','below','at_price']){const list=f[where];
   if(!Array.isArray(list)||list.length>limit||!Number.isInteger(f.eligible[where])||f.eligible[where]<list.length)fail();
   let previous=-Infinity;
   for(const x of list)previous=checkLevel(x,{symbol:r.symbol,side:r.price_side,tf,where,ref,tol,ids,previous});
  }
 }
}
/** Optional (absent before grid support): requested grid and the per-TF grid of the analysed bars. */
const BAR_GRIDS:Record<string,string[]>={MN1:['utc_calendar'],W1:['utc_week'],D1:['ny','utc'],H4:['ny','utc']};
function checkGrid(g:unknown,frames?:Record<string,any>){if(g===undefined)return;const x=obj(g);keys(x,'requested by_tf');
 if(!['ny','utc'].includes(x.requested)||Object.keys(obj(x.by_tf)).sort().join(',')!=='D1,H4,MN1,W1')fail();
 for(const tf of tfs)if(!BAR_GRIDS[tf].includes(x.by_tf[tf])||frames&&frames[tf]?.grid!==undefined&&frames[tf].grid!==x.by_tf[tf])fail();}
const absolute=(u:unknown)=>typeof u==='string'&&/^https?:\/\/[^/\s]+\/(api\/|llms\.txt)\S*$/.test(u);
export const PA_BRIEF_SCHEMA='pa-brief-v1';
/** Portable contract of /api/brief: same forbidden keys and size cap as the desk-report, observations
 * withheld on STALE/ERROR, grouped levels geometrically consistent, every link absolute. */
export function validatePaBrief(value:unknown,symbol?:string,secrets:string[]=[],maxBytes=65536):void{
 const b=obj(value),raw=JSON.stringify(value);if(!raw||Buffer.byteLength(raw)+1>maxBytes)throw Error('BRIEF_TOO_LARGE');
 assertPublishable(b,raw,secrets,'BRIEF');
 keys(b,'schema_version contract_revision mode technical_only symbol price_side grid engine status data_quality observations_available generated_at as_of expires_at snapshot_sha256 source quote freshness warnings reference atr_d1 approach_config selection_policy level_rules timeframes thesis_inputs coverage omitted definitions links trading_enabled');
 if(b.schema_version!==PA_BRIEF_SCHEMA||b.contract_revision!==PA_CONTRACT_REVISION||b.mode!=='PA_ONLY'||b.technical_only!==true||b.trading_enabled!==false||!ACTIVE_RESEARCH_SYMBOLS.some(s=>s===b.symbol)||symbol&&b.symbol!==symbol||!['bid','ask'].includes(b.price_side)||!['ERROR','STALE','PARTIAL','UNVERIFIED'].includes(b.status)||typeof b.observations_available!=='boolean')fail();
 if(!date(b.generated_at)||!date(b.as_of)||!date(b.expires_at)||b.as_of>b.generated_at||b.expires_at<b.generated_at||!/^[a-f0-9]{64}$/.test(b.snapshot_sha256)||obj(b.quote).used_as_closed_evidence!==false||!strings(b.warnings))fail();
 checkGrid(b.grid,b.timeframes);
 const withheld=['STALE','ERROR'].includes(b.status);
 if(withheld&&(b.observations_available||b.reference!==null))fail();
 // Archived pa-brief-v1 snapshots may predate thesis_inputs.
 if(b.thesis_inputs!==undefined){
  const x=b.thesis_inputs;
  if(!b.observations_available){if(x!==null)fail();}
  else {
   keys(x,'as_of location strength opposite_side execution');
   if(x.as_of!==b.as_of||['location','strength','opposite_side','execution'].some(k=>!Object.keys(obj(x[k])).length))fail();
   if(!Number.isInteger(x.strength.window_bars)||x.strength.window_bars<1||x.strength.thresholds!=='NEEDS_SPECIFICATION')fail();
   for(const tf of ['D1','W1'])if(!Object.keys(obj(x.strength[tf])).length||!Object.keys(obj(x.opposite_side[tf])).length)fail();
   const ranges=obj(x.location.active_dr);
   if(Object.keys(ranges).sort().join(',')!=='D1,H4,MN1,W1')fail();
   const priority=tfs.find(tf=>ranges[tf]!==null)??null;
   if(priority!==x.location.priority_tf)fail();
   for(const tf of tfs){
    const d=ranges[tf];
    if(d===null)continue;
    if(!d||d.timeframe!==tf||d.htf_priority!==(tf===priority)||!finite(d.low)||!finite(d.high)||d.low>=d.high||!finite(d.eq)||Math.abs(d.eq-(d.low+d.high)/2)>1e-8||!['PREMIUM','DISCOUNT','EQ'].includes(d.zone)||!finite(d.price_position_pct)||d.price_position_pct<0||d.price_position_pct>100)fail();
   }
   for(const tf of ['D1','W1']){
    const s=x.strength[tf], ratio=s.overlap_ratio;
    if(!Number.isInteger(s.bars)||s.bars<0||s.bars>x.strength.window_bars||ratio!==null&&(!finite(ratio)||ratio<0||ratio>1))fail();
   }
   function checkFacts(v:unknown):void{
    if(typeof v==='number'&&!finite(v))fail();
    if(typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&(!date(v)||v>b.as_of))fail();
    if(v&&typeof v==='object')Object.values(v).forEach(checkFacts);
   }
   checkFacts(x);
  }
 }
 const limit=obj(b.level_rules).per_side_limit;if(!Number.isInteger(limit)||limit<1)fail();
 let ref=NaN;
 if(b.reference!==null){keys(b.reference,'price at basis');ref=b.reference.price;if(!finite(ref)||ref<=0||!date(b.reference.at)||b.reference.at>b.as_of||b.reference.basis!=='LAST_CLOSED_H4_CLOSE')fail();}
 if(Object.keys(obj(b.timeframes)).sort().join(',')!=='D1,H4,MN1,W1')fail();
 const ids=new Set<string>(),tol=1e-6*Math.max(1,Math.abs(ref)||1);let omitted=0;
 for(const tf of tfs){const t=b.timeframes[tf];
  keys(t,'timeframe grid data_quality warnings last_closed_at closed_candles last_closed_candles dealing_range levels approach strong_fractals fractals_inside_kl recent_fractals findings_by_kind links');
  if(t.timeframe!==tf||!strings(t.warnings)||!Number.isInteger(t.closed_candles)||t.closed_candles<0||t.last_closed_at!==null&&(!date(t.last_closed_at)||t.last_closed_at>b.as_of)||!Array.isArray(t.last_closed_candles))fail();
  for(const c of t.last_closed_candles){keys(c,'time closed_at open high low close');if(!date(c.time)||!date(c.closed_at)||c.time>=c.closed_at||c.closed_at>b.as_of||['open','high','low','close'].some(k=>!finite(c[k])||c[k]<=0)||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close))fail();}
  if(withheld&&(t.levels!==null||t.dealing_range!==null||t.recent_fractals!==null||t.findings_by_kind!==null||t.approach!=null||t.strong_fractals!=null||t.fractals_inside_kl!=null))fail();
  if(t.strong_fractals!=null&&(!Array.isArray(t.strong_fractals.items)||t.strong_fractals.items.some((x:Record<string,any>)=>!strings(x.flags)||!x.flags.length||x.flags.some((f:string)=>!['VC_AT_FRACTAL','RAIDED_PRIOR_FRACTAL'].includes(f))||typeof x.id!=='string'||!x.id.startsWith(`${b.symbol}:${tf}:${b.price_side}:FRACTAL:`))))fail();
  if(t.fractals_inside_kl!=null&&(!['SEE_ACTIVE_DR','NEEDS_SPECIFICATION'].includes(t.fractals_inside_kl.idm_status)||!Array.isArray(t.fractals_inside_kl.items)))fail();
  if(t.approach!=null&&!['EXPANSION_NO_CORRECTION','COMPRESSION','NONE','NOT_EVALUATED'].includes(t.approach.flag))fail();
  if(t.levels!==null){
   if(!finite(ref))fail();
   keys(t.levels,'above below at_price eligible omitted');keys(t.levels.eligible,'above below at_price');let shown=0,eligible=0;
   for(const where of ['above','below','at_price']){const list=t.levels[where];
    if(!Array.isArray(list)||list.length>limit||!Number.isInteger(t.levels.eligible[where])||t.levels.eligible[where]<list.length)fail();
    let previous=-Infinity;
    for(const x of list){previous=checkLevel(x,{symbol:b.symbol,side:b.price_side,tf,where,ref,tol,ids,previous,extra:'urls distance_atr_d1 nested_in kl_events'});
     if(x.distance_atr_d1!==undefined&&x.distance_atr_d1!==null&&(!finite(x.distance_atr_d1)||x.distance_atr_d1<0)||x.nested_in!==undefined&&(!strings(x.nested_in)||x.nested_in.some((id:string)=>!id.startsWith(b.symbol+':')||tfs.indexOf(id.split(':')[1])>=tfs.indexOf(tf))))fail();
     if(!Array.isArray(x.urls)||x.urls.length!==x.ids.length||x.urls.some((u:unknown,i:number)=>!absolute(u)||new URL(u as string).searchParams.get('id')!==x.ids[i]))fail();}
    shown+=list.length;eligible+=t.levels.eligible[where];
   }
   if(t.levels.omitted!==eligible-shown)fail();omitted+=t.levels.omitted;
  }
  if(t.recent_fractals!==null){if(!Array.isArray(t.recent_fractals))fail();
   for(const p of t.recent_fractals){keys(p,'id polarity price confirmed_at relation state url');if(typeof p.id!=='string'||!p.id.startsWith(`${b.symbol}:${tf}:${b.price_side}:FRACTAL:`)||!['high','low'].includes(p.polarity)||!finite(p.price)||!date(p.confirmed_at)||p.confirmed_at>b.as_of||!absolute(p.url))fail();}}
  if(!Object.values(obj(t.links)).every(absolute)||Object.keys(obj(t.links)).length!==3)fail();
 }
 if(obj(b.omitted).levels!==omitted||!Number.isInteger(obj(b.omitted).levels_size_trimmed)||b.omitted.levels_size_trimmed<0||b.omitted.levels_size_trimmed>omitted||!Object.values(obj(b.links)).every(absolute))fail();
}
export function validatePaReport(value:unknown,symbol?:string,now?:number,secrets:string[]=[]):void{
 const r=obj(value),raw=JSON.stringify(value);if(!raw||Buffer.byteLength(raw)+1>65536)throw Error('REPORT_TOO_LARGE');
 assertPublishable(r,raw,secrets,'REPORT');
 const allowed=new Set('schema_version contract_revision mode technical_only symbol price_side grid engine status data_quality generated_at as_of published_at expires_at error source snapshot_sha256 quote freshness frames evidence market_structure dealing_ranges lifecycle_events cross_timeframe_interactions nearby_levels definitions coverage warnings omitted details trading_enabled diagnostic'.split(' '));
 if(Object.keys(r).some(k=>!allowed.has(k))||r.schema_version!=='pa-engine-v6'||r.mode!=='PA_ONLY'||r.trading_enabled!==false||!ACTIVE_RESEARCH_SYMBOLS.some(symbol=>symbol===r.symbol)||symbol&&r.symbol!==symbol||!['ERROR','STALE','PARTIAL','UNVERIFIED'].includes(r.status)||!date(r.generated_at)||!date(r.expires_at)||r.expires_at<r.generated_at||r.published_at!==null&&r.published_at!==undefined&&!date(r.published_at))fail();
 if(now!==undefined&&r.status!=='ERROR'&&(Date.parse(r.expires_at)<=now||Date.parse(r.generated_at)>now))throw Error('REPORT_EXPIRED');
 if(!Array.isArray(r.evidence)||!strings(r.warnings)||!['PARTIAL','UNVERIFIED'].includes(r.data_quality))fail();
 if(r.status==='ERROR'&&r.source===null){
  if(r.evidence.length||r.as_of!==null||r.quote!==null||r.freshness!==null||Object.keys(obj(r.frames)).length||Object.keys(obj(r.market_structure)).length||r.coverage!==null||typeof r.error!=='string'||!/^[A-Z][A-Z0-9_]{0,99}$/.test(r.error))fail();
  for(const k of ['dealing_ranges','lifecycle_events','cross_timeframe_interactions'])if(!Array.isArray(r[k])||r[k].length)fail();
  if(r.omitted?.evidence!==0||r.nearby_levels!==undefined&&r.nearby_levels!==null)fail();return;
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
 checkGrid(r.grid,r.frames);
 validateNearby(r);
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
