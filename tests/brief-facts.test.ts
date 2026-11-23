import test from 'node:test';
import assert from 'node:assert/strict';
import {atrD1,classifyKlEvent,klEvents,nestedIn,premiumDiscount} from '../lib/pa-engine/brief-facts';
import {buildPaEngine} from '../lib/pa-engine/core';
import {paHttp} from '../lib/pa-engine/http';
import {PA_TFS} from '../lib/pa-engine/report';
import {syntheticMarket} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';

type Core=Parameters<typeof nestedIn>[0];
const fixture=(symbol='NAS100')=>{const f=syntheticMarket(symbol);return {...f,deps:{getCandles:async(_s:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})}};};
const brief=async(f:ReturnType<typeof fixture>,q='')=>(await paHttp(new Request(`https://capitalive.test/api/brief?symbol=${f.data.H4.symbol}${q}`),'brief',f.deps)).json();
const zone=(id:string,kind:string,lower:number,upper:number,state='ACTIVE',fill?:{state:string;max_observed_fraction:number})=>({id,kind,timeframe:id.split(':')[1],bounds:{lower,upper},remaining_bounds:{lower,upper},lifecycle:{state,...(fill?{fill}:{})}});

test('atr_d1: mean true range of the last 14 closed D1 bars, a distance unit only',()=>{
 const f=fixture(),core=buildPaEngine(f.data,'bid'),bars=core.frames.D1.ohlc,atr=atrD1(core)!;
 const tr=bars.slice(-14).map((b,i)=>{const p=bars[bars.length-15+i].close;return Math.max(b.high-b.low,Math.abs(b.high-p),Math.abs(b.low-p));});
 assert.ok(Math.abs(atr.value-tr.reduce((a,b)=>a+b,0)/14)<1e-9);assert.equal(atr.period,14);assert.equal(atr.use,'DISTANCE_UNIT_ONLY_NOT_A_THRESHOLD');
 assert.equal(atrD1({frames:{...core.frames,D1:{...core.frames.D1,ohlc:bars.slice(0,14)}}}),null);
});

test('nested_in: only live higher-TF zones that fully contain the level',()=>{
 const evidence=[zone('X:D1:bid:FVG:a','FVG',100,120,'ACTIVE',{state:'PARTIAL',max_observed_fraction:0.3}),zone('X:W1:bid:RB_TWO_CANDLE:b','RB_TWO_CANDLE',90,130),
  zone('X:D1:bid:FVG:filled','FVG',100,120,'ACTIVE',{state:'FILLED',max_observed_fraction:1}),zone('X:D1:bid:SNR_CLOSED_BREAK:inv','SNR_CLOSED_BREAK',95,125,'INVALIDATED'),
  zone('X:H4:bid:FVG:same','FVG',100,120,'ACTIVE',{state:'UNTOUCHED',max_observed_fraction:0}),zone('X:D1:bid:FVG:partial-overlap','FVG',111,140,'ACTIVE',{state:'UNTOUCHED',max_observed_fraction:0})];
 const core={evidence} as unknown as Core;
 assert.deepEqual(nestedIn(core,'H4',{lower:105,upper:112}),['X:W1:bid:RB_TWO_CANDLE:b','X:D1:bid:FVG:a']);
 assert.deepEqual(nestedIn(core,'D1',{lower:105,upper:112}),['X:W1:bid:RB_TWO_CANDLE:b']);
 assert.deepEqual(nestedIn(core,'H4',{lower:85,upper:86}),[]);
});

test('brief levels carry distance_atr_d1 and nested_in; sorting stays by distance',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const b=await brief(f);assert.ok(b.atr_d1.value>0);
 let n=0;
 for(const tf of PA_TFS)for(const k of ['above','below','at_price']){let prev=-1;
  for(const x of b.timeframes[tf].levels[k]){n++;assert.ok(Math.abs(x.distance_atr_d1-x.distance/b.atr_d1.value)<1e-4);assert.ok(Array.isArray(x.nested_in));assert.ok(x.distance>=prev);prev=x.distance;
   for(const id of x.nested_in)assert.ok(PA_TFS.indexOf(id.split(':')[1])<PA_TFS.indexOf(tf));}}
 assert.ok(n>0);assert.equal(b.selection_policy.levels,'NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE');
});

