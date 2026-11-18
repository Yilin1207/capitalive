import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOhlc} from '../lib/pa-engine/coverage';
import {syntheticMarket} from './fixtures/jp225-synthetic';

test('D1 arithmetic, incomplete inputs and wrong extrema are distinguished for each side',()=>{
 const {data}=syntheticMarket('EU50');
 const day='2026-11-10T00:00:00.000Z', cutoff='2026-11-11T00:00:00.000Z';
 const prices=(bid:number)=>({bid,ask:bid+1});
 const bars=Array.from({length:6},(_,i)=>({time:new Date(Date.parse(day)+i*14400000).toISOString(),is_closed:true,open:prices(10+i),close:prices(11+i),low:prices(9+i),high:prices(12+i)}));
 data.H4.candles=bars;data.D1.candles=[{...bars[0],high:prices(17),close:prices(16)}];
 for(const side of ['bid','ask'] as const)assert.equal(reconcileOhlc(data,'D1',side,cutoff)?.matched,1);
 data.D1.candles[0].high.ask=19;
 assert.deepEqual(reconcileOhlc(data,'D1','ask',cutoff)?.mismatches,[day]);
 bars.splice(2,1);
 assert.deepEqual(reconcileOhlc(data,'D1','bid',cutoff)?.incomplete,[day]);
 assert.equal(reconcileOhlc(data,'D1','bid',day)?.incomplete.length,0);
});
