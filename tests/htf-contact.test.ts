import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildHtfAudit} from '../lib/htf-audit';
import {ANALYSIS_TIMEFRAMES,analyzeSeries} from '../lib/technical-analysis';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
import {observeHtfContact} from '../lib/htf-contact';
import type {CatalogEntry} from '../lib/htf-zone-catalog';
import {marketAudit} from '../lib/market-audit';
import {htfZones} from '../lib/htf-http';
import {normalizeQuote,normalizeStreamingQuote,unavailable} from '../lib/quote-normalization';
import {acceptStreamMessage,streamDiagnostics} from '../lib/tick-data';

const f=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
// Independent-audit counterexample: historical price retained, ONLY freshness simulated.
function freshQuote():MarketQuote {const time=new Date(Date.now()-1000).toISOString();return {...f.quote,fresh:true,provider_timestamp_available:true,quote_time:time,provider_timestamp:time,source_type:'WEBSOCKET',delay_seconds:0};}
for(const side of ['bid','ask'] as const)test(`NAS100 ${side}: all three significant SNR contacts survive top-20 exclusion`,()=>{
  const quote=freshQuote(),a=buildHtfAudit('NAS100',side,f.data,ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],'NAS100',side,{},quote[side])),quote);
  const expected=[`NAS100:MN1:${side}:snr:2026-06-01T00:00:00.000Z:low`,`NAS100:W1:${side}:snr:2026-06-08T00:00:00.000Z:low`,`NAS100:D1:${side}:snr:2026-06-09T00:00:00.000Z:low`];
  assert.equal(a.contact.eligible,true);assert.equal(a.contact.alerts_emitted,false);
  assert.equal(a.contact.zones.length,3,'MN1 + W1 + D1, not merely the two priority hits');
  assert.deepEqual(a.contact.zones.map(z=>z.id).sort(),[...expected].sort());
  assert.equal(a.priority_zones.selected_count,20);
  assert.ok(!a.priority_zones.zones.some(z=>z.id===expected[2]));
  assert.equal(a.priority_zones.excluded_from_priority.find(z=>z.id===expected[2])?.reason,'PRIORITY_CAPACITY_OR_TF_CAP');
  assert.ok(a.contact.zones.every(z=>z.state==='IN_ZONE'&&!z.closed_retest_confirmed));
  assert.equal(a.contact.hit_count,3);assert.deepEqual(a.contact.contact_hits,a.contact.zones);
  assert.equal(a.contact.coverage.priority_cap_applied,false);
  const daily=a.contact.zones.find(z=>z.id===expected[2])!;
  assert.equal(daily.status,'tested');assert.equal(daily.role,'support');assert.equal(daily.provisional_role,'resistance');
  assert.equal(daily.role_reversal_confirmed,false);assert.ok(daily.provisional_at);assert.equal(daily.data_reliability.status,'PARTIAL');
});

function candidates():CatalogEntry[]{
  const a=buildHtfAudit('NAS100','bid',f.data,ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],'NAS100')),f.quote);
  const seed=a.catalog.zones.find(z=>z.id==='NAS100:W1:bid:snr:2026-06-08T00:00:00.000Z:low')!;
  return Array.from({length:31},(_,i)=>({...seed,id:`independent-overlap-${String(i).padStart(2,'0')}`,source_id:`source-${i}`,timeframe:i%2?'W1':'D1'}));
}
test('31 overlapping W1/D1 contacts remain separate and deterministic, independent of top-20 and input order',()=>{
  const all=candidates(),q=freshQuote(),now=Date.now(),a=observeHtfContact(q,'bid',all,now),b=observeHtfContact(q,'bid',[...all].reverse(),now);
  assert.equal(a.hit_count,31);assert.equal(new Set(a.contact_hits.map(z=>z.source_id)).size,31);assert.deepEqual(a,b);
  assert.equal(a.coverage.merged_or_omitted_hits,0);assert.equal(a.coverage.eligible_candidates,31);
});
test('contact policy explicitly excludes watch, unreliable, gap-state and non-SNR; inclusive boundaries remain contacts',()=>{
  const seed=candidates()[0],q=freshQuote(),now=Date.now(),zones=[seed,
    {...seed,id:'watch',status:'watch',significant:false},
    {...seed,id:'unverified',data_reliability:{status:'UNVERIFIED' as const,reasons:['UNKNOWN_HISTORY'],scope:'test'}},
    {...seed,id:'gap',break_status:'unknown_after_gap'},
    {...seed,id:'fvg',type:'FVG' as const}];
  const c=observeHtfContact(q,'bid',zones,now);assert.equal(c.hit_count,1);assert.equal(c.coverage.total_snr,4);assert.equal(c.coverage.excluded_by_policy,3);
  for(const price of [seed.lower,seed.upper])assert.equal(observeHtfContact({...q,bid:price},'bid',[seed],now).hit_count,1);
});
test('full-catalog contacts remain suppressed for stale, future, missing timestamp or invalid price',()=>{
  const all=candidates(),q=freshQuote(),now=Date.now();
  for(const quote of [{...q,fresh:false},{...q,quote_time:null},{...q,quote_time:new Date(now+1).toISOString()},
    {...q,quote_time:new Date(now-300001).toISOString()},{...q,bid:null},{...q,bid:NaN}]){
    const c=observeHtfContact(quote,'bid',all,now);assert.equal(c.eligible,false);assert.equal(c.hit_count,0);assert.equal(c.alerts_emitted,false);
    assert.deepEqual(c.contact_hits,[]);assert.deepEqual(c.zones,[]);assert.equal(c.coverage.eligible_candidates,31);
  }
});

