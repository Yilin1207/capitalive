import test from 'node:test';
import assert from 'node:assert/strict';
import {paHttp} from '../lib/pa-engine/http';
import {validatePaReport} from '../lib/pa-engine/contract';
import {buildPaEngine} from '../lib/pa-engine/core';
import {jp225Synthetic} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';

// Synthetic contract transport, explicitly not an independent broker price check.
function fixture(symbol='JP225'){
 const f=jp225Synthetic();for(const tf of ['MN1','W1','D1','H4'] as const)f.data[tf].symbol=symbol;
 const deps={getCandles:async(_symbol:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})};
 return {...f,deps};
}
const url=(query:string)=>new Request('https://local/api/desk-report?'+query);
const forbiddenKeys=new Set(['narrative','narrative_method','candidate_narrative','confirmed_narrative','scenario','entry','entry_stop','rr','verdict','target_selection','probability']);
function noForecast(value:unknown){if(Array.isArray(value))value.forEach(noForecast);else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){assert.ok(!forbiddenKeys.has(k),k);noForecast(v);}}

test('V6 HTTP all three symbols and Bid/Ask return bounded evidence contracts without automatic forecasts',async t=>{
 const first=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(first.asOf)});
 for(const symbol of ['EURUSD','NAS100','JP225'])for(const side of ['bid','ask']){
  const f=fixture(symbol),res=await paHttp(url(`symbol=${symbol}&side=${side}`),'report',f.deps),raw=await res.text(),r=JSON.parse(raw);
  assert.equal(res.status,200);assert.match(res.headers.get('content-type')! ,/application\/json/);assert.equal(res.headers.get('x-desk-contract'),'pa-engine-v6.1');assert.match(res.headers.get('cache-control')!,/no-store/);
  validatePaReport(r,symbol);assert.ok(Buffer.byteLength(raw)<=65536);assert.equal(r.mode,'PA_ONLY');assert.equal(r.quote.fresh,true);assert.equal(r.coverage.observations_available,true);assert.ok(r.evidence.length>0);noForecast(r);
  assert.equal(r.coverage.findings_included+r.omitted.evidence,r.coverage.findings_total);assert.equal(r.coverage.history_complete,false);
 }
});

test('V6 exact Evidence ID returns full formation and causal interactions; snapshot revisions reject mixing',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const expected=buildPaEngine(f.data,'bid'),e=expected.evidence.find(x=>x.kind==='FRACTAL')!;
 const first=await paHttp(url('symbol=JP225&limit=2'),'evidence',f.deps),page=await first.json();assert.equal(first.status,200);assert.ok(page.omitted>0);
 const detail=await paHttp(url(`symbol=JP225&id=${encodeURIComponent(e.id)}&snapshot_sha256=${page.snapshot_sha256}`),'evidence',f.deps),r=await detail.json();assert.equal(detail.status,200);assert.equal(r.evidence.length,1);assert.deepEqual(r.evidence[0],e);assert.equal(r.complete,true);
 for(const c of r.evidence[0].candle_evidence)assert.ok(c.closed_at<=e.confirmed_at&&e.confirmed_at<=r.as_of);
 for(const x of r.interaction_history)assert.ok(x.time>=e.confirmed_at&&x.confirmed_at<=expected.evaluated_through);
 const h=f.data.H4.candles[0];h.high={bid:h.high.bid!+1,ask:h.high.ask!+1};
 assert.equal((await paHttp(url(`symbol=JP225&offset=2&snapshot_sha256=${page.snapshot_sha256}`),'evidence',f.deps)).status,409);
 assert.equal((await paHttp(url('symbol=JP225&id=unknown'),'evidence',f.deps)).status,404);
});

test('V6 closed OHLC pages reconstruct the exact filtered finite window with one pin',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});const expected=buildPaEngine(f.data,'ask').frames.H4.ohlc;
 const from=expected[2].time,to=expected.at(-2)!.time,want=expected.filter(b=>b.time>=from&&b.time<to),got:typeof expected=[];let offset=0,pin='';
 for(;;){const res=await paHttp(url(`symbol=JP225&side=ask&timeframe=H4&limit=4&offset=${offset}&from=${from}&to=${to}${pin?'&snapshot_sha256='+pin:''}`),'candles',f.deps),r=await res.json();assert.equal(res.status,200);pin||=r.snapshot_sha256;assert.equal(r.snapshot_sha256,pin);assert.equal(r.total,want.length);assert.equal(r.omitted,r.total-r.candles.length);for(const c of r.candles){assert.equal(c.is_closed,true);assert.ok(c.end<=r.as_of);const {is_closed,...bar}=c;got.push(bar);}
  if(r.next_offset===null)break;assert.ok(r.next_offset>offset);offset=r.next_offset;
 }
 assert.deepEqual(got,want);assert.equal(new Set(got.map(b=>b.time)).size,got.length);
});

