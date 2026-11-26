import assert from 'node:assert/strict';
import test from 'node:test';
import type {PaEngine,PaEvidence} from '../lib/pa-engine/core';
import type {Bar} from '../lib/knowledge/data';
import type {Timeframe} from '../lib/candle-data';
import {eventItems, thesisObservations} from '../lib/pa-engine/thesis-observations';

const day = (i:number) => new Date(Date.UTC(2025,0,1+i)).toISOString();
const candle = (i:number, close=100+i):Bar => ({index:i,time:day(i),end:day(i+1),open:close-1,high:close+2,low:close-2,close,segment:0});
const bars = Array.from({length:20},(_,i)=>candle(i));
function finding(id:string, kind:string, at:number, facts:Record<string,unknown>, indices:number[], bounds?:{lower:number;upper:number}, tf:Timeframe='D1') {
  return {id,kind,timeframe:tf,confirmed_at:day(at),origin:day(indices[0]),formation_status:'CONFIRMED',facts,bounds,
    formation_role:facts.polarity==='high'||facts.direction==='bearish'?'resistance':'support',
    candle_evidence:indices.map(i=>({...bars[i],closed_at:bars[i].end})),
    lifecycle:{state:'ACTIVE',continuity_end:day(20),invalidated_at:null,first_raid:null,coverage:'COMPLETE_OBSERVED_INTERVAL'}
  } as unknown as PaEvidence;
}
const fixture = (evidence:PaEvidence[]=[], daily=bars) => ({
  as_of:day(20),evaluated_through:day(20),evidence,frames:{D1:{ohlc:daily},W1:{ohlc:[]},MN1:{ohlc:[]},H4:{ohlc:[candle(19)]}},dealing_ranges:[]
}) as unknown as PaEngine;

test('D1 strength uses closed bars, complete five-bar blocks and confirmation dates',()=>{
  const fvg=(id:string,at:number,direction:string)=>finding(id,'FVG',at,{direction},[at-3,at-2,at-1]);
  const pivot=finding('swing','FRACTAL',17,{variant:3,polarity:'low',price:110,pivot_time:day(15)},[14,15,16],{lower:110,upper:110});
  const core=fixture([pivot,fvg('up',16,'bullish'),fvg('down',20,'bearish'),fvg('old',10,'bearish')]);
  const result=thesisObservations(core);
  const s=result.strength.D1;
  assert.equal(result.strength.thresholds,'NEEDS_SPECIFICATION');
  assert.deepEqual(s.new_fvg_count,{bullish:1,bearish:1,with_move:1,against_move:1});
  assert.deepEqual(s.avg_body_atr,{last5:0.25,prev5:0.25});
  assert.equal(s.overlap_ratio,0);
  assert.equal(s.fractals_formed,1);
  assert.equal(s.bars_without_correction,19);
  assert.equal(s.move_atr,2.25);
  assert.equal(thesisObservations(core,3).strength.D1.new_fvg_count.bullish,0);
  const split=fixture([],bars.map((b,i)=>({...b,segment:i<17?0:1})));
  assert.equal(thesisObservations(split).strength.D1.bars_without_correction,2);
  assert.equal(thesisObservations(split).strength.D1.avg_body_atr.last5,null);
});

test('events retain the invalidating close, then stop, and require an observed intersection',()=>{
  const level=finding('level','SNR_CLOSED_BREAK',9,{proposed_role:'support'},[3,4,7,8],{lower:107,upper:107});
  level.lifecycle!.invalidated_at=day(14);
  level.lifecycle!.state='INVALIDATED';
  const daily=[...bars];
  daily[13]={...candle(13,106),high:112,low:105};
  daily[14]={...candle(14,110),high:111,low:106};
  daily[15]={...candle(15,104),high:105,low:103};
  const events=thesisObservations(fixture([level],daily)).opposite_side.D1.kl_events;
  assert.ok(events.items.some(e=>e.id==='level'&&e.at===day(14)&&e.type==='ACCEPTANCE'));
  assert.ok(events.items.every(e=>e.at<=day(14)));
  level.lifecycle!.invalidated_at=null;
  assert.ok(!thesisObservations(fixture([level],daily)).opposite_side.D1.kl_events.items.some(e=>e.at===day(16)));
});