test('premium_discount: position of the last closed H4 close in the current DR of each TF',async t=>{
 const dr=(status:string,explicit?:unknown)=>({status,current:{lower:100,upper:200,equilibrium:150},...(explicit?{explicit_range:explicit}:{})});
 const at=(p:number,s='ESTABLISHED')=>premiumDiscount(dr(s),p)!;
 assert.deepEqual([at(175).zone,at(125).zone,at(150).zone,at(250).zone,at(50).zone],['PREMIUM','DISCOUNT','EQ','ABOVE_RANGE','BELOW_RANGE']);
 assert.equal(at(125).price_position_pct,25);assert.equal(at(250).price_position_pct,150);assert.equal(at(125).distance_to_high,75);assert.equal(at(125).distance_to_low,25);
 assert.equal(at(125).confirmed,true);assert.equal(at(125).selection,'AUTOMATIC_CANDIDATE');assert.equal(at(125,'AWAITING_NEW_EXTREME').confirmed,false);
 assert.equal(premiumDiscount(dr('ESTABLISHED',{high_id:'a',low_id:'b'}),125)!.selection,'EXPLICIT_IDS');
 assert.equal(premiumDiscount({status:'AWAITING_CONFIRMED_PAIR',current:null},125),null);
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const b=await brief(f);let seen=0;
 for(const tf of PA_TFS){const d=b.timeframes[tf].dealing_range;if(!d.current){assert.equal(d.premium_discount,null);continue;}seen++;
  const p=d.premium_discount;assert.equal(p.high,d.current.upper);assert.equal(p.low,d.current.lower);assert.equal(p.eq,d.current.equilibrium);assert.equal(p.price,b.reference.price);
  assert.ok(Math.abs(p.price_position_pct-(b.reference.price-p.low)/(p.high-p.low)*100)<0.01);}
 assert.ok(seen>0);
});

test('kl events: touch, rejection, acceptance and raid by closed candles only',async t=>{
 const bar=(high:number,low:number,close:number)=>({high,low,close});
 // Zone 100..110 approached from below (previous close 95).
 assert.equal(classifyKlEvent(95,bar(99,94,98),100,110),null);// no contact
 assert.equal(classifyKlEvent(95,bar(104,94,103),100,110),'TOUCH');// closed inside
 assert.equal(classifyKlEvent(95,bar(112,94,97),100,110),'REJECTION');// closed back below the near edge, even after a wick through
 assert.equal(classifyKlEvent(95,bar(115,94,111),100,110),'ACCEPTANCE');// closed beyond the far edge
 assert.equal(classifyKlEvent(95,bar(100,94,96),100,110),'REJECTION');// equality reaches the zone
 // From above (previous close 115).
 assert.equal(classifyKlEvent(115,bar(116,108,113),100,110),'REJECTION');assert.equal(classifyKlEvent(115,bar(116,95,99),100,110),'ACCEPTANCE');
 assert.equal(classifyKlEvent(105,bar(116,95,99),100,110),null);// previous close inside: not an approach
 // Fractal high at 100 approached from below; fractal low at 100 from above.
 assert.equal(classifyKlEvent(95,bar(100,94,98),100,100),'TOUCH');assert.equal(classifyKlEvent(95,bar(101,94,99),100,100),'RAID');
 assert.equal(classifyKlEvent(95,bar(103,94,101),100,100),'ACCEPTANCE');assert.equal(classifyKlEvent(105,bar(106,99,101),100,100),'RAID');
 // Candle colour is not a criterion: same OHLC extremes, different open, same class.
 assert.equal(classifyKlEvent(95,{...bar(112,94,97),open:96} as never,100,110),classifyKlEvent(95,{...bar(112,94,97),open:111} as never,100,110));
 // Engine: events start after the formation closed and use closed bars of the level TF and lower TFs.
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const core=buildPaEngine(f.data,'bid'),b=await brief(f);let checked=0;
 for(const tf of PA_TFS)for(const k of ['above','below','at_price'])for(const x of b.timeframes[tf].levels[k]){
  const ev=x.kl_events,e=core.evidence.find(y=>y.id===x.id)!;assert.deepEqual(ev,klEvents(core,x));
  assert.ok(ev!.last.length<=3);for(const y of ev!.last){assert.ok(y.at>e.confirmed_at&&y.at<=b.as_of);assert.ok(PA_TFS.indexOf(y.tf)>=PA_TFS.indexOf(tf));}
  checked++;}
 assert.ok(checked>0);
});
