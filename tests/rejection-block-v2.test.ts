import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectRejectionBlocks,TF_ORDER,type KeyLevel,type Finding} from '../lib/knowledge/detectors';
import type {Frame} from '../lib/knowledge/data';
import {contextualLevels} from '../lib/knowledge/level-state';
import {provenance} from '../lib/knowledge/rules';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
const at=(i:number)=>new Date(Date.UTC(2026,0,1,i*4)).toISOString();
function frame(rows:number[][],tf:Frame['timeframe']='H4'):Frame{return {timeframe:tf,symbol:'EURUSD',side:'bid',status:'PARTIAL',warnings:[],as_of:at(rows.length),bars:rows.map(([open,high,low,close],index)=>({open,high,low,close,index,segment:0,time:at(index),end:at(index+1)}))};}
function level(kind:KeyLevel['kind']='FRACTAL',role:KeyLevel['role']='support'):KeyLevel{return {id:kind+'-'+role,kind,role,timeframe:'MN1',side:'bid',lower:10,upper:kind==='FVG'?12:10,confirmed_at:at(-4),qualified:true,source_finding:{id:'source',kind,timeframe:'MN1',side:'bid',origin:at(-7),confirmed_at:at(-4),data_status:'PARTIAL',candle_evidence:[],facts:{},state:'OBSERVED',invalidation:'fixture',...provenance('EDGE.FVG.v1')}};}
const bull=[[13,14,9,11],[11,15,10.5,14]];
const bear=[[7,11,6,9],[9,9.5,5,6]];
test('RB v2 uses first close for both directions, all TFs, including price gaps',()=>{
 for(const tf of TF_ORDER)for(const [rows,role]of [[bull,'support'],[bear,'resistance']] as const){const f=frame(rows.map(r=>[...r]),tf);f.bars[1].open+=role==='support'?1:-1;const r=detectRejectionBlocks(f,[level('FRACTAL',role)]);assert.equal(r.length,1);const b=r[0];assert.equal(b.rule_id,'EDGE.RB.v2');assert.equal(b.state,'OBSERVED');assert.equal(b.confirmed_at,f.bars[1].end);assert.equal(b.facts.level_price,f.bars[0].close);assert.deepEqual(b.facts.junction,{lower:f.bars[0].close,upper:f.bars[0].close});assert.equal(b.facts.relative_quality,'RAID_BACKED');const l=contextualLevels(r)[0];assert.equal(l.lower,f.bars[0].close);assert.equal(l.upper,l.lower);assert.equal(l.qualified,false,'Formation is not automatic trade eligibility');}
});
test('RB from FVG without body close beyond the KL is not an RB (Notion: candle must close above / below the KL)',()=>{
 // Bodies stay inside the FVG 10..12: interaction only, no RB (user decision 2026-11-23).
 for(const [rows,role]of [[[[11.8,12,10.5,11],[11,11.9,10.8,11.6]],'support'],[[[10.2,11.8,10,11],[11,11.2,10.1,10.4]],'resistance']] as const)assert.equal(detectRejectionBlocks(frame(rows.map(r=>[...r])),[level('FVG',role)]).length,0);
 // Only one of the two bodies closes beyond the zone: still not an RB.
 assert.equal(detectRejectionBlocks(frame([[13,13.5,10.5,12.5],[12.5,12.8,11,11.9]]),[level('FVG')]).length,0);
 assert.equal(detectRejectionBlocks(frame([[12.5,12.8,10.5,11.5],[11.5,13,11,12.6]]),[level('FVG')]).length,0);
});
test('RB from FVG with both bodies closing beyond the KL is an RB and is labelled FVG-only',()=>{
 for(const [rows,role]of [[[[12.6,13,10.5,12.2],[12.2,13.5,11,13]],'support'],[[[9.4,11.5,9,9.8],[9.8,10,8.5,9]],'resistance']] as const){const r=detectRejectionBlocks(frame(rows.map(r=>[...r])),[level('FVG',role)]);assert.equal(r.length,1);assert.equal(r[0].facts.relative_quality,'WEAKER_FVG_ONLY');assert.equal(r[0].facts.basis,'FVG_INTERACTION');assert.equal(r[0].facts.quality_is_probability,false);assert.equal(r[0].facts.revision,'rb-first-close-3');}
});
test('RB v2 combines FVG and reclaimed raid evidence, without turning FVG touch into a raid',()=>{
 const both=[[13,14,9,12.5],[12.5,15,10.5,14]];
 const r=detectRejectionBlocks(frame(both),[level('FVG'),level()]);assert.equal(r.length,2);assert.ok(r.every(x=>x.facts.basis==='FVG_AND_LIQUIDITY_RAID'&&x.facts.rb_liquidity_id===level().id&&x.facts.rb_fvg_id===level('FVG').id));
 const equal=detectRejectionBlocks(frame([[13,14,10,12.5],[12.5,15,10.5,14]]),[level('FVG'),level()]);assert.equal(equal.length,1);assert.equal(equal[0].facts.relative_quality,'WEAKER_FVG_ONLY');
 // Bodies inside the FVG: the raid-backed RB stays, the FVG is not its inefficiency context.
 const inside=detectRejectionBlocks(frame(bull),[level('FVG'),level()]);assert.equal(inside.length,1);assert.equal(inside[0].facts.basis,'LIQUIDITY_RAID');assert.equal(inside[0].facts.rb_fvg_id,undefined);
});
test('RB v2 uses the FVG residual known before the pair, never a future fill or an already tested zone',()=>{
 const l=level('FVG');
 const f=frame([[12.6,13,10.5,12.2],[12.2,13.5,11,13]]);
 assert.equal(detectRejectionBlocks(f,[{...l,fvg_test_steps:[{at:at(2),fraction:1}]}]).length,1);
 assert.equal(detectRejectionBlocks(f,[{...l,fvg_test_steps:[{at:at(0),fraction:1}]}]).length,0);
 assert.equal(detectRejectionBlocks(f,[{...l,fvg_test_steps:[{at:at(0),fraction:.8}]}]).length,0,'Pair only touches the already filled part above 10.4');
});
test('RB v2 permits either wick to raid but does not require a third fractal-confirming candle',()=>{
 const r=detectRejectionBlocks(frame([[13,14,10.5,11],[11,15,9,14]]),[level()]);assert.equal(r.length,1);assert.equal(r[0].candle_evidence.length,2);assert.equal(r[0].confirmed_at,at(2));
});
test('RB v2 rejects a lone rejection, doji, same-direction candles and absent KL',()=>{
 for(const rows of [bull.slice(0,1),[[13,14,9,11],[11,14,10,11]],[[13,14,9,11],[11,12,10,10.5]]])assert.equal(detectRejectionBlocks(frame(rows),[level()]).length,0);
 assert.equal(detectRejectionBlocks(frame(bull),[]).length,0);
});
test('RB v2 rejects future or invalidated KL, lower-TF context, unfinished bars and history gaps',()=>{
 const f=frame(bull);for(const kl of [{...level(),confirmed_at:at(1)},{...level(),invalidated_at:at(1)},{...level(),continuity_end:at(1)},{...level(),side:'ask'}])assert.equal(detectRejectionBlocks(f,[kl]).length,0);
 assert.equal(detectRejectionBlocks(frame(bull,'MN1'),[{...level(),timeframe:'H4'}]).length,0);
 assert.equal(detectRejectionBlocks({...f,as_of:at(1)},[level()]).length,0);
 assert.equal(detectRejectionBlocks({...f,bars:f.bars.map((b,i)=>({...b,segment:i}))},[level()]).length,0);
});
test('RB v2 never labels a known prior crossing or un-reclaimed liquidity break as a fresh raid-backed RB',()=>{
 const rows=[[12,13,9,12],...bull],r=detectRejectionBlocks(frame(rows),[level(),level('FVG')]);assert.ok(r.every(x=>x.facts.relative_quality==='WEAKER_FVG_ONLY'));
 assert.equal(detectRejectionBlocks(frame([[11,12,8,9],[9,11,8.5,9.5]]),[level()]).length,0);
});
test('RB v2 historical prefixes are stable when future observations are supplied',()=>{
 const rows=[...bull,[14,15,10,12],[12,14,10.5,13]],all=frame(rows);
 for(let n=1;n<=rows.length;n++)assert.deepEqual(detectRejectionBlocks({...all,as_of:at(n)},[level(),level('FVG')]),detectRejectionBlocks(frame(rows.slice(0,n)),[level(),level('FVG')]));
});
test('RB compact report retains basis and evidence and rejects forged quality, level and counts',()=>{
 const i=JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')),r=buildIntelligence(i.data,'bid',i.quote),report=buildDeskReport(r,i.data,i.quote,'2026-11-15T14:00:00.000Z');validateReport(report,'NAS100');
 const entries=Object.entries(report.evidence) as [string,any][],found=entries.find(([,e])=>e.rb);assert.ok(found,'Real fixture must expose at least one RB with its context');
 const [key,e]=found;assert.equal(e.lower,e.rb.level_price);assert.equal(e.upper,e.rb.level_price);assert.ok(e.dependencies.includes(e.rb.primary_kl));
 for(const mutate of [(x:any)=>{x.evidence[key].rb.relative_quality=e.rb.relative_quality==='RAID_BACKED'?'WEAKER_FVG_ONLY':'RAID_BACKED';},(x:any)=>{x.evidence[key].rb.level_price+=1;},(x:any)=>{x.frames[0].rb_quality.raid_backed+=1;},(x:any)=>{delete x.evidence[key].rb;}]){const x=structuredClone(report);mutate(x);assert.throws(()=>validateReport(x,'NAS100'));}
 assert.equal(report.scenario.confirmed_narrative,null);assert.equal(report.trading_enabled,false);
});
test('RB-rich archived NAS100 stays below 64 KiB with honest counted omissions',()=>{
 const i=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8'));
 for(const side of ['bid','ask'] as const){const r=buildIntelligence(i.data,side,i.quote),now=new Date(Math.max(...Object.values(i.data as Record<string,{fetched_at:string}>).map(d=>Date.parse(d.fetched_at)),...['retrieved_at','fetched_at_utc','provider_timestamp','evaluated_at'].map(k=>Date.parse(i.quote[k])).filter(Number.isFinite))).toISOString();const report=buildDeskReport(r,i.data,i.quote,now);validateReport(report);assert.ok(Buffer.byteLength(JSON.stringify(report)+'\n')<=65536);assert.ok(Number.isInteger(report.coverage.budget_tier)&&report.coverage.budget_tier>=0);assert.ok(report.research_context.executive_evidence.omitted>0);for(const p of report.research_context.paths)if(p.obstacles.omitted)assert.notEqual(p.status,'COMPLETE');assert.ok(report.frames.every(f=>f.rb_quality.raid_backed+f.rb_quality.fvg_only_weaker===f.rb.total));}
});