test('strong fractal ties the actual pivot candle, prior same-polarity fractal and confirming VC',()=>{
  const prior=finding('prior','FRACTAL',7,{variant:3,polarity:'low',price:102,pivot_time:day(5)},[4,5,6],{lower:102,upper:102});
  const pivot=finding('pivot','FRACTAL',14,{variant:3,polarity:'low',price:101,pivot_time:day(12)},[11,12,13],{lower:101,upper:101});
  const raid=(i:number)=>finding('raid','RAID',i+1,{pivot_id:'prior',polarity:'low',price:102},[i]);
  const rb=finding('rb','RB_TWO_CANDLE',14,{rb_type:'FRACTAL',direction:'bullish',kl_id:'prior',rb_liquidity_id:'prior'},[12,13],{lower:105,upper:105});
  const near=(...e:PaEvidence[])=>thesisObservations(fixture([prior,pivot,...e])).opposite_side.strong_near_price.items;
  const result=near(raid(12),rb);
  assert.equal(result.length,1);
  assert.equal(result[0].strong,true);
  assert.equal(result[0].id,'pivot');
  assert.equal(result[0].distance,18);
  assert.deepEqual(result[0].evidence_ids,['pivot','prior','raid','rb']);
  assert.equal(near(raid(11),rb).length,0);
  const unrelated=finding('other','RB_TWO_CANDLE',19,{rb_type:'FRACTAL',direction:'bullish',kl_id:'prior',rb_liquidity_id:'prior'},[17,18],{lower:105,upper:105});
  assert.equal(near(raid(12),unrelated).length,0);
});

test('a D1 low testing monthly SNR in discount is strong only with a range known at the test',()=>{
  const monthly=finding('monthly-zone','SNR_CLOSED_BREAK',5,{side:'SUPPORT',proposed_role:'support'},[0,1,3,4],{lower:97,upper:102},'MN1');
  const swing=(id:string,polarity:string,price:number,at:number)=>({id,price,polarity,segment:0,confirmed_at:day(at),origin:day(at-2)});
  const low=finding('low','FRACTAL',15,{variant:3,polarity:'low',price:100,pivot_time:day(13)},[12,13,14],{lower:100,upper:100});
  low.candle_evidence[1]={...low.candle_evidence[1],open:115,high:118,low:100,close:110};
  const daily=[...bars]; daily[13]={...daily[13],open:115,high:118,low:100,close:110};
  function measure(highConfirmation:number) {
    const core=fixture([monthly,low],daily);
    core.frames.MN1.ohlc=[candle(4),candle(7)];
    core.market_structure={MN1:{swing_sequence:[swing('range-high','high',150,highConfirmation),swing('range-low','low',80,5)]}} as unknown as PaEngine['market_structure'];
    return thesisObservations(core).opposite_side;
  }
  const result=measure(8);
  assert.equal(result.D1.new_fractal3.items[0].strong,true);
  assert.equal(result.strong_near_price.items[0].id,'low');
  assert.equal(result.strong_near_price.items[0].price,100);
  assert.deepEqual(result.strong_near_price.items[0].evidence_ids,['low','monthly-zone','range-low','range-high']);
  assert.equal(measure(16).strong_near_price.total,0);
  monthly.lifecycle!.invalidated_at=day(13);
  assert.equal(measure(8).strong_near_price.total,0);
});

test('directional monthly alternative mirrors resistance in premium and declines a candle far above it',()=>{
  const monthly=finding('monthly-supply','SNR_CLOSED_BREAK',5,{side:'RESISTANCE',proposed_role:'resistance'},[0,1,3,4],{lower:122,upper:127},'MN1');
  const high=finding('high','FRACTAL',15,{variant:3,polarity:'high',price:125,pivot_time:day(13)},[12,13,14],{lower:125,upper:125});
  high.candle_evidence[1]={...high.candle_evidence[1],open:116,low:115,high:125,close:119};
  const daily=[...bars]; daily[13]={...daily[13],open:116,low:115,high:125,close:119};
  const core=fixture([monthly,high],daily);
  core.frames.MN1.ohlc=[candle(4),candle(7)];
  core.market_structure={MN1:{swing_sequence:[{id:'range-high',polarity:'high',price:150,segment:0,confirmed_at:day(8)},{id:'range-low',polarity:'low',price:80,segment:0,confirmed_at:day(5)}]}} as unknown as PaEngine['market_structure'];
  assert.equal(thesisObservations(core).opposite_side.strong_near_price.items[0]?.reason,'TESTED_MONTHLY_SNR_IN_PREMIUM');
  high.facts.price=130;daily[13].high=130;high.candle_evidence[1].high=130;
  assert.equal(thesisObservations(core).opposite_side.strong_near_price.total,0);
});

test('a historical FVG event uses the remaining bounds at the open and reports SNR side and KL delivery',()=>{
  const gap=finding('gap','FVG',5,{direction:'bullish'},[2,3,4],{lower:100,upper:110});
  const snr=finding('snr','SNR_CLOSED_BREAK',20,{side:'SUPPORT',proposed_role:'support',after_kl_delivery:true,kl_id:'gap'},[7,8,11,19],{lower:111,upper:112});
  const daily=bars.map((_,i)=>({...candle(i,115),high:117,low:112}));
  daily[11]={...candle(11,114),high:117,low:107};
  daily[12]={...candle(12,116),high:119,low:108}; // already-traded part only
  daily[13]={...candle(13,109),high:117,low:106};
  const rows=thesisObservations(fixture([gap,snr],daily)).opposite_side.D1;
  assert.ok(rows.kl_events.items.some(e=>e.at===day(14) && e.upper===107 && e.type==='REJECTION'));
  assert.ok(!rows.kl_events.items.some(e=>e.at===day(13)));
  assert.equal(rows.new_snr.items[0].side,'SUPPORT');
  assert.equal(rows.new_snr.items[0].after_kl_delivery,true);
});

