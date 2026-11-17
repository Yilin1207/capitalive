import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessLevel} from '../lib/knowledge/level-state';
import {buildResearchContext} from '../lib/knowledge/research-context';
import {levelAt,fvgTestTimeline} from '../lib/knowledge/fvg-remaining';
import {selectTarget} from '../lib/knowledge/target-selection';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import {TF_ORDER,type KeyLevel} from '../lib/knowledge/detectors';
import type {Frame,Bar} from '../lib/knowledge/data';
const at=(n:number)=>new Date(Date.UTC(2026,0,1,n)).toISOString();
const bar=(start:number,low:number,high:number,close:number):Bar=>({index:start/4+1,segment:0,time:at(start),end:at(start+4),open:close,low,high,close});
function setup(role:'support'|'resistance'='support',bars:Bar[]=[],end=bars.at(-1)?.end??at(0)){
 const l:KeyLevel={id:'EURUSD:H4:bid:FVG:2026-01-01T00:00:00.000Z',kind:'FVG',timeframe:'H4',side:'bid',lower:100,upper:110,role,confirmed_at:at(0),qualified:true,source_finding:{origin:at(-12)} as KeyLevel['source_finding']};
 const frames=Object.fromEntries(TF_ORDER.map(tf=>[tf,{timeframe:tf,symbol:'EURUSD',side:'bid',status:'PARTIAL',warnings:[],as_of:end,bars:tf==='H4'?[bar(-4,111,115,113),...bars]:[]}])) as unknown as Record<Frame['timeframe'],Frame>;
 return {l,frames,evaluate:()=>assessLevel(l,frames,end,end)};
}
test('Bullish FVG touch leaves whole area, partial tests only shrink the upper boundary',()=>{
 const a=setup('support',[bar(0,110,114,112)]).evaluate();assert.equal(a.state,'ACTIVE');assert.equal(a.fill?.state,'TOUCHED');assert.deepEqual(a.fill?.remaining,{lower:100,upper:110});
 const b=setup('support',[bar(0,106,114,112),bar(4,108,114,112)]).evaluate();assert.equal(b.state,'ACTIVE');assert.equal(b.fill?.max_observed_fraction,.4);assert.deepEqual(b.fill?.remaining,{lower:100,upper:106});assert.equal(b.lower,100);assert.equal(b.upper,110,'Original formation is preserved');
});
test('Bearish FVG leaves the untouched upper portion and exact far-boundary touch fully tests it',()=>{
 const a=setup('resistance',[bar(0,96,104,98)]).evaluate();assert.deepEqual(a.fill?.remaining,{lower:104,upper:110});
 const b=setup('resistance',[bar(0,96,110,98)]).evaluate();assert.equal(b.state,'TESTED');assert.equal(b.fill?.state,'FILLED');assert.equal(b.fill?.remaining,null);assert.equal(b.fill?.fully_tested_at,at(4));assert.equal(b.invalidated_at,null);assert.equal(b.current_role,null);
});
test('Full wick test is terminal for activity without requiring an own-TF closed invalidation',()=>{
 const x=setup('support',[bar(0,100,115,113),bar(4,108,115,113)]).evaluate();assert.equal(x.state,'TESTED');assert.equal(x.fill?.remaining,null);assert.equal(x.fill?.fully_tested_at,at(4));assert.equal(x.invalidated_at,null);assert.equal(x.current_role,null);
 const broken=setup('support',[bar(0,99,114,99)]).evaluate();assert.equal(broken.state,'INVALIDATED');assert.equal(broken.fill?.remaining,null);assert.equal(broken.invalidated_at,at(4));
});
test('Missing intervals cannot prove an active residual; observed full fill still rules out activity',()=>{
 const a=setup('support',[bar(4,106,114,112)]).evaluate();assert.equal(a.state,'UNVERIFIED');assert.equal(a.fill?.state,'UNKNOWN');assert.deepEqual(a.fill?.remaining,{lower:100,upper:106});
 const b=setup('support',[bar(4,100,114,112)]).evaluate();assert.equal(b.state,'TESTED');assert.equal(b.coverage,'UNVERIFIED');
});
test('No pre-confirmation, forming or nonintersecting gap candle manufactures a full test',()=>{
 const a=setup('support',[bar(0,106,114,112),bar(4,90,120,115)],at(4)).evaluate();assert.equal(a.fill?.max_observed_fraction,.4);
 const b=setup('support',[bar(0,90,95,94)]).evaluate();assert.equal(b.fill?.max_observed_fraction,0);assert.equal(b.fill?.fully_tested_at,null);assert.equal(b.state,'INVALIDATED');
});
test('Historical FVG context uses only the residual known before the observation',()=>{
 const {l,frames}=setup('support',[bar(0,106,114,112),bar(4,100,114,112)]);l.fvg_test_steps=fvgTestTimeline(l,Object.values(frames));assert.equal(l.fvg_test_steps.length,2);assert.equal(levelAt(l,at(0))?.upper,110);assert.equal(levelAt(l,at(4))?.upper,106);assert.equal(levelAt(l,at(8)),null);assert.equal(levelAt(l,at(4))?.upper,106);assert.equal(l.upper,110);
});
test('A deeper later test does not move the original first-interaction timestamp',()=>{
 const {l,frames,evaluate}=setup('support',[bar(0,109,114,112),bar(4,106,114,112)]);
 const r=buildResearchContext(frames,[],[l],[evaluate()],112);
 const review=r.levels.find(x=>x.id===l.id)!;
 assert.equal(review.lifecycle_explanation.first_interaction_at,at(4));
 assert.equal(review.upper,106);
});
test('Target eligibility and target price use residual boundaries, fully tested FVG is ineligible',()=>{
 const {l,evaluate}=setup('resistance',[bar(0,96,104,98)]),s=evaluate();l.timeframe='D1';s.timeframe='D1';const t=selectTarget([l],[s],102,'up',null);assert.equal(t.target_candidates[0].price,104);assert.equal(t.target_candidates[0].role_eligible,true);
 const full={...s,state:'TESTED' as const,current_role:null};assert.equal(selectTarget([l],[full],102,'up',null).target_candidates[0].role_eligible,false);
});
test('Real fixture cannot expose a fully tested FVG as active; compact contract rejects fabricated residuals',()=>{
 const i=JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')),r=buildIntelligence(i.data,'bid',i.quote);for(const s of r.levels.states.filter(s=>s.kind==='FVG')){if(s.fill?.state==='FILLED'){assert.notEqual(s.state,'ACTIVE');assert.ok(!r.levels.active_level_ids.includes(s.id));assert.equal(s.fill.remaining,null);}if(s.state==='ACTIVE')assert.ok(s.fill?.remaining&&s.fill.max_observed_fraction<1);}
 const report=buildDeskReport(r,i.data,i.quote,'2026-11-15T14:00:00.000Z');validateReport(report);const found=Object.entries(report.evidence).find(([,e])=>(e as any).lifecycle?.fill?.revision==='fvg-unfilled-1');assert.ok(found);const [key]=found;const bad:any=structuredClone(report);bad.evidence[key].lifecycle.fill.remaining={lower:1,upper:2};assert.throws(()=>validateReport(bad));assert.equal(report.scenario.confirmed_narrative,null);
});
