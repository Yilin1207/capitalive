import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {closedFrame,type Frame} from '../lib/knowledge/data';
import {TF_ORDER,type KeyLevel,type Range} from '../lib/knowledge/detectors';
import {buildResearchContext,observedPriceBehaviour,levelLifecycleExplanation,validateDealingRangeEvidence,validatePathCompleteness} from '../lib/knowledge/research-context';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import {inspectResearch} from '../lib/knowledge/inspection';
import {intelligenceHttp} from '../lib/knowledge/http';
import {encodeIntelligence,decodeIntelligence} from '../lib/knowledge/wire';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

const input=()=>JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
const i=input(),r=buildIntelligence(i.data,'bid',i.quote);
const frames=Object.fromEntries(TF_ORDER.map(tf=>[tf,closedFrame(i.data[tf],'bid',r.as_of)])) as Record<Timeframe,Frame>;
const now=new Date(Math.max(...TF_ORDER.map(tf=>Date.parse(i.data[tf].fetched_at)),Date.parse(i.quote.retrieved_at??i.quote.fetched_at_utc??i.data.H4.fetched_at))).toISOString();
const report=buildDeskReport(r,i.data,i.quote,now);
const levels=r.levels.detected_levels.map(l=>({...l,side:'bid',role:l.initial_role,source_finding:r.frames.flatMap(f=>f.findings).find(f=>f.id===l.id)!,qualified:['FRACTAL','FVG'].includes(l.kind)})) as KeyLevel[];
const states=r.levels.states.map(s=>({...s,sources:[],rule_status:'TESTED',specification:'FORMALIZED',invalidation:'test'}));

