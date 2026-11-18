import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {fractalTrend,deliveryScore,boundaryObservation,riskReward,buildNarrativeMethod} from '../lib/knowledge/narrative-method';
import {TF_ORDER,type Finding,type KeyLevel,type Range} from '../lib/knowledge/detectors';
import type {Frame,Bar} from '../lib/knowledge/data';import type {LevelState} from '../lib/knowledge/level-state';
import {buildIntelligence} from '../lib/knowledge/intelligence';import {buildDeskReport} from '../lib/research-bridge/report';import {validateReport} from '../lib/research-bridge/contract';
const at=(h:number)=>new Date(Date.UTC(2026,0,1,h)).toISOString();
const bar=(i:number,open=12,close=12,low=11,high=13):Bar=>({index:i,segment:0,time:at(i*4),end:at((i+1)*4),open,close,low,high});
const frame=(bars:Bar[],tf:Frame['timeframe']='H4',asOf=bars.at(-1)?.end??at(0)):Frame=>({symbol:'TEST',side:'bid',timeframe:tf,as_of:asOf,bars,status:'PARTIAL',warnings:[]});
const frames=(bars:Bar[])=>Object.fromEntries(TF_ORDER.map(tf=>[tf,frame(bars,tf)])) as Record<Frame['timeframe'],Frame>;
const pivot=(id:string,price:number,polarity:string,rows:Bar[],tf:Frame['timeframe']='H4')=>({id,kind:'FRACTAL',timeframe:tf,confirmed_at:rows.at(-1)!.end,origin:rows[0].time,facts:{price,polarity,variant:3},candle_evidence:rows.map(b=>({...b,closed_at:b.end}))} as unknown as Finding);
const level=(tf:Frame['timeframe']='H4'):KeyLevel=>({id:'A',kind:'FRACTAL',side:'bid',timeframe:tf,lower:10,upper:10,role:'support',qualified:true,confirmed_at:at(0),source_finding:{id:'A',facts:{},candle_evidence:[]} as unknown as Finding});
const state=(l:KeyLevel):LevelState=>({id:l.id,state:'ACTIVE',coverage:'COMPLETE_OBSERVED_INTERVAL',current_role:l.role,liquidity_consumed:false} as LevelState);
const range=(tf:Frame['timeframe'],lower:number,upper:number):Range=>({timeframe:tf,lower,upper,equilibrium:(lower+upper)/2,confirmed_at:at(0),origin:at(-4),high_id:tf+'H',low_id:tf+'L',segment:0});

