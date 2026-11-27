import test from 'node:test';
import assert from 'node:assert/strict';
import type {Candle,CandleResponse} from '../lib/candle-data';
import {buildPaEngine} from '../lib/pa-engine/core';
import {hourlyExecution} from '../lib/pa-engine/hourly-execution';
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