test('an SNR can form from the actual raiding pivot without a KL delivery',()=>{
  const prior=finding('prior','FRACTAL',7,{variant:3,polarity:'low',price:102,pivot_time:day(5)},[4,5,6],{lower:102,upper:102});
  const pivot=finding('pivot','FRACTAL',14,{variant:3,polarity:'low',price:101,pivot_time:day(12)},[11,12,13],{lower:101,upper:101});
  const raid=finding('raid','RAID',13,{pivot_id:'prior',polarity:'low'},[12]);
  const snr=finding('snr','SNR_CLOSED_BREAK',19,{side:'SUPPORT',proposed_role:'support',after_kl_delivery:false,formation:{delivery_at:null}},[12,13,18],{lower:105,upper:106});
  assert.equal(thesisObservations(fixture([prior,pivot,raid,snr])).opposite_side.strong_near_price.items[0]?.reason,'RAID_THEN_SNR');
});


test('the detail list retains every item in brief order, with the strong pivot polarity',()=>{
  const pivots=Array.from({length:7},(_,i)=>finding('low-'+i,'FRACTAL',13+i,{variant:3,polarity:'low',price:100+i,pivot_time:day(11+i)},[10+i,11+i,12+i],{lower:100+i,upper:100+i}));
  const core=fixture(pivots), short=thesisObservations(core).opposite_side.D1.new_fractal3;
  const full=eventItems(core,'D1','new_fractal3');
  assert.equal(short.total,7);
  assert.equal(short.items.length,3);
  assert.equal(full.length,7);
  assert.deepEqual(full.slice(0,3),short.items);
  assert.equal(eventItems(core,'W1','new_fractal3').length,0);
});

test('an inside close retains its approach side until acceptance or rejection',()=>{
  const s=finding('supply','SNR_CLOSED_BREAK',10,{side:'RESISTANCE',proposed_role:'resistance',direction:'bearish'},[5,6,7,9],{lower:110,upper:114});
  const daily=bars.map((_,i)=>candle(i,108));
  daily[15]={...candle(15,112),low:108,high:113};
  daily[16]={...candle(16,107),low:106,high:113};
  daily[17]={...candle(17,113),low:108,high:114};
  daily[18]={...candle(18,117),low:115,high:118}; // gap out after a confirmed inside close
  s.lifecycle!.invalidated_at=day(19);
  const events=eventItems(fixture([s],daily),'D1','kl_events');
  assert.ok(events.some(e=>e.at===day(17) && 'type' in e && e.type==='REJECTION'));
  assert.ok(events.some(e=>e.at===day(19) && 'type' in e && e.type==='ACCEPTANCE'));
  assert.ok(events.every(e=>e.at<=day(19)));
});

test('without a previous outside close the zone role supplies the approach side; equality never raids a point',()=>{
  const zone=finding('demand','SNR_CLOSED_BREAK',15,{side:'SUPPORT',proposed_role:'support'},[10,11,12,14],{lower:108,upper:114});
  const point=finding('point','FRACTAL',15,{variant:3,polarity:'low',price:108,pivot_time:day(13)},[12,13,14],{lower:108,upper:108});
  const daily=bars.map((_,i)=>candle(i,110));
  daily[15]={...candle(15,108),low:108,high:112};
  daily[16]={...candle(16,110),low:108,high:113};
  daily[17]={...candle(17,106),low:105,high:113};
  const events=eventItems(fixture([zone,point],daily),'D1','kl_events');
  assert.ok(events.some(e=>e.id==='demand' && e.at===day(18) && 'type' in e && e.type==='ACCEPTANCE'));
  assert.ok(events.some(e=>e.id==='point' && e.at===day(17) && 'type' in e && e.type==='TOUCH'));
});

test('RB observations count one formation witnessed at multiple key levels',()=>{
  const rb=(id:string,kl_id:string)=>finding(id,'RB_TWO_CANDLE',19,{rb_type:'FRACTAL',kl_id,direction:'bullish'},[17,18],{lower:105,upper:105});
  const rows=thesisObservations(fixture([rb('proof-b','level-b'),rb('proof-a','level-a')])).opposite_side.D1.new_rb;
  assert.equal(rows.total,1);assert.equal(rows.items[0].id,'proof-a');
  assert.equal(rows.items[0].context_count,2);
});
