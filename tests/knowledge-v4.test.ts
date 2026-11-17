import test from 'node:test';import assert from 'node:assert/strict';
import {assessLevel} from '../lib/knowledge/level-state';
import {detectSnr,detectIrl,detectFractals,TF_ORDER,type KeyLevel,type Range} from '../lib/knowledge/detectors';
import {selectTarget} from '../lib/knowledge/target-selection';
import {provenance} from '../lib/knowledge/rules';
import {normalizeCandles} from '../lib/candle-data';import {aggregateMonths} from '../lib/monthly-candles';import {rangeCandidates} from '../lib/knowledge/range-candidates';
import type {Frame,Bar} from '../lib/knowledge/data';import type {Timeframe} from '../lib/candle-data';
const t=(h:number)=>new Date(Date.UTC(2026,0,1,h)).toISOString();
const b=(start:number,end:number,o:number,h:number,l:number,c:number,segment=0):Bar=>({index:start,time:t(start),end:t(end),open:o,high:h,low:l,close:c,segment});
const frame=(rows:Bar[],timeframe:Timeframe='W1',end=504):Frame=>({symbol:'TEST',timeframe,side:'bid',as_of:t(end),status:'PARTIAL',warnings:[],bars:rows});
const all=(rows:Bar[],end=504)=>Object.fromEntries(TF_ORDER.map(tf=>[tf,frame(tf==='W1'?rows:[],tf,end)])) as Record<Timeframe,Frame>;
const level=(role:'support'|'resistance'='support',kind:KeyLevel['kind']='FRACTAL'):KeyLevel=>({id:'A',kind,timeframe:'W1',side:'bid',lower:10,upper:10,role,qualified:true,confirmed_at:t(168),source_finding:{id:'A',kind,timeframe:'W1',side:'bid',origin:t(0),confirmed_at:t(168),data_status:'PARTIAL',candle_evidence:[],facts:{},state:'OBSERVED',...provenance('EDGE.FRACTAL_3.v1'),invalidation:'synthetic'}});

test('V4: a later own-TF break withdraws the earlier lower-TF reversed role',()=>{
 const f=all([b(0,168,11,12,10,11),b(168,336,9,10,8,9),b(336,504,9,12,8,11)]);
 f.D1=frame([b(168,192,9,9.5,8,9),b(192,216,9,10,8,9)],'D1');
 const s=assessLevel(level(),f,t(504),t(504));
 assert.notEqual(s.state,'ACTIVE');assert.equal(s.current_role,null);assert.equal(s.role_status,'UNVERIFIED');
});
test('V4: FVG invalidation never retains an actionable current role or a later reaction',()=>{
 const l={...level('support','FVG'),lower:9,upper:10},f=all([b(0,168,11,12,10,11),b(168,336,10,11,8,8.5),b(336,504,11,12,9,11)]);
 const s=assessLevel(l,f,t(504),t(504));assert.equal(s.state,'INVALIDATED');assert.equal(s.current_role,null);assert.ok(!s.reaction||s.reaction.confirmed_at<=s.invalidated_at!);
});

test('V4: consumed liquidity and unobserved history cannot assert the original role as current',()=>{
 const consumed=assessLevel(level('resistance'),all([b(0,168,9,10,8,9),b(168,336,9,11,8,9)],336),t(336),t(336));
 assert.equal(consumed.state,'CONSUMED');assert.equal(consumed.initial_role,'resistance');assert.equal(consumed.current_role,null);
 const missing=assessLevel(level(),all([b(0,168,11,12,10,11)],336),t(336),t(336));assert.equal(missing.state,'UNVERIFIED');assert.equal(missing.current_role,null);
});