test('HH/HL uses two confirmed highs and lows; future and other segments do not change current trend',()=>{
 const rows=Array.from({length:8},(_,i)=>bar(i)),f=frame(rows),ps=[pivot('h1',15,'high',rows.slice(0,3)),pivot('h2',17,'high',rows.slice(3,6)),pivot('l1',8,'low',rows.slice(1,4)),pivot('l2',10,'low',rows.slice(4,7))];
 assert.equal(fractalTrend(f,ps).bias,'Bullish');assert.equal(fractalTrend(f,ps).dr_override,false);
 const future=pivot('future',1,'low',[bar(9),bar(10),bar(11)]);assert.deepEqual(fractalTrend(f,[...ps,future]),fractalTrend(f,ps));
 assert.equal(fractalTrend(f,[...ps.slice(0,3),{...ps[3],facts:{...ps[3].facts,price:6}}]).bias,'Neutral');
 assert.equal(fractalTrend({...f,as_of:at(36),bars:[...rows,{...bar(8),segment:1}]},ps).status,'INSUFFICIENT_CONFIRMED_PIVOTS');
});
test('Monthly priority: opposing weekly PD reduces a five-point repeated-hold level to four',()=>{
 const rows=[bar(0,12,11,9,13),bar(1,12,13,12,14),bar(2,12,11,9,13),bar(3,12,13,12,14)],all=frames(rows),a=level('MN1'),mn=range('MN1',0,40),w=range('W1',0,16);
 const baseline=buildNarrativeMethod(all,[],[a],[state(a)],[{timeframe:'MN1',range:mn,active:true}],12),conflict=buildNarrativeMethod(all,[],[a],[state(a)],[{timeframe:'MN1',range:mn,active:true},{timeframe:'W1',range:w,active:true}],12);
 assert.equal(baseline.candidates[0].quality.hold_episodes,2);assert.equal(baseline.candidates[0].quality.score,5);assert.equal(conflict.primary_context,'MN1');assert.equal(conflict.mn1_w1_conflict,true);assert.equal(conflict.candidates[0].quality.score,4);
});
test('Consecutive contact candles are one hold episode; no context does not invent a score',()=>{
 const a=level(),all=frames([bar(0,12,11,9),bar(1,12,11,9),bar(2,12,11,9)]),r=buildNarrativeMethod(all,[],[a],[state(a)],[],11);
 assert.equal(r.candidates[0].quality.hold_episodes,1);assert.equal(r.candidates[0].quality.score,null);
});
test('Short grading mirrors long: Premium favors resistance; weekly Discount is a penalty',()=>{
 const rows=[bar(0,12,11,9,13),bar(1,12,13,12,14),bar(2,12,11,9,13)].map(b=>({...b,open:40-b.open,close:40-b.close,low:40-b.high,high:40-b.low})),a={...level('MN1'),lower:30,upper:30,role:'resistance' as const},all=frames(rows);
 const r=buildNarrativeMethod(all,[],[a],[state(a)],[{timeframe:'MN1',range:range('MN1',0,40),active:true},{timeframe:'W1',range:range('W1',24,40),active:true}],28);
 assert.equal(r.candidates[0].quality.score,4);assert.equal(r.candidates[0].quality.anchor_position,'PREMIUM');
});
test('H4 EQ fallback needs established range, known trend and no other interior PA',()=>{
 const rows=Array.from({length:8},(_,i)=>bar(i)),all=frames(rows),ps=[pivot('h1',15,'high',rows.slice(0,3)),pivot('h2',17,'high',rows.slice(3,6)),pivot('l1',8,'low',rows.slice(1,4)),pivot('l2',10,'low',rows.slice(4,7))],q=range('H4',5,19);
 const ranges=[{timeframe:'H4' as const,range:q,active:true}],r=buildNarrativeMethod(all,ps,[],[],ranges,12);assert.equal(r.candidates[0].A.kind,'DR_EQ');assert.equal(r.candidates[0].A.entry,12);assert.deepEqual(r.candidates[0].A.source_ids,['H4H','H4L']);
 const a=level();assert.ok(!buildNarrativeMethod(all,ps,[a],[state(a)],ranges,12).candidates.some(c=>c.A.kind==='DR_EQ'));
 assert.equal(buildNarrativeMethod(all,ps,[],[],[{...ranges[0],active:false}],12).candidates.length,0);
});
test('Pre-contact delivery excludes contact and later explosive reaction candles',()=>{
 const prior=Array.from({length:20},(_,i)=>bar(i,30,29,28,31));
 const approaching=[bar(20,22,21.8,21,23),bar(21,21.8,22,21,23),bar(22,22,21.8,21,23),bar(23,21.8,22,21,23),bar(24,22,21.8,21,23),bar(25,21.8,21.7,21,23)],touch=bar(26,12,11,10,13),a=level();
 const base=deliveryScore(frame([...prior,...approaching,touch]),a,[]);assert.equal(base.score,5);assert.equal(base.through,at(104));assert.equal(base.contact_at,at(104));
 const after=deliveryScore(frame([...prior,...approaching,touch,bar(27,11,100,11,101)]),a,[]);assert.deepEqual(after,base);
 const opposing={...pivot('FVG',20,'low',approaching.slice(0,3)),kind:'FVG',facts:{direction:'bearish'}};assert.equal(deliveryScore(frame([...prior,...approaching,touch]),a,[opposing]).score,2);
});
test('No FVG and insufficient history never automatically imply a five-point approach',()=>{
 const r=deliveryScore(frame([bar(0),bar(1),bar(2)]),level(),[]);assert.equal(r.score,null);assert.equal(r.reason,'INSUFFICIENT_APPROACH_HISTORY');
});
test('Wick stop breach does not cancel Narrative until own-TF close; equality is not strict crossing',()=>{
 const all=frames([bar(0,12,11,9,13)]);all.D1=frame([{...bar(0,12,11,9,13),end:at(4)}],'D1');
 const r=boundaryObservation(all,'D1',10,'Bullish',at(0));assert.equal(r.wick_breached,true);assert.equal(r.close_breached,false);
 all.D1.bars[0].close=9;assert.equal(boundaryObservation(all,'D1',10,'Bullish',at(0)).close_breached,true);
 const exact=frames([bar(0,12,11,10)]);assert.equal(boundaryObservation(exact,'H4',10,'Bullish',at(0)).wick_breached,false);
});
test('R:R uses directional geometry; missing C, inverted stops and reached targets give no ratio',()=>{
 assert.equal(riskReward(10,16,8,'Bullish')?.ratio,3);assert.equal(riskReward(10,4,12,'Bearish')?.ratio,3);
 for(const x of [riskReward(10,16,null,'Bullish'),riskReward(10,16,11,'Bullish'),riskReward(10,8,9,'Bullish')])assert.equal(x,null);
});
test('Raid-backed SNR extreme can supply C and stop; forming time does not create a false coverage gap',()=>{
 const rows=[bar(0,12,10,8,13),bar(1,10,12,9,13),bar(2,12,12,11,13)],all=frames(rows);for(const f of Object.values(all))f.as_of=at(14);
 const liq={...pivot('LIQ',10,'low',[bar(-3),bar(-2),bar(-1)]),confirmed_at:at(0)},snrFinding={...pivot('SNR',11,'low',rows.slice(0,2)),kind:'SNR_CLOSED_BREAK',facts:{kl_id:'LIQ',direction:'bullish'}},a={...level(),id:'SNR',kind:'SNR' as const,lower:11,upper:11,confirmed_at:at(8),source_finding:snrFinding},b={...level(),id:'B',lower:20,upper:20,role:'resistance' as const};
 const r=buildNarrativeMethod(all,[liq,snrFinding],[a,b],[{...state(a),state:'CANDIDATE'},state(b)],[],12),c=r.candidates.find(c=>c.id==='SNR')!;
 assert.equal(c.C?.kind,'RAID_BACKED_PA_EXTREME');assert.equal(c.C?.price,8);assert.equal(c.entry_stop?.wick_breached,false);assert.equal(c.entry_stop?.evaluated_through,at(12));assert.equal(c.rr?.ratio,3);assert.equal(c.confirmed_narrative,null);
 const withoutRaid={...a,source_finding:{...snrFinding,facts:{direction:'bullish'}}};assert.equal(buildNarrativeMethod(all,[liq],[withoutRaid,b],[state(withoutRaid),state(b)],[],12).candidates.find(c=>c.id==='SNR')?.entry_stop,null);
});
test('Filled FVG and own-TF broken PA cannot become narrative A',()=>{
 const a={...level(),kind:'FVG' as const,lower:9,upper:10},all=frames([bar(0,12,11,9)]);assert.equal(buildNarrativeMethod(all,[],[a],[{...state(a),state:'TESTED'}],[],11).candidates.length,0);
 const rb={...a,kind:'RB' as const};assert.equal(buildNarrativeMethod(frames([bar(0,12,8,7)]),[],[rb],[{...state(rb),state:'CANDIDATE'}],[],8).candidates.length,0);
});
test('Actual compact report preserves bounded scores, source IDs, trend and no automatic confirmation',()=>{
 const i=JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')),r=buildIntelligence(i.data,'bid',i.quote),b=buildDeskReport(r,i.data,i.quote,'2026-11-15T14:00:00.000Z');validateReport(b);assert.ok(Buffer.byteLength(JSON.stringify(b)+'\n')<=65536);assert.equal(b.narrative_method.automatic_confirmation,false);assert.ok(b.narrative_method.candidates.items.length);
 const bad:any=structuredClone(b);bad.narrative_method.candidates.items[0].quality.score=99;assert.throws(()=>validateReport(bad));
 const forged:any=structuredClone(b);forged.frames[0].structure.swing_bias=forged.frames[0].structure.swing_bias==='Bullish'?'Bearish':'Bullish';assert.throws(()=>validateReport(forged));
});