test('V5.1 observations remain facts; close change and fractal distances agree with independent arithmetic',()=>{
  for(const o of r.research_context.observed_price_behaviour){const bars=frames[o.timeframe].bars;
    if(o.last_close_change)assert.equal(o.last_close_change.delta,bars.at(-1)!.close-bars.at(-2)!.close);
    if(o.last_observed_fractal_leg){const leg=o.last_observed_fractal_leg,find=r.frames.flatMap(f=>f.findings);
      const a=find.find(f=>f.id===leg.from_id)!,b=find.find(f=>f.id===leg.to_id)!;assert.equal(leg.price_distance,Number(b.facts.price)-Number(a.facts.price));}
    assert.equal(o.trend_confirmed,false);assert.equal(o.significance,'NOT_ASSESSED');}
  assert.equal(r.research_context.author_structure.status,'NEEDS_SPECIFICATION');assert.equal(r.research_context.confirmed_narrative,null);
});
test('V5.1 last closed movement is not stitched across a gap or replaced by a quote',()=>{
  const f=structuredClone(frames.H4);f.bars.at(-1)!.segment+=1;
  assert.equal(observedPriceBehaviour(f,[]).last_close_change,null);
  const other=buildIntelligence(i.data,'bid',{...i.quote,bid:1,ask:2});assert.deepEqual(other.research_context,r.research_context);
});
test('FVG full test is historical and does not become verified resistance or support',()=>{
  const s={...states.find(s=>s.kind==='FVG')!,state:'TESTED' as const,initial_role:'support' as const,current_role:'support' as const,role_status:'ORIGINAL_GEOMETRY' as const,
    lower:100,upper:110,fill:{state:'FILLED' as const,max_observed_fraction:1,first_test_at:null,last_test_at:null}};
  const x=levelLifecycleExplanation(s,95);assert.equal(x.current_role,null);assert.equal(x.reference_position,'BELOW');assert.equal(x.original_geometry_role,'support');assert.ok(x.reasons.includes('FULL_FILL_TESTED_NOT_ACTIVE'));
  assert.equal(x.current_role_status,'UNVERIFIED');
});
test('V5.1 consumed liquidity is distinct from invalidated zone and no automatic role flip',()=>{
  const x=levelLifecycleExplanation({...states[0],state:'CONSUMED',liquidity_consumed:true},100);
  assert.equal(x.current_role,null);assert.equal(x.structural_relevance,'ZONE_REVIEW_AFTER_LIQUIDITY_CONSUMPTION');assert.ok(x.reasons.includes('LIQUIDITY_CONSUMED_DOES_NOT_PROVE_ZONE_ROLE_REVERSAL'));
});
test('V5.1 DR review exposes consumed boundaries and never fabricates Premium/Discount',()=>{
  const f=r.frames.find(f=>f.range_candidates.candidates.length)!;const range=f.range_candidates.candidates[0] as Range;
  const changed=states.map(s=>s.id===range.high_id?{...s,state:'CONSUMED' as const,liquidity_consumed:true}:s);
  const v=validateDealingRangeEvidence(range,changed,frames[f.timeframe],levels);
  assert.equal(v.observed_boundaries_intact,false);assert.equal(v.candidate_suitable_for_review,false);assert.equal(v.premium_discount,null);assert.equal(v.active_dealing_range,false);
  assert.ok(v.requirements.includes('BOUNDARY_CONSUMED_OR_UNVERIFIED'));assert.equal(v.high.id,range.high_id);
});
test('V5.1 HTF/LTF links are closed, causal, scoped to X-1/X-2 and trace real source levels',()=>{
  const byId=new Map(r.frames.flatMap(f=>f.findings).map(f=>[f.id,f]));
  for(const l of r.research_context.levels)for(const link of l.interactions){const f=byId.get(link.id)!;
    assert.ok(TF_ORDER.slice(TF_ORDER.indexOf(l.timeframe)+1,TF_ORDER.indexOf(l.timeframe)+3).includes(link.timeframe));
    assert.ok(link.confirmed_at>l.confirmed_at&&link.confirmed_at<=r.as_of);
    const source=levels.find(s=>s.id===l.id)!;
    assert.ok(f.facts.kl_id===l.id||f.facts.pivot_id===l.id||f.candle_evidence.some(c=>{
      let lower=source.lower,upper=source.upper;
      if(source.kind==='FVG'){
        const prior=TF_ORDER.slice(TF_ORDER.indexOf(source.timeframe)).flatMap(tf=>frames[tf].bars.filter(b=>b.time>=source.confirmed_at&&b.end<=c.time&&b.low<=source.upper&&b.high>=source.lower));
        if(source.role==='support')upper=Math.min(upper,...prior.map(b=>b.low));else lower=Math.max(lower,...prior.map(b=>b.high));
        if(lower>=upper)return false;
      }
      return c.time>=source.confirmed_at&&c.high>=lower&&c.low<=upper;
    }));}
});
test('V5.1 paths examine all four TF before presentation; omitted obstacles cannot be COMPLETE',()=>{
  const p=validatePathCompleteness(levels,states,frames,1,1e9,[],[]);
  assert.ok(p.total>0);assert.equal(p.omitted,p.total);assert.equal(p.status,'PARTIAL');assert.equal(p.free_path_proven,false);
  assert.ok(p.obstacles.some(o=>o.timeframe==='H4'));
  assert.ok(p.obstacles.some(o=>o.lifecycle==='CONSUMED'),'Consumed liquidity may still require zone review; never declare a clear path from consumption alone');
  const missing={...frames,H4:{...frames.H4,bars:[]}};assert.equal(validatePathCompleteness(levels,states,missing,1,1e9).status,'UNVERIFIED');
  assert.equal(validatePathCompleteness(levels,states,frames,null,100).status,'UNVERIFIED');
});
test('V5.1 compact context preserves references, counted omissions, clocks, roles and DR review',()=>{
  validateReport(report);assert.ok(Buffer.byteLength(JSON.stringify(report))+1<=65536);assert.equal(report.research_context.revision,'context-5.1');
  assert.ok(report.research_context.executive_evidence.omitted>0);
  for(const item of report.research_context.executive_evidence.items){assert.ok(report.evidence[item.level]);assert.equal(item.human_validated,false);if(item.current_role_status==='UNVERIFIED')assert.equal(item.current_role,null);}
  for(const f of report.frames)if(f.range_candidate)for(const ref of [f.range_candidate.high,f.range_candidate.low])assert.equal((report.evidence[ref] as {lifecycle:{state:string}}).lifecycle.state,'ACTIVE');
});
test('V5.1 contract rejects future context, false role confirmation and invented fractal distance',()=>{
  const a=structuredClone(report);a.research_context.executive_evidence.items[0].current_role='support';assert.throws(()=>validateReport(a));
  const b=structuredClone(report);b.research_context.full_inspection.as_of='2099-01-01T00:00:00.000Z';assert.throws(()=>validateReport(b));
  const c=structuredClone(report);c.research_context.observed_price_behaviour.find(o=>o.last_observed_fractal_leg)!.last_observed_fractal_leg!.price_distance+=5;assert.throws(()=>validateReport(c));
});
test('DR portable contract rejects reversed chronology, false position and wrong top-down fallback',()=>{
  const a=structuredClone(report),d=a.research_context.dealing_range_reviews.find(f=>f.detection.status==='ESTABLISHED')!.detection;
  d.direction=d.direction==='Bullish'?'Bearish':'Bullish';assert.throws(()=>validateReport(a),/INVALID_DR_ORDER/);
  const b=structuredClone(report),e=b.research_context.dealing_range_reviews.find(f=>f.detection.status==='ESTABLISHED')!.detection;e.premium_discount=e.premium_discount==='PREMIUM'?'DISCOUNT':'PREMIUM';assert.throws(()=>validateReport(b),/INVALID_DR_POSITION/);
  const c=structuredClone(report);c.research_context.dealing_range_selection.timeframe=null;assert.throws(()=>validateReport(c),/INVALID_DR_FALLBACK/);
  const f=structuredClone(report),q=f.frames.find(x=>x.dealing_range)!.dealing_range!;q.lower-=1;assert.throws(()=>validateReport(f),/INVALID_RANGE_CANDIDATE/);
});
test('V5.1 inspection pages cover every finding once, expose only closed formation windows',()=>{
  const found=new Set<string>();let cursor:number|null=0;
  let reviewedApproaches=0;
  while(cursor!==null){const p=inspectResearch(r,frames,cursor,50);p.findings.forEach(f=>{assert.ok(!found.has(f.id));found.add(f.id);});assert.ok(p.closed_ohlc_windows.every(c=>c.closed_at<=r.as_of));assert.equal(p.publication_allowed,false);
    for(const l of p.level_reviews){const a=l.approach_path;assert.equal(a.free_path_proven,false);
      if(a.reference_inside){assert.equal(a.validation,null);assert.equal(a.reason,'REFERENCE_ALREADY_INSIDE_ZONE');}
      else {assert.ok(a.validation);assert.equal(a.validation.from,r.data_quality.reference_price);assert.ok([l.lower,l.upper].includes(a.validation.to!));assert.equal(a.validation.obstacles.some(o=>o.id===l.id),false);assert.equal(a.validation.omitted,0);reviewedApproaches++;}
    }cursor=p.next_offset;}
  assert.ok(reviewedApproaches>0);
  assert.equal(found.size,r.frames.flatMap(f=>f.findings).length);assert.throws(()=>inspectResearch(r,frames,0,100));
});
test('V5.1 inspection HTTP requires immutable snapshot and rejects changed input',async()=>{
  const dependencies={getCandles:async(_s:string,tf:Timeframe)=>i.data[tf],getAnalysisQuote:async()=>({...i.quote,cache_hit:false,evaluated_at:now})};
  const params=new URLSearchParams({symbol:'NAS100',side:'bid',mode:'inspection',as_of:r.as_of,evidence_sha256:r.narrative.human_review.evidence_sha256,limit:'10'});
  const good=await intelligenceHttp(new Request('https://example.test/api/intelligence?'+params),dependencies);assert.equal(good.status,200);assert.equal((await good.json()).returned,10);
  params.set('evidence_sha256','f'.repeat(64));assert.equal((await intelligenceHttp(new Request('https://example.test/api/intelligence?'+params),dependencies)).status,409);
  params.delete('evidence_sha256');assert.equal((await intelligenceHttp(new Request('https://example.test/api/intelligence?'+params),dependencies)).status,400);
});
test('V5.1 dictionary v2 is lossless, bounded and rejects cyclic/invalid references',()=>{
  const wire=encodeIntelligence(r);assert.deepEqual(decodeIntelligence(wire),r);assert.ok(Buffer.byteLength(JSON.stringify(wire))<4250000);
  assert.throws(()=>decodeIntelligence({wire_format:'evidence-dictionary-2',provenance_catalog:{},context_object_catalog:[{context_object_ref:0}],x:{context_object_ref:0}}));
});
test('V5.1 environment, provider mismatch and future suffix fail closed without becoming a visual oracle',()=>{
  const bad=input();bad.data.D1.environment=bad.data.D1.environment==='demo'?'live':'demo';assert.throws(()=>buildIntelligence(bad.data,'bid',bad.quote));
  const foreign=input();(foreign.data.H4 as {provider:string}).provider='FXCM';assert.throws(()=>buildIntelligence(foreign.data,'bid',foreign.quote));
  const historical=buildIntelligence(i.data,'bid',i.quote,{as_of:r.as_of});assert.deepEqual(historical.research_context,r.research_context);
  const ask=buildIntelligence(i.data,'ask',i.quote);assert.ok(ask.research_context.evidence_ids.every(id=>id.includes(':ask:')));
});
