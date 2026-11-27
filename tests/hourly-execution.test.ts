import test from 'node:test';
import assert from 'node:assert/strict';
import type {Candle,CandleResponse} from '../lib/candle-data';
import {buildPaEngine} from '../lib/pa-engine/core';
import {freshHourlyStatus,hourlyExecution} from '../lib/pa-engine/hourly-execution';
import {syntheticMarket} from './fixtures/jp225-synthetic';

const hour=3600000;
const end=Date.parse('2026-11-27T06:00:00Z');
const iso=(hoursAgo:number)=>new Date(end-hoursAgo*hour).toISOString();
function candle(hoursAgo:number,low:number,high:number,close=100):Candle {
 const both=(v:number)=>({bid:v,ask:v});
 return {time:iso(hoursAgo),open:both(close),high:both(high),low:both(low),close:both(close),is_closed:true};
}
function market(){
 const {data}=syntheticMarket('NAS100');
 for(const d of Object.values(data))d.fetched_at=iso(0);
 // Each boundary has a closed right neighbour. Later flat bars cannot form new fractals.
 data.H4.candles=Array.from({length:20},(_,i)=>candle((20-i)*4,i===2?80:90,i===4?120:110));
 return data;
}
function evaluate(data:ReturnType<typeof market>,candles:Candle[]){
 const h1:CandleResponse={...data.H4,timeframe:'H1',candles};
 const result=hourlyExecution(h1,buildPaEngine(data,'bid'));
 assert.ok('idm_in_h4' in result && result.idm_in_h4);
 return result;
}

test('raided pivots cannot displace an untouched IDM even when more than twelve are nearer EQ',()=>{
 const hours=Array.from({length:40},(_,i)=>candle(40-i,i===36?94:95,i%2===1?101+i/10:101));
 const h=evaluate(market(),hours),idm=h.idm_in_h4;
 assert.equal(h.h4_range?.eq,100);
 assert.ok(idm.items.some(p=>p.price===94));
 assert.ok(idm.items.every(p=>p.first_observed_raid_at===null));
 assert.ok(idm.consumed_total>12);
 assert.equal(idm.total,idm.items.length+idm.omitted);
});

for(const polarity of ['high','low'] as const)test('current pullback after the H4 '+polarity+' uses the actual pivot hour',()=>{
 const data=market(),high=polarity==='high';
 data.H4.candles[18]=candle(8,high?90:75,high?125:110);
 const hours=Array.from({length:12},(_,i)=>{
  const ago=12-i;
  return candle(ago,high?(ago===10?91:ago===6?94:95):(ago===7?75:95),
   high?(ago===7?125:105):(ago===10?109:ago===6?106:105));
 });
 const h=evaluate(data,hours);
 assert.equal(h.idm_in_h4.pullback_extreme?.polarity,polarity);
 assert.equal(h.idm_in_h4.pullback_extreme?.after_from,iso(6));
 assert.equal(h.idm_in_h4.items.some(p=>p.pivot_at===iso(10)),false);
 assert.ok(h.idm_in_h4.items.some(p=>p.pivot_at===iso(6)&&p.formed_after_dr_extreme));
 assert.equal(h.fractals.find(p=>p.pivot_at===iso(10))?.formed_after_dr_extreme,false);
 // A close outside the range supplies no side for the current pullback.
 hours[11]=high?candle(1,95,130,128):candle(1,69,105,70);
 const ambiguous=evaluate(data,hours);
 assert.equal(ambiguous.idm_in_h4.pullback_side_known,false);
 assert.ok(ambiguous.idm_in_h4.items.some(p=>p.pivot_at===iso(10)&&!p.formed_after_dr_extreme));
});

test('closed hourly data distinguishes warnings, clean observations, delay and no data',()=>{
 assert.equal(freshHourlyStatus([]),'OK');
 assert.equal(freshHourlyStatus(['SESSION_COVERAGE_NOT_INDEPENDENTLY_VERIFIED']),'PARTIAL');
 const data=market(),core=buildPaEngine(data,'bid');
 const run=(candles:Candle[])=>hourlyExecution({...data.H4,timeframe:'H1',candles},core);
 assert.equal(run([candle(1,95,105)]).status,'PARTIAL');
 assert.equal(run([candle(4,95,105)]).status,'STALE');
 assert.equal(run([]).status,'UNAVAILABLE');
});

test('H1 close locates price against H4 including both boundaries, independently of the wick',()=>{
 const data=market();
 for(const [close,position] of [[121,'ABOVE_HIGH'],[120,'INSIDE'],[100,'INSIDE'],[80,'INSIDE'],[79,'BELOW_LOW']] as const){
  const h=evaluate(data,[candle(1,70,130,close)]);
  assert.equal(h.price_vs_h4_range,position);
 }
 data.H4.candles=[];
 assert.equal(evaluate(data,[candle(1,90,110)]).price_vs_h4_range,null);
});
