import {compactNarrativeMethod} from './narrative-method';
import {compactTda} from './tda';
import {currentBounds} from '../knowledge/fvg-remaining';
import type {snrFormationContext} from '../knowledge/snr-context';
import {freshnessPolicy} from './freshness';
import {closedRegularInterval} from '../research/calendars';
import {createHash} from 'node:crypto';
import type {buildIntelligence} from '../knowledge/intelligence';
import {type Finding} from '../knowledge/detectors';
import type {CandleResponse, Timeframe} from '../candle-data';
import type {MarketQuote} from '../quote-normalization';
import {closedFrame} from '../knowledge/data';
import {MAX_REPORT_BYTES, validateReport} from './contract.ts';
import {ACTIVE_RESEARCH_SYMBOLS} from '../active-research-markets.ts';
import {compactResearchContext} from './context';

type Intelligence = ReturnType<typeof buildIntelligence>;
export const SYMBOLS = ACTIVE_RESEARCH_SYMBOLS;
const REPORT_SYMBOLS = [...SYMBOLS,'JP225'] as const;
export type BridgeSymbol = typeof REPORT_SYMBOLS[number];
const TFS: Timeframe[] = ['MN1','W1','D1','H4'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const choice = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v) ? v : null;
const bias = (v: unknown) => choice(v,['Bullish','Bearish','Neutral']);
// Only machine reason codes from the engine; never publish human comments, errors or account fields.
const REASONS=new Set(('AUTHOR_STRUCTURE_REVIEW_REQUIRED PATH_COVERAGE_PARTIAL PATH_COVERAGE_UNKNOWN AMBIGUOUS_STRUCTURAL_TARGETS ANCHOR_LOWER_TF_BREACH ANCHOR_NOT_PROVEN_ACTIVE BOUNDARY_OR_CONTEXT_UNSPECIFIED DIRECTIONAL_ROLE_UNVERIFIED EXPLICIT_CURRENT_HTF_DR_REQUIRED FVG_LOWER_TF_BREACH_REVIEW_REQUIRED GAP_BOUNDARY_NO_PATTERN_STITCHING HTF_STRUCTURE_AND_SWING_FLOW_NOT_ALIGNED HUMAN_REVIEW_REQUIRED LEVEL_CANDIDATE LEVEL_CONSUMED LEVEL_INVALIDATED LEVEL_TESTED LEVEL_UNVERIFIED NO_ACTIVE_DIRECTIONAL_ANCHOR NO_ACTIVE_MN1_W1_KL NO_ELIGIBLE_MN1_W1_D1_POI TARGET_PATH_REQUIRES_REVIEW SELECTED_DR_INVALID_OR_OUTSIDE NO_CLOSED_HTF_OR_X_MINUS_1_REACTION NO_DIRECTIONAL_CONTEXT NO_STRUCTURAL_TARGET PARTIAL_AGGREGATION PROVIDER_VALIDATION_LOSS REQUESTED_HISTORY_INCOMPLETE ROLE_NOT_CONFIRMED SESSION_COVERAGE_NOT_INDEPENDENTLY_VERIFIED STRUCTURAL_INVALIDATION_REQUIRED TARGET_HISTORY_UNOBSERVED TARGET_LIQUIDITY_ALREADY_CONSUMED TARGET_UNVERIFIED INPUT_OR_SOURCE_UNVERIFIED REQUESTED_TARGET_UNAVAILABLE TARGET_OUTSIDE_AUTHOR_X_OR_X_MINUS_1 A_TO_B_PATH_HAS_OBSTACLES HTF_RANGE_LOCATION_NOT_SUPPORTIVE CONFLICTING_HTF_KL AMBIGUOUS_HTF_ANCHOR KL_CONTAINMENT_ONLY_NOT_NARRATIVE EXPLICIT_ANCHOR_REQUIRES_REVIEW').split(' '));
const reasons = (items: string[]) => [...new Set(items.map(v => REASONS.has(v)||/^OPPOSING_(MN1|W1|D1|H4)_(STRUCTURE|SWING_FLOW)$/.test(v)?v:'UNRECOGNIZED_ENGINE_CODE'))].slice(0,24);
const newest = (a: Finding,b: Finding) => b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id);