for(const side of ['bid','ask'] as const)test(`freshness simulation ${side}: full and compact HTTP retain all three contact hits and response budget`,async()=>{
  const q=freshQuote(),deps={getCandles:async(_symbol:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...q,cache_hit:false,evaluated_at:new Date().toISOString()})};
  const full=await marketAudit(new Request(`https://local/api/market-audit?symbol=NAS100&side=${side}&include_candles=1`),deps);
  const text=await full.text();assert.equal(full.status,200);assert.ok(Buffer.byteLength(text)<4_250_000);
  const body=JSON.parse(text);assert.equal(body.htf.contact.hit_count,3);
  const compact=await htfZones(new Request(`https://local/api/htf-zones?symbol=NAS100&side=${side}&view=priority`),deps);
  const htf=await compact.json();assert.equal(compact.status,200);assert.equal(htf.contact.hit_count,3);
  assert.deepEqual(htf.contact.contact_hits.map((z:{id:string})=>z.id),body.htf.contact.contact_hits.map((z:{id:string})=>z.id));
  assert.equal(htf.scope.full_catalog_included,false);assert.ok(htf.contact.contact_hits.some((z:{timeframe:string})=>z.timeframe==='D1'));
});

for(const flag of [undefined,null,false])test(`timestamp availability ${String(flag)} is not affirmative evidence, even with fresh=true`,()=>{
  const q={...freshQuote(),provider_timestamp_available:flag} as MarketQuote;
  const c=observeHtfContact(q,'bid',candidates());assert.equal(c.eligible,false);assert.equal(c.hit_count,0);
});
test('explicit timestamp evidence still requires a fresh non-future timestamp',()=>{
  const now=Date.now(),q={...freshQuote(),provider_timestamp_available:true},all=candidates();
  assert.equal(observeHtfContact(q,'bid',all,now).eligible,true);
  for(const time of [now-300001,now+1])assert.equal(observeHtfContact({...q,quote_time:new Date(time).toISOString()},'bid',all,now).eligible,false);
});
test('REST normalization never invents provider timestamp from receipt time or market summary',()=>{
  const now=Date.now(),retrieved=new Date(now).toISOString();
  const missing=normalizeQuote('NAS100','US100',{snapshot:{bid:f.quote.bid!,offer:f.quote.ask!,marketStatus:'TRADEABLE'}},{delayTime:0},retrieved,now)!;
  assert.equal(missing.provider_timestamp_available,false);assert.equal(missing.quote_time,null);assert.equal(missing.fresh,false);
  assert.equal(observeHtfContact({...missing,fresh:true},'bid',candidates(),now).eligible,false);
  assert.equal(unavailable('NAS100','US100').provider_timestamp_available,false);
  const valid=normalizeQuote('NAS100','US100',{snapshot:{bid:f.quote.bid!,offer:f.quote.ask!,marketStatus:'TRADEABLE',updateTimeUTC:new Date(now-1000).toISOString()}},{delayTime:0},retrieved,now)!;
  assert.equal(valid.provider_timestamp_available,true);assert.equal(valid.fresh,true);assert.equal(observeHtfContact(valid,'bid',candidates(),now).eligible,true);
});
test('validated real-contract WebSocket tick retains explicit timestamp evidence through normalization',()=>{
  const now=Date.now(),d=streamDiagnostics(['US100']);
  const tick=acceptStreamMessage(JSON.stringify({destination:'quote',status:'OK',payload:{epic:'US100',bid:f.quote.bid,ofr:f.quote.ask,timestamp:now-1000}}),d,now)!;
  assert.ok(tick);const q=normalizeStreamingQuote('NAS100',tick,null,now)!;
  assert.equal(q.provider_timestamp_available,true);assert.equal(q.quote_time,new Date(tick.timestamp).toISOString());assert.equal(q.fresh,true);
  assert.equal(observeHtfContact(q,'bid',candidates(),now).eligible,true);
});
