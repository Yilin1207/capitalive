import assert from 'node:assert/strict';
import test from 'node:test';
import {paHttp} from '../lib/pa-engine/http';
import {validatePaBrief} from '../lib/pa-engine/contract';
import {syntheticMarket} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';

for (const symbol of ['NAS100','EU50','EURUSD']) {
  test(`public brief exposes closed thesis inputs for ${symbol}`, async t => {
    const f=syntheticMarket(symbol);
    t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
    const deps={getCandles:async (_:string,tf:Timeframe)=>f.data[tf],
      getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})};
    const response=await paHttp(new Request('https://capitalive.test/api/brief?symbol='+symbol),'brief',deps);
    const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body.error));
    assert.equal(body.grid.requested,'ny');
    assert.equal(body.thesis_inputs?.as_of,body.as_of);
    assert.equal(body.thesis_inputs.strength.window_bars,10);
    const location=body.thesis_inputs.location;
    const priority=['MN1','W1','D1','H4'].find(tf=>location.active_dr[tf])??null;
    assert.equal(location.priority_tf,priority);
    for(const tf of ['MN1','W1','D1','H4']){
      const dr=body.timeframes[tf].dealing_range;
      assert.deepEqual(dr.active_dr,location.active_dr[tf]);
      assert.equal(dr.htf_priority,tf===priority);
    }
    for(const tf of ['D1','W1'])assert.ok(body.thesis_inputs.strength[tf]);
    assert.ok(body.thesis_inputs.location && body.thesis_inputs.execution && body.thesis_inputs.opposite_side);
    assert.equal(body.mode,'PA_ONLY');
    validatePaBrief(body,symbol);
    const idm=body.thesis_inputs.execution.idm.D1;
    const url=new URL(body.links.thesis_idm_d1);
    url.searchParams.set('limit','1');
    const page=await (await paHttp(new Request(url),'evidence',deps)).json();
    assert.equal(page.total,idm.total);
    assert.equal(page.snapshot_sha256,body.snapshot_sha256);
    assert.deepEqual(page.items,idm.items.slice(0,1));
    if(page.links.next) {
      const next=await (await paHttp(new Request(page.links.next),'evidence',deps)).json();
      assert.equal(next.offset,1);
      assert.notEqual(next.items[0].id,page.items[0].id);
    }
    const changed=structuredClone(body);
    changed.thesis_inputs.as_of='2099-01-01T00:00:00.000Z';
    assert.throws(()=>validatePaBrief(changed,symbol),/INVALID_EVIDENCE/);
    changed.thesis_inputs={...body.thesis_inputs,location:{scenario:'short'}};
    assert.throws(()=>validatePaBrief(changed,symbol),/INVALID_EVIDENCE/);
  });
}

test('an unverified quote withholds thesis inputs from the public brief', async t=>{
  const f=syntheticMarket('EURUSD');
  t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
  const deps={getCandles:async(_:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({
    ...f.quote,quote_time:null,provider_timestamp:null,fresh:false,cache_hit:false,evaluated_at:f.asOf})};
  const response=await paHttp(new Request('https://capitalive.test/api/brief?symbol=EURUSD'),'brief',deps);
  const b=await response.json();
  assert.equal(b.status,'STALE');
  assert.equal(b.thesis_inputs,null);
  validatePaBrief(b,'EURUSD');
});