test('V4: closed parent coverage cannot stitch a lower-TF break/retest across a segment gap',()=>{
 const frames=all([b(0,168,11,12,10,11),b(168,336,11,12,8,9)],336);
 frames.D1=frame([b(168,192,9,9.5,8,9,0),b(216,240,9,10,8,9,1)],'D1',336);
 const state=assessLevel(level(),frames,t(336),t(336));assert.equal(state.coverage,'COMPLETE_OBSERVED_INTERVAL');
 assert.equal(state.state,'CONSUMED');assert.equal(state.current_role,null);assert.deepEqual(state.role_evidence,[]);
});
test('V4: SNR cannot retrofit KL delivery after the origin already broke',()=>{
 const rows=[b(0,4,9,11,8,10),b(4,8,10,11,8,9),b(8,12,9,12,9,11),b(12,16,9,10,6,9),b(16,20,9,12,8,11)];
 const kl={...level('support','FVG'),timeframe:'H4' as const,confirmed_at:t(0),lower:6,upper:7};
 assert.equal(detectSnr(frame(rows,'H4',20),[kl]).filter(x=>x.origin===t(0)).length,0);
});
test('V4: target path cannot be COMPLETE when another intervening level has unobserved history',()=>{
 const f=all([b(0,168,8,10,6,8),b(168,336,8,9,7,8)],336),l=level('resistance'),s=assessLevel(l,f,t(336),t(336));
 const obstacle={...l,id:'uncertain',lower:9,upper:9};const os={...s,id:'uncertain',coverage:'UNVERIFIED' as const,state:'UNVERIFIED' as const};
 const r=selectTarget([l,obstacle],[s,os],8,'up',null,'A');
 assert.equal((r.candidate_reviews.find(x=>x.id==='A') as unknown as {path_completeness:string}).path_completeness,'PARTIAL');
});
test('V4: IRL cannot form after its selected range has already been invalidated',()=>{
 const f=frame([b(0,4,10,11,9,10),b(4,8,10,12,9,11),b(8,12,11,11.5,9,10),b(12,16,10,16,9,16),b(16,20,11,13,10,12),b(20,24,12,14,10,11),b(24,28,11,13,10,12)],'H4',28);
 const r:Range={timeframe:'H4',high_id:'high',low_id:'low',upper:15,lower:5,equilibrium:10,origin:t(0),confirmed_at:t(12),segment:0};
 assert.equal(detectIrl(f,detectFractals(f),r).filter(x=>x.confirmed_at>t(16)).length,0);
});
test('V4: conflicting duplicates are order-independent barriers and contaminate the month explicitly',()=>{
 const row=(close:number)=>({snapshotTimeUTC:'2026-01-02T00:00:00',openPrice:{bid:10,ask:10.1},highPrice:{bid:13,ask:13.1},lowPrice:{bid:8,ask:8.1},closePrice:{bid:close,ask:close+0.1}});
 for(const prices of [[row(11),row(12),row(11)],[row(12),row(11)]]){const r=normalizeCandles({prices},'D1',Date.parse(t(800)));assert.equal(r.candles.length,0);assert.ok(r.rejected.some(r=>r.reason==='conflicting_duplicate'));}
 const valid={...row(11),snapshotTimeUTC:'2026-01-03T00:00:00'},r=normalizeCandles({prices:[row(11),row(12),valid]},'D1',Date.parse(t(800)));
 const monthly=aggregateMonths(r.candles,Date.parse(t(800)),r.rejected.map(x=>x.time));assert.equal(monthly[0].history_completeness,'partial_validation');
});
test('V4: FVG touch, partial fill, full wick fill and closed invalidation are distinct',()=>{
 const l={...level('support','FVG'),lower:8,upper:10};
 const evaluate=(low:number,close:number)=>assessLevel(l,all([b(0,168,11,12,10,11),b(168,336,11,12,low,close)],336),t(336),t(336));
 assert.equal(evaluate(10,11).fill?.state,'TOUCHED');assert.equal(evaluate(9,11).fill?.max_observed_fraction,.5);
 assert.equal(evaluate(8,11).fill?.state,'FILLED');assert.equal(evaluate(8,11).state,'ACTIVE');
 assert.equal(evaluate(7,7.5).state,'INVALIDATED');assert.equal(evaluate(7,7.5).current_role,null);
});
test('DR correction: candidates follow the chronological outer range instead of arbitrary pairs',()=>{
 const f=frame([b(0,4,7,10,6,8),b(4,8,8,12,7,10),b(8,12,10,11,5,8),b(12,16,8,10,4,9),b(16,20,9,11,6,10),b(20,24,10,13,7,11),b(24,28,11,12,6,10)],'H4',28);
 const result=rangeCandidates(f,detectFractals(f));assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].lower,4);assert.equal(result.candidates[0].upper,13);assert.equal(result.selected,null);assert.equal(result.automatic_selection,false);assert.equal(result.status,'REVIEW_REQUIRED');
 for(const range of result.candidates){assert.ok(range.confirmed_at<=f.as_of);assert.equal(range.equilibrium,(range.lower+range.upper)/2);assert.equal(range.review_required,true);}
});
test('V4: unknown obstacle universe never validates an apparently unobstructed target',()=>{
 const l=level('resistance'),s=assessLevel(l,all([b(0,168,8,10,6,8),b(168,336,8,9,7,8)],336),t(336),t(336));
 const r=selectTarget([l],[s],8,'up',null);assert.equal(r.path_completeness,'UNKNOWN');assert.equal(r.validated_target,null);assert.ok(r.blockers.includes('PATH_COVERAGE_UNKNOWN'));
});