export function errorReport(symbol: BridgeSymbol, code: string, now = new Date().toISOString()) {
  return {schema_version:'desk-report-v2',symbol,status:'ERROR',generated_at:now,as_of:null,
    expires_at:now,error:choice(code,['UPSTREAM_UNAVAILABLE','INVALID_REQUEST','INVALID_EVIDENCE','REPORT_TOO_LARGE','TRANSPORT_ERROR','UNTRUSTED_RESPONSE'])??'UPSTREAM_UNAVAILABLE',
    source:null,quote:null,frames:[],scenario:null,evidence:{},rules:{},candle_windows:[],coverage:null,trading_enabled:false};
}

/** Presentation-only projection. It neither detects patterns nor ranks/validates trading targets. */
export function buildDeskReport(r: Intelligence, data: Record<Timeframe,CandleResponse>, quote: MarketQuote, now = new Date().toISOString(), engineCommit: string|null = null, budgetTier=0) {
  const symbol = r.symbol as BridgeSymbol;
  if(!REPORT_SYMBOLS.includes(symbol)) throw Error('INVALID_EVIDENCE');
  const cutoff=Date.parse(r.as_of),clock=Date.parse(now);
  if(!Number.isFinite(cutoff)||!Number.isFinite(clock)||cutoff>clock||r.schema_version!=='edge-knowledge-5') throw Error('INVALID_EVIDENCE');
  const all=r.frames.flatMap(f=>f.findings),byId=new Map(all.map(f=>[f.id,f])),states=new Map(r.levels.states.map(s=>[s.id,s]));
  // Refuse a corrupted upstream object instead of quietly discarding future findings.
  if(byId.size!==all.length||all.some(f=>f.side!==r.price_side||!f.id.startsWith(`${symbol}:${f.timeframe}:${r.price_side}:`)||!date(f.confirmed_at)||Date.parse(f.confirmed_at)>cutoff||!date(f.origin)||f.origin>f.confirmed_at||f.candle_evidence.some(c=>!date(c.closed_at)||c.closed_at>f.confirmed_at||c.time>=c.closed_at)))throw Error('INVALID_EVIDENCE');
  if(TFS.some(tf=>data[tf].symbol!==symbol||data[tf].timeframe!==tf||data[tf].environment!==r.environment||!date(data[tf].fetched_at)||Date.parse(data[tf].fetched_at)>clock))throw Error('INVALID_EVIDENCE');

  const evidence: Record<string,unknown>={},rules:Record<string,unknown>={},windows:string[][]=[],windowByKey=new Map<string,number>(),refById=new Map<string,string>();
  const windowRef=(start:string,end:string)=>{const key=`${start}/${end}`;let index=windowByKey.get(key);if(index===undefined){index=windows.length;windowByKey.set(key,index);windows.push([start,end]);}return index;};
  function add(id:string):string {
    const previous=refById.get(id);if(previous)return previous;
    const f=byId.get(id);if(!f)throw Error('INVALID_EVIDENCE');
    const ref=`e${refById.size}`;refById.set(id,ref);
    const s=states.get(id),facts=f.facts,junction=facts.junction as {lower?:unknown;upper?:unknown}|undefined;
    const lower=number(facts.lower)??number(junction?.lower)??number(facts.price),upper=number(facts.upper)??number(junction?.upper)??number(facts.price);
    const candleRefs=f.candle_evidence.map(c=>windowRef(c.time,c.closed_at));
    const formation=f.facts.formation as ReturnType<typeof snrFormationContext>|undefined;
    rules[f.rule_id]={version:f.rule_version,status:f.rule_status,specification:f.specification,
      basis:choice((f as Finding&{basis?:string}).basis,['DOCUMENTED','PROJECT_HYPOTHESIS']),source_revisions:f.sources.map(x=>({id:x.id,revision:x.revision}))};
    const interactions=s?[s.first_raid,s.last_test,s.reaction,s.lower_tf_breach,...s.role_evidence].filter(x=>x!==null).map(x=>{
      if(!date(x.confirmed_at)||x.confirmed_at>r.as_of||x.confirmed_at>s.evaluated_through||x.time<f.confirmed_at)throw Error('INVALID_EVIDENCE');
      return {kind:x.kind,timeframe:x.timeframe,candle:windowRef(x.time,x.confirmed_at)};
    }):[];
    const dependencies:string[]=[];
    for(const key of ['kl_id','pivot_id','poi_id','raid_id','vc_id','source_id','rb_liquidity_id','rb_fvg_id','snr_x1_fvg_id','snr_opposing_kl_id'])if(typeof facts[key]==='string'){const dependency=add(facts[key] as string);if(!dependencies.includes(dependency))dependencies.push(dependency);}
    evidence[ref]={id:f.id,timeframe:f.timeframe,kind:f.kind,origin:f.origin,confirmed_at:f.confirmed_at,
      lower,upper,variant:facts.variant===3?facts.variant:null,polarity:choice(facts.polarity,['high','low']),
      direction:choice(facts.direction,['bullish','bearish','Bullish','Bearish','up','down']),
      detector_state:f.state,data_status:f.data_status,rule:f.rule_id,
      ...(f.kind==='RB_TWO_CANDLE'?{rb:{revision:'rb-first-close-3',level_policy:'FIRST_CANDLE_CLOSE',level_price:number(facts.level_price),formation_confirmed:true,
        basis:facts.basis,relative_quality:facts.relative_quality,probability:null,significance:'REVIEW_REQUIRED',
        primary_kl:add(String(facts.kl_id)),liquidity:typeof facts.rb_liquidity_id==='string'?add(facts.rb_liquidity_id):null,fvg:typeof facts.rb_fvg_id==='string'?add(facts.rb_fvg_id):null}}:{}),
      ...(f.kind==='SNR_CLOSED_BREAK'&&formation?{snr:{revision:formation.revision,level_policy:formation.level_policy,level_price:formation.level_price,formation_confirmed:true,
        origin_confirmed_at:formation.origin_confirmed_at,delivery_at:formation.delivery_at,breakout_at:formation.breakout_at,waiting_bars:formation.waiting_bars,formation_seconds:formation.formation_seconds,
        failed_test_bars:formation.failed_test_bars,failed_test_episodes:formation.failed_test_episodes,test_windows:formation.failed_tests.map(c=>windowRef(c.time,c.closed_at)),
        breakout_body:formation.breakout_body,breakout_body_fraction:formation.breakout_body_fraction,prior_body_sample:formation.prior_body_sample,body_to_prior_median:formation.body_to_prior_median,
        impulse_leg_bars:formation.impulse_leg_bars,impulse_leg_body_to_median:formation.impulse_leg_body_to_median,impulse_leg_efficiency:formation.impulse_leg_efficiency,
        impulse_detected:formation.impulse_detected,impulse_evidence:formation.impulse_evidence,relative_strength:formation.relative_strength,strength_policy:formation.strength_policy,impulse_policy:formation.impulse_policy,
        probability:null,review_required:true,primary_kl:add(String(facts.kl_id)),x1_fvg:formation.x1_fvg_id?add(formation.x1_fvg_id):null,opposing_kl:formation.opposing_kl_id?add(formation.opposing_kl_id):null,opposing_bounds:formation.opposing_bounds}}:{}),
      candle_refs:candleRefs,candle_evidence_sha256:hash(f.candle_evidence),dependencies,
      lifecycle:s?{state:s.state,initial_role:s.initial_role,fill:s.fill??null,current_role:s.role_status==='RETEST_CONFIRMED'&&!['INVALIDATED','TESTED','CONSUMED','UNVERIFIED'].includes(s.state)?s.current_role:null,role_status:['INVALIDATED','CONSUMED','UNVERIFIED'].includes(s.state)?'UNVERIFIED':s.role_status,coverage:s.coverage,evaluated_through:s.evaluated_through,
        invalidated_at:s.invalidated_at,liquidity_consumed:s.liquidity_consumed,interactions}:null};
    return ref;
  }
  function group(values:Finding[],limit:number){const sorted=[...values].sort(newest),selected=sorted.slice(0,limit);return {items:selected.map(f=>add(f.id)),total:values.length,omitted:values.length-selected.length};}
  const frameRows=r.frames.map(f=>{
    const tf=f.timeframe,bars=closedFrame(data[tf],r.price_side,r.as_of).bars;
    const fractals=[3].flatMap(variant=>['high','low'].map(polarity=>({variant,polarity,...group(f.findings.filter(x=>x.kind==='FRACTAL'&&x.facts.variant===variant&&x.facts.polarity===polarity),1)})));
    const automatic=f.dr_detection,range=f.range??automatic.current;
    const proposed=automatic.local_candidates.at(-1)?.range??null;
    const rangeCandidate=!range&&proposed?{high:add(proposed.high_id),low:add(proposed.low_id),lower:proposed.lower,upper:proposed.upper,
      equilibrium:proposed.equilibrium,confirmed_at:proposed.confirmed_at,method:'KL_REACTION_LOCAL_DR_CANDIDATE',review_required:true}:null;
    const rangeState=f.range?f.range_state:{state:automatic.status==='ESTABLISHED'?'ACTIVE':'AWAITING_NEW_EXTREME',invalidated_at:automatic.close_break_at};
    return {...(f.range_candidates?{range_options:{total:f.range_candidates.candidates.length,omitted:f.range_candidates.candidates.length-(rangeCandidate?1:0),review_required:true}}:{}),timeframe:tf,fetched_at:data[tf].fetched_at,last_closed_at:bars.at(-1)?.end??null,closed_candles:f.closed_candles,
      data_status:f.data_status,warnings:reasons(f.warnings),discarded_rows:data[tf].metadata.discarded_rows,
      structure:{bias:bias(f.structure_bias),events:group(f.findings.filter(x=>['BOS','CHOCH'].includes(x.kind)),1),
        swing_bias:bias(f.order_flow.bias),swing_basis:f.order_flow.status,swing_evidence:f.order_flow.evidence_ids.map(add)},
      fractals,snr:group(f.findings.filter(x=>x.kind==='SNR_CLOSED_BREAK'),budgetTier>=6&&tf!==r.narrative.A?.timeframe?0:1),rb:group(f.findings.filter(x=>x.kind==='RB_TWO_CANDLE'),budgetTier>=1&&tf!==[...r.frames].reverse().find(frame=>frame.findings.some(x=>x.kind==='RB_TWO_CANDLE'))?.timeframe?0:1),
      snr_quality:{very_strong_candidates:f.findings.filter(x=>x.kind==='SNR_CLOSED_BREAK'&&(x.facts.formation as ReturnType<typeof snrFormationContext>)?.relative_strength==='VERY_STRONG_FORMATION_CANDIDATE').length,context_conflicts:f.findings.filter(x=>x.kind==='SNR_CLOSED_BREAK'&&(x.facts.formation as ReturnType<typeof snrFormationContext>)?.relative_strength==='CONTEXT_CONFLICT').length,review_required:f.findings.filter(x=>x.kind==='SNR_CLOSED_BREAK'&&(x.facts.formation as ReturnType<typeof snrFormationContext>)?.relative_strength==='REVIEW_REQUIRED').length},
      rb_quality:{raid_backed:f.findings.filter(x=>x.kind==='RB_TWO_CANDLE'&&x.facts.relative_quality==='RAID_BACKED').length,fvg_only_weaker:f.findings.filter(x=>x.kind==='RB_TWO_CANDLE'&&x.facts.relative_quality==='WEAKER_FVG_ONLY').length,counting:'FINDINGS_PER_PRIMARY_KL'},
      fvg:group(f.findings.filter(x=>x.kind==='FVG'),budgetTier>=2?0:1),ifvg:group(f.findings.filter(x=>x.kind==='FVG_CLOSED_BREACH'),0),
      liquidity:{raids:group(f.findings.filter(x=>x.kind==='RAID'),budgetTier>=2?0:1),idm:group(f.findings.filter(x=>x.kind==='IDM_INSIDE_POI'),0),strong:group(f.findings.filter(x=>x.kind==='STRONG_PIVOT_CANDIDATE'),0),irl:group(f.findings.filter(x=>x.kind==='INTERNAL_LIQUIDITY'),budgetTier>=2?0:1)},
      dealing_range:range?{high:add(range.high_id),low:add(range.low_id),lower:range.lower,upper:range.upper,equilibrium:range.equilibrium,
        confirmed_at:range.confirmed_at,state:rangeState.state,invalidated_at:rangeState.invalidated_at}:null,
      range_status:f.range?f.range_state.state:automatic.status,range_candidate:rangeCandidate};
  });
  const selectedA=r.narrative.A?.id??null,reference=r.data_quality.reference_price;
  const anchorAlternatives=r.tda.anchors.filter(a=>['MN1','W1','D1'].includes(a.timeframe)&&a.eligible_as_poi&&a.context!=='AWAITING_DELIVERY').map(a=>a.id);
  // Surface nearby active HTF levels when price is outside all KLs, without inventing an active A.
  const nearbyA=!selectedA&&anchorAlternatives.length===0&&reference!==null?r.levels.detected_levels.map(l=>currentBounds(l,states.get(l.id)))
    .filter(l=>['MN1','W1','D1'].includes(l.timeframe)&&['FRACTAL','FVG'].includes(l.kind)&&states.get(l.id)?.state==='ACTIVE'&&states.get(l.id)?.role_status!=='UNVERIFIED')
    .sort((a,b)=>{
      const distance=(l:typeof a)=>reference<l.lower?l.lower-reference:reference>l.upper?reference-l.upper:0;
      return distance(a)-distance(b)||a.id.localeCompare(b.id);
    }).slice(0,2).map(l=>l.id):[];
  const aIds=[...new Set([...(selectedA?[selectedA]:[]),...anchorAlternatives,...nearbyA])];
  const aShown=aIds.slice(0,3);
  const ts=r.target_selection,candidates=ts.target_candidates;
  // Preserve engine eligibility. Recency is only a display order, never a new preferred target.
  const eligible=candidates.filter(c=>c.role_eligible),ordered=[...eligible].sort((a,b)=>(byId.get(b.id)?.confirmed_at??'').localeCompare(byId.get(a.id)?.confirmed_at??'')||a.id.localeCompare(b.id));
  const bIds=[...new Set([...(ts.selected_candidate?[ts.selected_candidate.id]:[]),...ordered.map(c=>c.id)])].slice(0,3);
  const bRows=bIds.map(id=>{const c=candidates.find(c=>c.id===id)!;const review=ts.candidate_reviews.find(v=>v.id===id);
    const obstacles=review?.path_obstacle_ids??(ts.selected_candidate?.id===id?ts.obstacles.map(o=>o.id):null);
    const shown=obstacles?.slice(0,budgetTier>=4?1:4)??[];
    return {level:add(id),role_eligible:c.role_eligible,author_timeframe_eligible:review?.author_timeframe_eligible??null,
      reasons:reasons(c.reasons),path:{items:shown.map(add),total:obstacles?.length??null,omitted:obstacles?obstacles.length-shown.length:null,
        completeness:obstacles===null||review?.path_completeness==='UNKNOWN'?'UNASSESSED':shown.length<obstacles.length||review?.path_completeness!=='COMPLETE'?'PARTIAL':'COMPLETE'}};
  });
  const C=r.narrative.C;
  const qtime=date(quote.provider_timestamp??quote.quote_time),qretrieved=date(quote.retrieved_at??quote.fetched_at_utc);
  const bid=number(quote.bid),ask=number(quote.ask),validQuote=bid!==null&&ask!==null&&bid>0&&ask>=bid;
  const qAge=qtime?(clock-Date.parse(qtime))/1000:null;
  if(qAge!==null&&qAge<0||qretrieved&&Date.parse(qretrieved)>clock)throw Error('INVALID_EVIDENCE');
  const policy=freshnessPolicy(process.env);
  const staleReasons:string[]=[];
  const marketClosed=quote.market_status==='CLOSED'&&qretrieved!==null&&clock-Date.parse(qretrieved)<=policy.delivery_seconds*1000;
  if(!validQuote)staleReasons.push('QUOTE_UNAVAILABLE');
  if(!qtime)staleReasons.push('QUOTE_PROVIDER_TIME_UNKNOWN');
  else if(!marketClosed&&(qAge!>policy.quote_seconds||!quote.fresh))staleReasons.push('QUOTE_STALE');
  if(TFS.some(tf=>clock-Date.parse(data[tf].fetched_at)>policy.delivery_seconds*1000))staleReasons.push('SOURCE_SNAPSHOT_STALE');
  const h4=frameRows.find(f=>f.timeframe==='H4')?.last_closed_at;
  const expectedH4=Math.floor(clock/14400_000)*14400_000;
  const h4Delay=h4&&Date.parse(h4)<expectedH4?(clock-(Date.parse(h4)+14400_000))/1000:0;
  const knownClosure=!!h4&&Date.parse(h4)<expectedH4&&closedRegularInterval(symbol,Date.parse(h4),expectedH4);
  if(!h4||h4Delay>policy.h4_delay_seconds&&!knownClosure)staleReasons.push('H4_CLOSED_CANDLE_DELAY');
  const errors=frameRows.some(f=>f.closed_candles===0);
  const researchContext=compactResearchContext(r,add,budgetTier>=3?0:1,budgetTier>=4,budgetTier>=5?1:undefined);
  const result={technical_only:true,details:{path:'/api/intelligence',snapshot_sha256:r.narrative.human_review.evidence_sha256},schema_version:'desk-report-v2',symbol,status:errors?'ERROR':staleReasons.length?'STALE':r.data_quality.status==='UNVERIFIED'?'UNVERIFIED':'PARTIAL',
    published_at:null,freshness:{quote_retrieved_at:qretrieved,quote_status:marketClosed?'MARKET_CLOSED':validQuote&&qAge!==null&&qAge<=policy.quote_seconds&&quote.fresh?'FRESH':'STALE',data_quality:r.data_quality.status,stale_reasons:staleReasons,quote_max_seconds:policy.quote_seconds,h4_max_delay_seconds:policy.h4_delay_seconds,h4_delay_seconds:h4Delay,source_age_seconds:Math.max(...TFS.map(tf=>(clock-Date.parse(data[tf].fetched_at))/1000)),delivery_max_seconds:policy.delivery_seconds},generated_at:now,as_of:r.as_of,expires_at:new Date(!marketClosed&&validQuote&&qAge!==null&&qAge<=policy.quote_seconds&&quote.fresh?Math.min(clock+policy.delivery_seconds*1000,Date.parse(qtime!)+policy.quote_seconds*1000):clock+policy.delivery_seconds*1000).toISOString(),error:errors?'UPSTREAM_UNAVAILABLE':null,
    source:{provider:'Capital.com',environment:r.environment,analysis_schema:r.schema_version,price_side:r.price_side,
      engine_commit:engineCommit&&/^[a-f0-9]{40}$/.test(engineCommit)?engineCommit:null,evidence_sha256:r.narrative.human_review.evidence_sha256,
      demo_live_equivalence:'NOT_ESTABLISHED',full_ohlc_published:false},
    quote:{bid:validQuote?bid:null,ask:validQuote?ask:null,spread:validQuote?ask!-bid!:null,provider_timestamp:qtime,retrieved_at:qretrieved,
      source_type:choice(quote.source_type,['REST','WEBSOCKET']),market_status:choice(quote.market_status,['TRADEABLE','CLOSED','EDITS_ONLY','OFFLINE','ON_AUCTION','ON_AUCTION_NO_EDITS','SUSPENDED']),
      provider_age_seconds:qAge,fresh:validQuote&&qAge!==null&&qAge>=0&&qAge<=policy.quote_seconds&&quote.fresh&&!marketClosed,used_as_closed_evidence:false},
    narrative_method:compactNarrativeMethod(r,add,budgetTier),frames:frameRows,research_context:researchContext,tda:compactTda(r,add,budgetTier),
    scenario:{candidate_narrative:bias(r.narrative.candidate_bias),confirmed_narrative:r.narrative.confirmed_narrative,status:r.narrative.status,
      evidence_quality:{status:r.narrative.evidence_confidence.status,human_reviewed:r.narrative.evidence_confidence.human_reviewed,independently_validated:false,probability:null},
      A:{selected:selectedA?add(selectedA):null,items:aShown.map(add),total:aIds.length,omitted:aIds.length-aShown.length},
      B:{selected:ts.selected_candidate?add(ts.selected_candidate.id):null,validated:ts.validated_target?add(ts.validated_target.id):null,
        status:ts.status,items:bRows,total:candidates.length,role_eligible:eligible.length,omitted:candidates.length-bRows.length},
      C:C?{source:add(C.source_id),timeframe:C.timeframe,price:C.price,condition:C.condition==='closed full boundary breach'?'OWN_TF_CLOSE_BEYOND_FVG':C.condition==='Research method own-TF structural boundary breach'?'OWN_TF_CLOSE_BEYOND_STRUCTURE':'MANUAL_OWN_TF_CLOSE_BEYOND'}:null,
      invalidations:{entry:r.narrative.entry_invalidated,KL:r.narrative.KL_invalidated,narrative:r.narrative.narrative_invalidated},
      blockers:reasons([...new Set([...r.narrative.blockers,...ts.blockers])]),action:'NOT_EVALUATED'},
    evidence,rules,candle_windows:windows,coverage:{budget_tier:budgetTier,selection_policy:'RECENT_PER_CATEGORY_PLUS_ENGINE_SCENARIO_AND_REFERENCED_DEPENDENCIES',
      findings_total:all.length,findings_included:refById.size,findings_omitted:all.length-refById.size,selected_evidence_complete:true,
      all_findings_included:refById.size===all.length,stale_reasons:staleReasons,raw_ohlc_included:false},trading_enabled:false};
  if(Buffer.byteLength(JSON.stringify(result))+1>MAX_REPORT_BYTES){
    if(budgetTier<6)return buildDeskReport(r,data,quote,now,engineCommit,budgetTier+1);
    throw Error('REPORT_TOO_LARGE');
  }
  validateReport(result,symbol);
  return result;
}
