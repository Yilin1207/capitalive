import test from 'node:test';
import assert from 'node:assert/strict';
import {atrD1,nestedIn} from '../lib/pa-engine/brief-facts';
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
