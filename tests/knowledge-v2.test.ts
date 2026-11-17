import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import type {Frame,Bar} from '../lib/knowledge/data';import {closedFrame} from '../lib/knowledge/data';
import {assessLevel,intervalCoverage,type LevelState} from '../lib/knowledge/level-state';
import {selectTarget as targetWithCoverage} from '../lib/knowledge/target-selection';
// These synthetic tests define the complete finite level universe explicitly.
const selectTarget=(...args:Parameters<typeof targetWithCoverage>)=>{args[6]??='COMPLETE';return targetWithCoverage(...args);};
import {resolveContext,narrativeAssessment,assessInvalidations,type NarrativeFrame} from '../lib/knowledge/narrative';
import {TF_ORDER,type KeyLevel} from '../lib/knowledge/detectors';
import {provenance} from '../lib/knowledge/rules';import {buildIntelligence} from '../lib/knowledge/intelligence';
import type {Timeframe,CandleResponse} from '../lib/candle-data';import type {MarketQuote} from '../lib/quote-normalization';
import golden from './fixtures/edge-v2/golden-expectations.json';
const expected=(id:string)=>golden.cases.find(c=>c.id===id)!.expected;
const at=(hours:number)=>new Date(Date.UTC(2026,0,1,hours)).toISOString();
const bar=(start:number,end:number,open:number,high:number,low:number,close:number,segment=0):Bar=>({index:start,time:at(start),end:at(end),open,high,low,close,segment});
function frames(rows:Bar[],tf:Timeframe='W1',end=336){return Object.fromEntries(TF_ORDER.map(t=>[t,{symbol:'TEST',timeframe:t,side:'bid',as_of:at(end),status:'PARTIAL',warnings:[],bars:t===tf?rows:[]}])) as unknown as Record<Timeframe,Frame>;}
function level(role:'support'|'resistance'='resistance',kind:KeyLevel['kind']='FRACTAL',tf:Timeframe='W1',id='target'):KeyLevel{return {id,kind,timeframe:tf,side:'bid',lower:10,upper:10,role,confirmed_at:at(168),qualified:true,source_finding:{id,kind,timeframe:tf,side:'bid',origin:at(0),confirmed_at:at(168),data_status:'PARTIAL',candle_evidence:[],...provenance('EDGE.FRACTAL_3.v1'),invalidation:'test',facts:{},state:'OBSERVED'}};}
const origin=()=>bar(0,168,8,10,6,8);
const intact=()=>frames([origin(),bar(168,336,8,9,7,8)]);
function target(l:KeyLevel,f:Record<Timeframe,Frame>,end=336){const s=assessLevel(l,f,at(end),at(end));return {state:s,result:selectTarget([l],[s],8,'up',null)};}
test('V2 01 old-low-above: no arbitrary bullish target from an old low',()=>{assert.equal(target(level('support'),intact()).result.status,expected('old-low-above'));});
test('V2 02 untouched-high-above: observed original buy-side liquidity can qualify',()=>{const r=target(level(),intact());assert.equal(r.result.status,expected('untouched-high-above'));assert.equal(r.result.validated_target?.id,'target');});
test('V2 03 lower-tf-consumed: H4 strict raid consumes W1 target before W1 closes',()=>{const f=frames([origin()],'W1',172);f.H4.bars=[bar(168,172,8,11,7,9)];const r=target(level(),f,172);assert.equal(r.state.state,expected('lower-tf-consumed'));assert.equal(r.state.first_raid?.timeframe,'H4');assert.equal(r.result.status,'TARGET_UNVERIFIED');});
test('V2 04 geometry-without-role: unqualified SNR is not a validated target',()=>{assert.equal(target({...level('resistance','SNR'),qualified:false},intact()).result.status,expected('geometry-without-role'));});
test('V2 05 monthly-fvg-opposing-daily: containment cannot establish bullish narrative',()=>{
 const a={...level('support','FVG','MN1','A'),lower:6,upper:9},context=resolveContext([a],8),s={...target(level(),intact()).state,id:'A',state:'ACTIVE' as const};
 const f=TF_ORDER.map(timeframe=>({timeframe,structure_bias:timeframe==='D1'?'Bearish':'Neutral',order_flow:{bias:'Neutral',status:'PROJECT',evidence_ids:[]},range:null,findings:[]})) as NarrativeFrame[];
 const r=narrativeAssessment(context,[s],f,selectTarget([],[],8,'up',a),8,true);assert.equal(r.status,expected('monthly-fvg-opposing-daily'));assert.equal(r.bias,'Neutral');assert.ok(r.blockers.includes('AUTHOR_STRUCTURE_REVIEW_REQUIRED'));
});
test('V2 06 monthly-weekly-conflict: lower TF does not outvote monthly',()=>{const a={...level('support','FVG','MN1','A'),lower:6,upper:9},w={...a,id:'W',timeframe:'W1' as const,role:'resistance' as const};const r=resolveContext([a,w],8);assert.equal(r.reason,expected('monthly-weekly-conflict'));assert.equal(r.candidate_bias,'Neutral');const assessment=narrativeAssessment(r,[],[{timeframe:'MN1',structure_bias:'Bullish',order_flow:{bias:'Bullish',status:'PROJECT',evidence_ids:[]},range:null,findings:[]}],selectTarget([],[],8,null,a),8,true);assert.ok(!assessment.blockers.some(b=>b.startsWith('OPPOSING_')),'No direction means structure is context, not opposition to a nonexistent bias');});
test('V2 07 local-stop-htf-preserved: entry invalidation is not inherited by HTF narrative',()=>{const s=target(level(),intact()).state,r=assessInvalidations(s,true);assert.equal(r.entry_invalidated,true);assert.equal(r.narrative_invalidated,expected('local-stop-htf-preserved'));assert.equal(r.KL_invalidated,false);});
test('V2 08 gap-before-raid: no inferred causal transition through missing history',()=>{const f=frames([origin(),bar(200,336,8,11,7,9,1)]),s=target(level(),f).state;assert.equal(s.state,expected('gap-before-raid'));assert.equal(s.first_raid?.kind,'CROSSING_WITH_UNOBSERVED_HISTORY');assert.equal(s.continuity_end,at(168));});
test('V2 09 invalid-bid-ask: selected side and crossed sides are audited independently',()=>{
 const f=JSON.parse(readFileSync('tests/fixtures/edge-v2/EURUSD.json','utf8')) as {data:Record<Timeframe,CandleResponse>};const d=f.data.H4,beforeBid=closedFrame(d,'bid').bars.length,beforeAsk=closedFrame(d,'ask').bars.length;
 d.candles[10].high.bid=null;assert.equal(closedFrame(d,'bid').bars.length,beforeBid-1);assert.equal(closedFrame(d,'ask').bars.length,beforeAsk);
 d.candles[11].open.bid=d.candles[11].open.ask!+1;assert.ok(closedFrame(d,'bid').warnings.includes(String(expected('invalid-bid-ask'))));assert.ok(closedFrame(d,'ask').warnings.includes('INVALID_OHLC'));
});
test('V2 10 repeat-replay: identical input produces identical complete analysis',()=>{const f=JSON.parse(readFileSync('tests/fixtures/edge-v2/EURUSD.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};const a=buildIntelligence(f.data,'bid',f.quote),b=buildIntelligence(f.data,'bid',f.quote);assert.equal(JSON.stringify(a)===JSON.stringify(b),expected('repeat-replay'));});
test('V5 consumed original low cannot gain an opposite role from generic break/retest',()=>{
 const f=frames([origin(),bar(168,336,9,9.5,7,8),bar(336,504,8,10,7,8)],'W1',504),s=target(level('support'),f,504);
 assert.equal(s.state.liquidity_consumed,true);assert.equal(s.state.current_role,null);assert.equal(s.state.role_status,'UNVERIFIED');assert.equal(s.result.status,'TARGET_UNVERIFIED');
 const prefix=target(level('support'),f,336);assert.equal(prefix.result.status,'TARGET_UNVERIFIED');assert.ok(s.state.role_evidence.every(e=>e.confirmed_at<=at(504)));
});
test('V2 target obstacles and ambiguous structural anchors prevent nearest-level substitution',()=>{
 const high=level(),f=intact(),s=target(high,f).state,second={...high,id:'second',lower:12,upper:12};
 assert.equal(selectTarget([high,second],[s,{...s,id:'second',lower:12,upper:12}],8,'up',null).status,'TARGET_UNVERIFIED');
 const obstacle={...high,id:'obstacle',kind:'RB' as const,lower:9,upper:9.5,qualified:false},os={...s,id:'obstacle',kind:'RB' as const,lower:9,upper:9.5,state:'CANDIDATE' as const};
 const r=selectTarget([high,obstacle],[s,os],8,'up',null,high.id);assert.equal(r.status,'TARGET_UNVERIFIED');assert.equal(r.obstacles[0].certainty,'POTENTIAL_OBSTACLE_REVIEW_REQUIRED');
});
test('V2 interval coverage cannot borrow a parent candle closing in the future',()=>{const f=frames([origin(),bar(168,336,8,9,7,8)]);assert.equal(intervalCoverage([f.W1],at(168),at(172)).complete,false);});
test('V2 exact fractal touch does not consume liquidity; strict wick does',()=>{
 const touch=target(level(),frames([origin(),bar(168,336,8,10,7,9)]));assert.equal(touch.state.liquidity_consumed,false);assert.equal(touch.state.state,'ACTIVE');assert.ok(touch.state.last_test);
 const raid=target(level(),frames([origin(),bar(168,336,8,10.01,7,9)]));assert.equal(raid.state.liquidity_consumed,true);assert.equal(raid.state.state,'CONSUMED');
});
test('V2 FVG lower-TF breach is not inversion; own-TF close invalidates at its known close',()=>{
 const a={...level('support','FVG'),lower:6,upper:9},f=frames([origin()],'W1',192);f.D1.bars=[bar(168,192,8,9,4,5)];
 const lower=assessLevel(a,f,at(192),at(192));assert.equal(lower.state,'TESTED');assert.equal(lower.invalidated_at,null);assert.equal(lower.lower_tf_breach?.confirmed_at,at(192));
 f.W1.bars.push(bar(168,336,8,10,4,8));f.W1.as_of=at(336);
 const held=assessLevel(a,f,at(336),at(336));assert.equal(held.state,'TESTED');assert.equal(held.lower_tf_breach,null);
 f.W1.bars[1].close=5;const invalid=assessLevel(a,f,at(336),at(336));assert.equal(invalid.state,'INVALIDATED');assert.equal(invalid.invalidated_at,at(336));assert.equal(invalid.initial_role,'support');assert.equal(invalid.current_role,null);
});
