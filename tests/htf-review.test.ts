import test from 'node:test';
import assert from 'node:assert/strict';
import annotations from './fixtures/htf-review-annotations.json';
import {reviewScenario} from './htf-review-scenarios';
import {detectIndependentSNR} from '../lib/htf-snr';
import {analyzeSeries} from '../lib/technical-analysis';
import type {Timeframe} from '../lib/candle-data';
for(const a of annotations.cases)test(`predeclared synthetic expectation: ${a.id}`,()=>{
  const input=reviewScenario(a.pattern,a.timeframe as Timeframe),audit=detectIndependentSNR(input,'NAS100');
  const z=audit.zones.find(z=>z.origin.price===a.focus_price)!;assert.ok(z);
  for(const state of a.states)assert.ok(z.evidence.events.some(e=>e.state===state),state);
  for(const state of a.forbidden??[])assert.ok(!z.evidence.events.some(e=>e.state===state),state);
  if(a.status)assert.equal(z.status,a.status);
  if(a.role)assert.equal(z.role,a.role);
  if(a.minimum_tests!==undefined)assert.ok(z.test_count>=a.minimum_tests);
  if(a.maximum_tests!==undefined)assert.ok(z.test_count<=a.maximum_tests);
  if(a.minimum_reactions!==undefined)assert.ok(z.reaction_count>=a.minimum_reactions);
  if(a.maximum_reactions!==undefined)assert.ok(z.reaction_count<=a.maximum_reactions);
  if(a.id==='monthly_snr_without_fvg')assert.equal(analyzeSeries(input,'NAS100').fvgs.length,0);
  if(a.overlap_timeframes)for(const tf of a.overlap_timeframes){
    const other=detectIndependentSNR(reviewScenario(a.pattern,tf as Timeframe),'NAS100');
    assert.ok(other.zones.some(p=>p.origin.price===100&&p.status==='tested'));
  }
});
