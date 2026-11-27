import test from 'node:test';
import assert from 'node:assert/strict';
import type {Frame} from '../lib/knowledge/data';
import {detectSnr,detectRejectionBlocks,detectFvg,pivotLevels,detectFractals,TF_ORDER,type KeyLevel} from '../lib/knowledge/detectors';
import {assessLevel,contextualLevels} from '../lib/knowledge/level-state';
import type {Timeframe} from '../lib/candle-data';
import {rule} from '../lib/knowledge/rules';

const at=(index:number)=>new Date(Date.UTC(2026,0,5,index*4)).toISOString();
function frame(rows:number[][],timeframe:Timeframe='H4',symbol='EURUSD'):Frame {
  return {symbol,timeframe,side:'bid',as_of:at(rows.length),warnings:[],status:'PARTIAL',
    bars:rows.map(([open,high,low,close],index)=>({open,high,low,close,index,time:at(index),end:at(index+1),segment:0}))};
}
function snrs(f:Frame,context:KeyLevel[]=[]){return detectSnr(f,context,[],false,'PA_ONLY');}
function rbs(f:Frame,context:KeyLevel[]){return detectRejectionBlocks(f,context,'PA_ONLY');}
test('a bullish candle entirely beyond an earlier wrong-colour gap is not the SNR breakout',()=>{
 const f=frame([[100,112,99,110],[110,111,103,104],[118,119,114,115],[115,120,114,119]]);
 assert.ok(!snrs(f).some(x=>x.origin===f.bars[0].time));
});
function state(l:KeyLevel,f:Frame,through=f.as_of,lower?:Frame){
 const frames=Object.fromEntries(TF_ORDER.map(tf=>[tf,tf===f.timeframe?f:tf===lower?.timeframe?lower:{...f,timeframe:tf,bars:[]}])) as Record<Timeframe,Frame>;
 return assessLevel(l,frames,through,through,'PA_ONLY');
}
for(const [symbol,tf,near,far] of [
 ['NAS100','W1',27005,28504],['EURUSD','D1',1.09668,1.09714]
] as const)test(symbol+' '+tf+' bearish SNR uses first body, waits for a directional strict close, and needs no KL',()=>{
 const d=(far-near)/4;
 const f=frame([[far,far+d,near-d,near],[near,far,near,near+d],
   [near-d*2,near+d,near-d*3,near-d], // bullish close below threshold cannot confirm bearish SNR
   [near+d,far,near-d,near],[near+d,far,near-d*2,near-d]],tf,symbol);
 const rows=snrs(f).filter(x=>x.origin===at(0));
 assert.equal(rows.length,1);const s=rows[0];
 assert.equal(s.confirmed_at,at(5));assert.equal(s.facts.side,'RESISTANCE');
 assert.equal(s.facts.near,near);assert.equal(s.facts.far,far);
 assert.equal(s.facts.lower,near);assert.equal(s.facts.upper,far);
 assert.equal(s.facts.after_kl_delivery,false);
 assert.equal(snrs({...f,as_of:at(4)}).filter(x=>x.origin===at(0)).length,0);
});

test('bullish SNR retains SUPPORT through touch, lower TF breach, equality and wick past far, then breaks on own close',()=>{
 const f=frame([[10,13,9,12],[12,13,10,11],[11,14,10,13],
   [13,14,9,10],[10,13,8,9],[9,16,8,15]],'D1');
 const lower=frame([[15,16,14,15],[15,16,14,15],[15,16,14,15],[13,14,8,9]]);
 const s=snrs(f).find(x=>x.origin===at(0));assert.ok(s);
 assert.deepEqual([s.facts.side,s.facts.near,s.facts.far],['SUPPORT',12,10]);
 const l=contextualLevels([s])[0];
 assert.equal(state(l,f,at(3)).state,'ACTIVE');
 assert.equal(state(l,f,at(4),lower).state,'TESTED');
 assert.equal(state(l,f,at(4),lower).current_role,'support');
 const terminal=state(l,f,at(6),lower);assert.equal(terminal.state,'BROKEN');assert.equal(terminal.invalidated_at,at(5));assert.equal(terminal.current_role,null);
 assert.equal(terminal.reaction?.confirmed_at===at(6),false);
});

test('SNR delivery is a recorded quality flag for an already known level reached by formation',()=>{
 const f=frame([[10,13,9,12],[12,13,10,11],[11,14,9,13]]);
 const kl=pivotLevels(detectFractals(frame([[11,12,10,11],[11,13,9.5,10],[10,12,10,11]]))).find(x=>x.role==='support')!;
 const found=snrs(f,[{...kl,confirmed_at:at(-1)}]).find(x=>x.origin===at(0));assert.ok(found);
 assert.equal(found.facts.after_kl_delivery,true);assert.equal(found.facts.kl_id,kl.id);
 const touch=snrs(f,[{...kl,lower:9,upper:9,confirmed_at:at(-1)}]).find(x=>x.origin===at(0));
 assert.equal(touch?.facts.after_kl_delivery,false);
 const consumed=snrs(f,[{...kl,confirmed_at:at(-2),liquidity_taken_at:at(-1)}]).find(x=>x.origin===at(0));
 assert.equal(consumed?.facts.after_kl_delivery,false);
});

