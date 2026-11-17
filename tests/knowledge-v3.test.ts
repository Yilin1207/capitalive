import test from 'node:test';import assert from 'node:assert/strict';
import {narrativeAssessment,resolveContext,type NarrativeFrame} from '../lib/knowledge/narrative';
import {REVIEW_QUESTIONS,reviewErrors,type HumanReview} from '../lib/knowledge/human-review';
import {selectTarget as targetWithCoverage} from '../lib/knowledge/target-selection';
// These synthetic tests define the complete finite level universe explicitly.
const selectTarget=(...args:Parameters<typeof targetWithCoverage>)=>{args[6]??='COMPLETE';return targetWithCoverage(...args);};
import {assessLevel} from '../lib/knowledge/level-state';
import {provenance} from '../lib/knowledge/rules';
import {TF_ORDER,assessRange,type KeyLevel,type Range} from '../lib/knowledge/detectors';
import type {Frame} from '../lib/knowledge/data';
import type {Timeframe} from '../lib/candle-data';
const t=(d:number)=>new Date(Date.UTC(2026,0,1+d)).toISOString();
const bar=(i:number,close=10)=>({index:i,time:t(i*7),end:t((i+1)*7),open:10,high:11,low:9,close,segment:0});
const all=Object.fromEntries(TF_ORDER.map(tf=>[tf,{symbol:'TEST',timeframe:tf,side:'bid',as_of:t(21),status:'PARTIAL',warnings:[],bars:tf==='W1'?[bar(0),bar(1),bar(2)]:[]}])) as unknown as Record<Timeframe,Frame>;
const level=(id:string,lower:number,upper:number,role:KeyLevel['role']):KeyLevel=>({id,kind:'FVG',timeframe:'W1',side:'bid',lower,upper,role,qualified:true,confirmed_at:t(7),source_finding:{id,kind:'FVG',timeframe:'W1',side:'bid',origin:t(0),confirmed_at:t(7),candle_evidence:[],data_status:'PARTIAL',facts:{},state:'OBSERVED',invalidation:'Synthetic own-TF breach',...provenance('EDGE.FVG.v1')}});
const range:Range={timeframe:'W1',low_id:'low',high_id:'high',lower:5,upper:15,equilibrium:10,origin:t(0),confirmed_at:t(7),segment:0};
function scenario(up=true){const a=level('A',8,12,up?'support':'resistance'),b=level('B',up?14:6,up?15:7,up?'resistance':'support'),states=[a,b].map(l=>assessLevel(l,all,t(21),t(21))),context=resolveContext([a],10),target=selectTarget([a,b],states,10,up?'up':'down',a),frames: NarrativeFrame[]=[{timeframe:'W1',structure_bias:'Neutral',order_flow:{bias:'Neutral',status:'PROJECT',evidence_ids:[]},range,range_state:{state:'ACTIVE',invalidated_at:null},findings:[]}];return {a,b,states,context,target,frames};}
const hash='a'.repeat(64),review=(decision:HumanReview['decision']):HumanReview=>({evidence_sha256:hash,as_of:t(21),reviewer:'Synthetic test reviewer',decision,answers:Object.fromEntries(REVIEW_QUESTIONS.map(q=>[q.id,'Explicit synthetic qualitative evidence, not a market label'])),counterarguments:['Opposing structure can develop','Unobserved holiday exceptions','Qualitative delivery can be misread']});
test('V3 reviewed Bullish/Bearish scenario can confirm without extra VC or forced SOF alignment',()=>{for(const up of [true,false]){const s=scenario(up),r=narrativeAssessment(s.context,s.states,s.frames,s.target,10,true,review(up?'Bullish':'Bearish'),hash,true);assert.equal(r.status,'CONFIRMED_NARRATIVE');assert.equal(r.bias,up?'Bullish':'Bearish');assert.equal(r.review_required,false);assert.equal(r.evidence_confidence.independently_validated,false);}});
test('V3 containment alone remains Candidate; human review cannot bypass missing data, target, C, range or stale hash',()=>{const s=scenario();assert.equal(narrativeAssessment(s.context,s.states,s.frames,s.target,10,true).bias,'Neutral');for(const args of [{reliable:false,target:s.target,frames:s.frames,hash,C:true},{reliable:true,target:selectTarget([],[],10,'up',s.a),frames:s.frames,hash,C:true},{reliable:true,target:s.target,frames:s.frames,hash:'b'.repeat(64),C:true},{reliable:true,target:s.target,frames:s.frames,hash,C:false},{reliable:true,target:s.target,frames:s.frames.map(f=>({...f,range_state:{state:'INVALIDATED',invalidated_at:t(14)}})),hash,C:true}]){assert.equal(narrativeAssessment(s.context,s.states,args.frames,args.target,10,args.reliable,review('Bullish'),args.hash,args.C).review_required,true);}});
test('V3 neutral review stays separate from unconfirmed neutral fallback',()=>{const s=scenario();const pending=narrativeAssessment(s.context,s.states,s.frames,s.target,10,true);assert.equal(pending.confirmed_narrative,null);const confirmed=narrativeAssessment(s.context,s.states,s.frames,s.target,10,true,review('Neutral'),hash,false);assert.equal(confirmed.confirmed_narrative,'Neutral');assert.equal(confirmed.status,'CONFIRMED_NEUTRAL');assert.ok(reviewErrors({...review('Bullish'),answers:{}}).length);});
test('V3 invalid geometric distractor does not suppress unique eligible target; explicit invalid target never falls back',()=>{const s=scenario(),bad={...s.b,id:'invalid',lower:13,upper:13.5},states=[...s.states,{...s.states[1],id:'invalid',state:'INVALIDATED' as const}];const r=selectTarget([s.a,s.b,bad],states,10,'up',s.a);assert.equal(r.validated_target?.id,'B');assert.equal(r.target_candidates.length,2);assert.equal(r.candidate_reviews.length,1);assert.equal(selectTarget([s.a,s.b,bad],states,10,'up',s.a,'invalid').validated_target,null);});
test('V3 range returning inside after closed breakout is still invalid; unknown later segment cannot restore it',()=>{const f={...all.W1,bars:[bar(0),bar(1,16),bar(2,10)]};assert.equal(assessRange(f,range).state,'INVALIDATED');assert.equal(assessRange({...all.W1,bars:[bar(0),{...bar(1),segment:1}]},range).state,'UNVERIFIED');});


test('TDA: MN1 target is X/X-1; D1 X-2 is refinement, not an eligible target',()=>{
  const s=scenario(true);
  const a={...s.a,timeframe:'MN1' as const},b={...s.b,timeframe:'D1' as const};
  const r=selectTarget([a,b],s.states,10,'up',a);
  assert.equal(r.status,'TARGET_UNVERIFIED');
  assert.equal(r.candidate_target,null);
  assert.equal(r.candidate_reviews.find(x=>x.id==='B')?.author_timeframe_eligible,false);
  assert.equal(selectTarget([a,{...b,timeframe:'W1'}],s.states,10,'up',a).validated_target?.id,'B');
  assert.equal(selectTarget([a,b],s.states,10,'up',a,'not-found').validated_target,null);
});
