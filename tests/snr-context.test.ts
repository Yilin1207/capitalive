import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectSnr,TF_ORDER,type KeyLevel} from '../lib/knowledge/detectors';
import type {Frame} from '../lib/knowledge/data';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import type {snrFormationContext} from '../lib/knowledge/snr-context';
const at=(n:number)=>new Date(Date.UTC(2026,0,1,n*4)).toISOString();
const rows=[[10,12.5,9.5,12],[12.4,12.5,10.5,11],[10,11,7,9],[11,12.4,10.8,11.5],[11.3,11.6,10.8,11],[11.4,12.2,11,11.7],[11.3,11.8,10.8,11],[11,16,10.8,15.8]];
function frame(input=rows,tf:Frame['timeframe']='H4'):Frame{return {timeframe:tf,symbol:'EURUSD',side:'bid',status:'PARTIAL',warnings:[],as_of:at(input.length),bars:input.map(([open,high,low,close],index)=>({open,high,low,close,index,segment:0,time:at(index),end:at(index+1)}))};}
function kl(role:KeyLevel['role']='support',price=8):KeyLevel{return {id:'test-kl',kind:'FRACTAL',timeframe:'MN1',side:'bid',lower:price,upper:price,role,confirmed_at:at(-2),qualified:true,source_finding:{} as KeyLevel['source_finding']};}
const original=(f:Frame,levels=[kl()],x1:KeyLevel[]=[])=>detectSnr(f,levels,x1).find(x=>x.origin===at(0));
const context=(f:Frame,levels=[kl()],x1:KeyLevel[]=[])=>original(f,levels,x1)!.facts.formation as ReturnType<typeof snrFormationContext>;

test('SNR first close, opposite pair and first strict closed break for both directions and all TFs',()=>{
 for(const tf of TF_ORDER)for(const bullish of [true,false]){const input=bullish?rows:rows.map(([o,h,l,c])=>[30-o,30-l,30-h,30-c]),f=frame(input,tf),r=original(f,[kl(bullish?'support':'resistance',bullish?8:22)])!;assert.ok(r);assert.equal(r.rule_id,'EDGE.SNR.v2');assert.equal(r.facts.lower,input[0][3]);assert.equal(r.facts.upper,input[0][3]);assert.equal(r.confirmed_at,at(8));assert.equal(r.facts.proposed_role,bullish?'support':'resistance');assert.equal(r.state,'CANDIDATE');}
 const f=frame();f.bars[7].close=12;assert.equal(original(f),undefined,'Equal close is not a break');f.bars[7].close=12.1;assert.ok(original(f),'First close 12, not gap open 12.4 or origin wick 12.5');
});
test('SNR repeated failed episodes plus impulse can be very strong WITHOUT any FVG',()=>{
 const s=context(frame());assert.equal(s.waiting_bars,5);assert.equal(s.failed_test_bars,2);assert.equal(s.failed_test_episodes,2);assert.equal(s.x1_fvg_id,null);assert.equal(s.impulse_detected,true);assert.equal(s.relative_strength,'VERY_STRONG_FORMATION_CANDIDATE');assert.equal(s.probability,null);assert.equal(s.review_required,true);assert.equal(s.formation_seconds,6*4*3600);
});
test('SNR consecutive touches are one episode and slow break is not automatically very strong',()=>{
 const f=frame();f.bars[4].high=12.1;assert.equal(context(f).failed_test_episodes,1);assert.equal(context(f).relative_strength,'REVIEW_REQUIRED');const slow=frame();slow.bars[7]={...slow.bars[7],open:11.9,close:12.1,high:12.2};assert.equal(context(slow).impulse_detected,false);assert.equal(context(slow).relative_strength,'REVIEW_REQUIRED');
});
test('SNR observed opposing HTF zone prevents an unconditional strong continuation label',()=>{
 const opposing={...kl('resistance',14),id:'opposing'};const s=context(frame(),[kl(),opposing]);assert.equal(s.opposing_kl_id,'opposing');assert.equal(s.relative_strength,'CONTEXT_CONFLICT');const future={...opposing,confirmed_at:at(8)};assert.equal(context(frame(),[kl(),future]).opposing_kl_id,null);
});
test('SNR optional X-1 FVG must be causal, at level and formed within the breakout leg',()=>{
 const f=frame(undefined,'D1');f.bars[7]={...f.bars[7],open:11.9,close:12.1,high:12.2};const x1:KeyLevel={...kl(),id:'x1',kind:'FVG',timeframe:'H4',lower:11.9,upper:12.05,confirmed_at:at(8),source_finding:{origin:at(6)} as KeyLevel['source_finding']};assert.equal(context(f,[kl()],[x1]).relative_strength,'VERY_STRONG_FORMATION_CANDIDATE');for(const changed of [{...x1,confirmed_at:at(9)},{...x1,timeframe:'W1' as const},{...x1,lower:13,upper:14},{...x1,invalidated_at:at(8)},{...x1,source_finding:{origin:at(0)} as KeyLevel['source_finding']}])assert.equal(context(f,[kl()],[changed]).x1_fvg_id,null);
});
test('SNR rejects missing KL, future data, delivery after the first break and continuity gaps',()=>{
 const f=frame();assert.equal(original(f,[]),undefined);assert.equal(original(f,[{...kl(),confirmed_at:at(9)}]),undefined);assert.equal(original(f,[{...kl(),invalidated_at:at(8)}]),undefined);assert.equal(original({...f,as_of:at(7)}),undefined);const gap=frame();gap.bars[7].segment=1;assert.equal(original(gap),undefined);const early=frame();early.bars[2].close=13;early.bars[2].low=9;assert.equal(original(early),undefined);const doji=frame();doji.bars[0].open=12;assert.equal(original(doji),undefined);
});
test('SNR later retests and future impulse observations never rewrite historical formation',()=>{
 const f=frame([...rows,[15,16,11,12],[12,20,11,19]]);assert.deepEqual(original(f),original(frame()));for(let n=2;n<=rows.length;n++)assert.deepEqual(original({...f,as_of:at(n)}),original(frame(rows.slice(0,n))));
});
test('SNR compact evidence preserves metrics and rejects forged strength, price, tests and counts',()=>{
 const i=JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')),r=buildDeskReport(buildIntelligence(i.data,'bid',i.quote),i.data,i.quote,'2026-11-15T14:00:00.000Z');validateReport(r);const found=Object.entries(r.evidence).find(([,e])=>(e as any).snr);assert.ok(found,'Fixture must retain SNR context');const [id,e]=found as [string,any];assert.equal(e.lower,e.snr.level_price);for(const mutate of [(r:any)=>{r.evidence[id].snr.relative_strength=e.snr.relative_strength==='REVIEW_REQUIRED'?'VERY_STRONG_FORMATION_CANDIDATE':'REVIEW_REQUIRED';},(r:any)=>{r.evidence[id].snr.level_price+=1;},(r:any)=>{r.evidence[id].snr.failed_test_bars+=1;},(r:any)=>{delete r.evidence[id].snr;},(r:any)=>{r.frames[0].snr_quality.review_required+=1;}]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>validateReport(bad));}assert.equal(r.scenario.confirmed_narrative,null);assert.ok(Buffer.byteLength(JSON.stringify(r)+'\n')<=65536);
});