test('raid-backed RB requires first candle to strictly raid, reclaim, then opposite confirming close',()=>{
 const pivot=pivotLevels(detectFractals(frame([[11,12,10.5,11],[11,13,10,11],[11,12,10.5,11]]))).find(x=>x.role==='support')!;
 const kl={...pivot,confirmed_at:at(-1)};
 const bull=[[13,14,9,11],[11,15,10,14]];
 for(const mirrored of [false,true]){
   const rows=mirrored?bull.map(([o,h,l,c])=>[30-o,30-l,30-h,30-c]):bull;
   const level=mirrored?{...kl,role:'resistance' as const,lower:20,upper:20}:kl;
   const found=rbs(frame(rows),[level]);assert.equal(found.length,1);
   assert.equal(found[0].facts.rb_type,'FRACTAL');assert.equal(found[0].facts.level_price,rows[0][3]);
 }
 for(const rows of [[[13,14,10.5,11],[11,15,9,14]],[[13,14,10,11],[11,15,10,14]],[[13,14,9,10],[10,15,9,14]],[[13,14,9,11],[9,12,8,10]]]){
   assert.equal(rbs(frame(rows),[kl]).length,0);
 }
});

test('FVG-backed RB accepts the first close strictly inside the known residual and rejects wick-only contact',()=>{
 const source=frame([[9,10,8,9],[9,14,8,13],[13,14,12,13]]);
 const gap={...detectFvg(source).levels[0],confirmed_at:at(-1)};
 const accepted=rbs(frame([[13,14,10.5,11],[11,13,10.7,12.7]]),[gap]);
 assert.equal(accepted.length,1);assert.equal(accepted[0].facts.rb_type,'FVG');
 assert.equal(accepted[0].facts.level_price,11);
 for(const close of [12,12.3])assert.equal(rbs(frame([[13,14,11,close],[close,14,11,13]]),[gap]).length,0);
 assert.equal(rbs(frame([[13,14,10.5,11],[11,13,10.7,12.7]]),[{...gap,fvg_test_steps:[{at:at(-1),fraction:.8}]}]).length,0);
});

test('a single RB with both sources retains both contexts and is FRACTAL on each evidence row',()=>{
 const prior=frame([[13,14,12,13],[12,14,11.2,13],[13,14,12,13]]);
 const fractal=pivotLevels(detectFractals(prior)).find(l=>l.role==='support')!;
 const gap=detectFvg(frame([[9,10,8,9],[9,14,8,13],[13,14,12,13]])).levels[0];
 const f=frame([[13,14,10.5,11.5],[11.5,14,11,13]]);
 const formations=rbs(f,[fractal,gap].map(l=>({...l,confirmed_at:at(-1)})));
 assert.deepEqual(new Set(formations.map(e=>e.facts.kl_id)),new Set([fractal.id,gap.id]));
 assert.ok(formations.every(e=>e.facts.rb_type==='FRACTAL'&&e.facts.rb_liquidity_id===fractal.id&&e.facts.rb_fvg_id===gap.id));
});

test('FVG partial fill retains the residual, full-depth wick invalidates on first observation, gaps alone do not fill',()=>{
 const f=frame([[9,10,8,9],[9,14,8,13],[13,14,12,13],[13,14,11,13],[13,14,10,13],[13,15,8,14]]);
 const gap=detectFvg(f).levels[0];
 const part=state(gap,f,at(4));assert.equal(part.state,'ACTIVE');assert.equal(part.fill?.state,'PARTIAL');assert.deepEqual(part.fill?.remaining,{lower:10,upper:11});
 const filled=state(gap,f);assert.equal(filled.state,'INVALIDATED');assert.equal(filled.invalidated_at,at(5));assert.equal(filled.fill?.remaining,null);assert.equal(filled.current_role,null);
 const skipped=frame([[9,10,8,9],[9,14,8,13],[13,14,12,13],[8,9,7,8]]);
 const s=state(detectFvg(skipped).levels[0],skipped);assert.equal(s.state,'ACTIVE');assert.equal(s.fill?.state,'UNTOUCHED');
});

test('PA evidence links to the rule describing its confirmation and terminal state',()=>{
 const f=frame([[10,13,9,12],[12,13,10,11],[11,14,10,13]]);
 const s=snrs(f)[0];assert.match(rule(s.rule_id).definition,/optional.*KL|KL.*optional/i);
 const l=contextualLevels([s])[0];
 assert.match(rule(state(l,f).rule_id).definition,/full.*fill.*invalidate/i);
});
