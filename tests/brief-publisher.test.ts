import test from 'node:test';
import assert from 'node:assert/strict';
import {paHttp} from '../lib/pa-engine/http';
import {syntheticMarket} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';
// @ts-expect-error plain ESM script shipped to the public snapshot repository
import {checkBatch,filesFor,SYMBOLS} from '../ops/brief-publisher/publish.mjs';

async function batch(failing?:string){
 const per=Object.fromEntries(['NAS100','EU50','EURUSD'].map(s=>[s,syntheticMarket(s)]));
 const deps={getCandles:async(s:string,tf:Timeframe)=>{if(s===failing)throw Object.assign(Error('down'),{code:'CAPITAL_UPSTREAM'});return per[s].data[tf];},getAnalysisQuote:async(s:string)=>({...per[s].quote,cache_hit:false,evaluated_at:per[s].asOf})};
 return (await paHttp(new Request(`https://capitalive.test/api/brief?symbols=${SYMBOLS.join(',')}&latest=12`),'brief',deps)).json();
}

test('publisher accepts the real batch and rejects trading fields, secrets, enabled trading and oversize assets',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(syntheticMarket('NAS100').asOf)});
 const b=await batch();checkBatch(b);
 const bad:[string,(x:any)=>void,RegExp][]=[
  ['schema',x=>{x.schema_version='pa-brief-v1';},/NOT_A_PA_BRIEF_BATCH/],
  ['trading',x=>{x.trading_enabled=true;},/NOT_A_PA_BRIEF_BATCH/],
  ['asset trading',x=>{x.briefs.EU50.trading_enabled=true;},/TRADING_ENABLED/],
  ['entry',x=>{x.briefs.NAS100.timeframes.H4.entry=1;},/FORBIDDEN_KEY/],
  ['take profit',x=>{x.briefs.NAS100.quote.take_profit=1;},/FORBIDDEN_KEY/],
  ['account',x=>{x.account={balance:1};},/FORBIDDEN_KEY/],
  ['secret',x=>{x.briefs.NAS100.warnings.push('github_pat_abc');},/SECRET_PATTERN/],
  ['size',x=>{x.briefs.EURUSD.warnings.push('X'.repeat(200_001));},/ASSET_TOO_LARGE/],
 ];
 for(const [name,mutate,err] of bad){const x=structuredClone(b);mutate(x);assert.throws(()=>checkBatch(x),err,name);}
 const files=filesFor(b,'2026-11-15T14:07:00.000Z');
 assert.deepEqual(Object.keys(files).sort(),['brief/EU50.json','brief/EURUSD.json','brief/NAS100.json','brief/latest.json','brief/status.json']);
 assert.equal(files['brief/NAS100.json'].brief.symbol,'NAS100');assert.equal(files['brief/status.json'].ok,true);
 const timed=filesFor(b,'2026-11-15T14:07:30.000Z','2026-11-15T14:07:00.000Z');
 assert.equal(timed['brief/status.json'].requested_at,'2026-11-15T14:07:00.000Z');assert.ok(timed['brief/status.json'].published_at>=b.generated_at);
});

test('publisher keeps a failed symbol visible and never writes an older brief for it',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(syntheticMarket('NAS100').asOf)});
 const b=await batch('EU50');checkBatch(b);
 const files=filesFor(b,'2026-11-15T14:07:00.000Z');
 assert.ok(!('brief/EU50.json' in files));assert.equal(files['brief/latest.json'].results.EU50.http_status,503);
 assert.equal(files['brief/status.json'].results.EU50.error,'UPSTREAM_OR_EVIDENCE_UNAVAILABLE');
});