test('V6 stale quote suppresses current evidence; explicit archive is labelled and never borrows a newer as_of',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 await paHttp(url('symbol=JP225'),'report',f.deps); // cache a current snapshot first
 const archivedAt='2026-11-15T13:59:00.000Z';
 const archived=await paHttp(url('symbol=JP225&as_of='+archivedAt),'evidence',f.deps),a=await archived.json();assert.equal(archived.status,200);assert.equal(a.source_type,'ARCHIVE_AS_OF');assert.ok(a.as_of<=archivedAt);
 const deps={...f.deps,getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf,fresh:false,provider_timestamp:'2026-11-15T13:50:00.000Z',quote_time:'2026-11-15T13:50:00.000Z'})};
 const res=await paHttp(url('symbol=JP225'),'report',deps),r=await res.json();assert.equal(res.status,200);assert.equal(r.status,'STALE');assert.deepEqual(r.evidence,[]);assert.deepEqual(r.market_structure,{});assert.deepEqual(r.dealing_ranges,[]);assert.equal(r.coverage.observations_available,false);validatePaReport(r,'JP225');
 assert.equal((await paHttp(url('symbol=JP225'),'evidence',deps)).status,503);assert.equal((await paHttp(url('symbol=JP225'),'candles',deps)).status,503);
});

test('V6 malformed filters, unpinned pagination and forecast inputs are rejected before upstream',async()=>{
 let called=0;const deps={getCandles:async()=>{called++;throw Error('must not fetch');},getAnalysisQuote:async()=>{called++;throw Error('must not fetch');}};
 for(const query of ['symbol=EU50','symbol=__proto__','side=mid','timeframe=M1','limit=0','limit=999','offset=-1','offset=1.5','min_price=-1','min_price=2&max_price=1','from=2026-02-30T00:00:00.000Z','from=not-a-time','snapshot_sha256=bad','anchor_id=anything','target_id=anything','offset=1','kind=NOT_A_PA','lifecycle=NOT_A_LIFECYCLE','view=unknown']){
  const res=await paHttp(url(query),'evidence',deps as never);assert.equal(res.status,400,query);
 }
 assert.equal(called,0);assert.equal((await paHttp(url('refresh=1'),'report',deps as never)).status,405);
 const post=await paHttp(new Request('https://local/api/desk-report',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}),'report',deps as never);assert.equal(post.status,403);
 const huge=await paHttp(new Request('https://local/api/desk-report',{method:'POST',body:' '.repeat(9000)}),'report',deps as never);assert.ok([400,413].includes(huge.status));assert.equal(called,0);
});

test('V6 upstream faults are sanitized and portable contract rejects secret/forecast/future mutation',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const response=await paHttp(url('symbol=JP225'),'report',{...f.deps,getCandles:async()=>{throw Error('private-session-password');}}),raw=await response.text();assert.equal(response.status,503);assert.ok(!raw.includes('private-session-password'));validatePaReport(JSON.parse(raw),'JP225');
 const r=await (await paHttp(url('symbol=JP225'),'report',f.deps)).json();
 const secret=structuredClone(r);secret.warnings.push('EXTERNAL_TEST_SECRET_12345');assert.throws(()=>validatePaReport(secret,'JP225',undefined,['EXTERNAL_TEST_SECRET_12345']),/SECRET_IN_REPORT/);
 const forecast=structuredClone(r);forecast.scenario={direction:'LONG'};assert.throws(()=>validatePaReport(forecast,'JP225'),/INVALID_EVIDENCE/);
 const future=structuredClone(r);future.evidence[0].confirmed_at='2099-01-01T00:00:00.000Z';assert.throws(()=>validatePaReport(future,'JP225'),/INVALID_EVIDENCE/);
 const wrongCount=structuredClone(r);wrongCount.omitted.evidence++;assert.throws(()=>validatePaReport(wrongCount,'JP225'),/INVALID_EVIDENCE/);
 const mutations:(()=>unknown)[]=[
  ()=>({...structuredClone(r),published_at:'2026-02-30T00:00:00.000Z'}),
  ()=>{const x=structuredClone(r);x.source.engine_commit='not-a-git-commit';return x;},
  ()=>{const x=structuredClone(r);x.quote.bid=null;return x;},
  ()=>{const x=structuredClone(r);x.quote.fresh='true';return x;},
  ()=>{const x=structuredClone(r);x.freshness.quote_status='STALE';return x;},
  ()=>{const x=structuredClone(r);x.evidence[0].headers={accountId:'sensitive-account'};return x;},
  ()=>{const x=structuredClone(r);x.evidence[0].raw_response={private_information:'never publish upstream bodies'};return x;},
 ];
 for(const mutate of mutations)assert.throws(()=>validatePaReport(mutate(),'JP225'),/INVALID_EVIDENCE|SECRET_IN_REPORT/);
});
