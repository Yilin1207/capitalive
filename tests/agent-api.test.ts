import test from 'node:test';
import assert from 'node:assert/strict';
import {paHttp,canonicalTime} from '../lib/pa-engine/http';
import {buildPaEngine} from '../lib/pa-engine/core';
import {engineCommit,nearbyLevels,PA_MAX_BYTES,PA_TFS} from '../lib/pa-engine/report';
import {BRIEF_LEVELS_PER_SIDE} from '../lib/pa-engine/brief';
import {agentIndex,llmsText} from '../lib/agent-index';
import {syntheticMarket} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';

// Synthetic contract transport, explicitly not an independent broker price check.
function fixture(symbol='EU50'){
 const f=syntheticMarket(symbol);
 const deps={getCandles:async(_symbol:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})};
 return {...f,deps};
}
const ORIGIN='https://capitalive.test';
const req=(path:string,query:string)=>new Request(`${ORIGIN}${path}?${query}`);
const forbidden=/^(narrative|scenario|entry|entry_stop|stop_loss|take_profit|rr|verdict|target_selection|quality_score|probability|direction|bias|score)$/i;
function noForecast(v:unknown){if(Array.isArray(v))v.forEach(noForecast);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){assert.ok(!forbidden.test(k),k);noForecast(x);}}
function urls(v:unknown,out:string[]=[]){if(typeof v==='string'&&/^https?:\/\//.test(v))out.push(v);else if(Array.isArray(v))v.forEach(x=>urls(x,out));else if(v&&typeof v==='object')Object.values(v).forEach(x=>urls(x,out));return out;}
const followEvidence=(u:string,deps:ReturnType<typeof fixture>['deps'])=>paHttp(new Request(u),'evidence',deps);

test('brief: compact per-TF view of the same snapshot, nearest levels by distance only, absolute links',async t=>{
 const first=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(first.asOf)});
 for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'] as const){
  const f=fixture(symbol),res=await paHttp(req('/api/brief',`symbol=${symbol}&side=${side}`),'brief',f.deps),raw=await res.text(),b=JSON.parse(raw);
  assert.equal(res.status,200);assert.equal(b.schema_version,'pa-brief-v1');assert.equal(b.symbol,symbol);assert.equal(b.price_side,side);
  assert.equal(b.trading_enabled,false);assert.equal(b.quote.used_as_closed_evidence,false);assert.equal(b.observations_available,true);
  assert.ok(Buffer.byteLength(raw)<PA_MAX_BYTES);noForecast(b);
  // Same snapshot as the desk report.
  const report=await (await paHttp(req('/api/desk-report',`symbol=${symbol}&side=${side}`),'report',f.deps)).json();
  assert.equal(b.snapshot_sha256,report.snapshot_sha256);assert.equal(b.status,report.status);
  // Levels equal the geometric nearby selection with the brief's per-side limit.
  const expected=nearbyLevels(buildPaEngine(f.data,side),BRIEF_LEVELS_PER_SIDE)!.block;
  assert.deepEqual(b.reference,expected.reference);
  for(const tf of PA_TFS){
   const got=b.timeframes[tf],want=expected.timeframes[tf];
   for(const k of ['above','below','at_price'])// Additive brief fields (urls, distance_atr_d1, nested_in, kl_events) on top of the geometric selection.
   assert.deepEqual(got.levels[k].map(({urls,distance_atr_d1,nested_in,kl_events,...x}:Record<string,unknown>)=>x),want[k as 'above']);
   assert.deepEqual(got.levels.eligible,want.eligible);
   assert.ok(got.last_closed_candles.length>0&&got.last_closed_candles.length<=5);
   assert.equal(got.last_closed_candles.at(-1).closed_at,got.last_closed_at);
   for(const c of got.last_closed_candles)assert.ok(c.closed_at<=b.as_of);
  }
  // Every URL is absolute on the request origin.
  const all=urls(b);assert.ok(all.length>10);for(const u of all)assert.ok(u.startsWith(ORIGIN+'/'),u);
 }
});

test('brief: level and fractal URLs are followable and return that exact evidence',async t=>{
 const f=fixture('NAS100');t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const b=await (await paHttp(req('/api/brief','symbol=NAS100'),'brief',f.deps)).json();
 const level=(x:{id:string;urls:string[]})=>({id:x.id,url:x.urls[0]});
 const items=PA_TFS.flatMap(tf=>[...b.timeframes[tf].levels.above.map(level),...b.timeframes[tf].levels.below.map(level),...b.timeframes[tf].recent_fractals]);
 assert.ok(items.length>0);
 for(const x of items.slice(0,6)){
  const res=await followEvidence(x.url,f.deps),r=await res.json();
  assert.equal(res.status,200,x.url);assert.equal(r.evidence[0].id,x.id);assert.equal(r.snapshot_sha256,b.snapshot_sha256);
 }
 const page=await (await followEvidence(b.timeframes.H4.links.evidence,f.deps)).json();
 assert.ok(page.evidence.every((e:{timeframe:string})=>e.timeframe==='H4'));
});

test('brief: STALE withholds levels, ranges and fractals like the desk report',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const deps={...f.deps,getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf,fresh:false,provider_timestamp:'2026-11-15T13:50:00.000Z',quote_time:'2026-11-15T13:50:00.000Z'})};
 const res=await paHttp(req('/api/brief','symbol=EU50'),'brief',deps),b=await res.json();
 assert.equal(res.status,200);assert.equal(b.status,'STALE');assert.equal(b.observations_available,false);assert.equal(b.reference,null);
 for(const tf of PA_TFS){const x=b.timeframes[tf];assert.equal(x.levels,null);assert.equal(x.dealing_range,null);assert.equal(x.approach,null);assert.equal(x.recent_fractals,null);assert.equal(x.findings_by_kind,null);}
 assert.ok(b.freshness.stale_reasons.length>0);
});

test('pages carry absolute pinned links.next that walk the whole result',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 let res=await paHttp(req('/api/pa-evidence','symbol=EU50&timeframe=H4&limit=3'),'evidence',f.deps),r=await res.json();
 const total=r.total,seen=new Set<string>();assert.ok(total>3);
 assert.ok(r.links.self.startsWith(ORIGIN+'/api/pa-evidence?'));assert.equal(new URL(r.links.next).searchParams.get('offset'),'3');
 for(;;){for(const e of r.evidence)seen.add(e.id);if(!r.links.next)break;
  const u=new URL(r.links.next);assert.equal(u.searchParams.get('snapshot_sha256'),r.snapshot_sha256);assert.equal(u.searchParams.get('offset'),String(r.next_offset));
  res=await followEvidence(r.links.next,f.deps);r=await res.json();assert.equal(res.status,200);}
 assert.equal(seen.size,total);
 const candles=await (await paHttp(req('/api/pa-candles','symbol=EU50&timeframe=H4&limit=2'),'candles',f.deps)).json();
 assert.equal(new URL(candles.links.next).searchParams.get('offset'),'2');assert.equal(new URL(candles.links.first).searchParams.get('offset'),null);
});

test('errors explain what to fix; side is case-insensitive; UTC dates accept common spellings',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const bad=await (await paHttp(req('/api/pa-evidence','symbol=XAU'),'evidence',f.deps)).json();
 assert.equal(bad.error,'INVALID_REQUEST');assert.match(bad.diagnostic.message,/NAS100/);assert.equal(bad.diagnostic.docs,ORIGIN+'/llms.txt');
 const side=await (await paHttp(req('/api/pa-evidence','symbol=EU50&side=mid'),'evidence',f.deps)).json();assert.match(side.diagnostic.message,/bid or ask/);
 const unpinned=await (await paHttp(req('/api/pa-evidence','symbol=EU50&offset=5'),'evidence',f.deps)).json();assert.match(unpinned.diagnostic.message,/links\.next/);
 const upper=await paHttp(req('/api/pa-evidence','symbol=EU50&side=BID&limit=1'),'evidence',f.deps);assert.equal(upper.status,200);assert.equal((await upper.json()).price_side,'bid');
 const day=f.data.H4.candles[3].time.slice(0,10);
 const lenient=await paHttp(req('/api/pa-candles',`symbol=EU50&timeframe=H4&from=${day}&to=${day}T23:59:59Z`),'candles',f.deps),l=await lenient.json();
 assert.equal(lenient.status,200);assert.ok(l.candles.length>0);assert.ok(l.candles.every((c:{time:string})=>c.time.startsWith(day)));
 assert.equal(canonicalTime('2026-11-01'),'2026-11-01T00:00:00.000Z');assert.equal(canonicalTime('2026-11-01T10:00Z'),'2026-11-01T10:00:00.000Z');
 assert.equal(canonicalTime('2026-11-01T10:00:00.5Z'),'2026-11-01T10:00:00.500Z');assert.equal(canonicalTime(null),null);
 for(const x of ['2026-02-30','2026-02-30T00:00:00Z','2026-11-01T10:00:00+03:00','2026-11-01 10:00','yesterday'])assert.equal(canonicalTime(x),undefined,x);
});

test('agent index and llms.txt list every market with absolute URLs and no trading fields',()=>{
 const index=agentIndex(ORIGIN);assert.deepEqual(Object.keys(index.markets),['EURUSD','NAS100','EU50']);assert.equal(index.trading_enabled,false);noForecast(index);
 for(const u of urls(index))assert.ok(u.startsWith(ORIGIN+'/'),u);
 const text=llmsText(ORIGIN);
 for(const s of ['EURUSD','NAS100','EU50'])assert.ok(text.includes(`${ORIGIN}/api/brief?symbol=${s}`),s);
 assert.ok(!/\]\(\//.test(text)&&!/ \/api\//.test(text),'no relative links');
});

test('deployment without git metadata (empty VERCEL_GIT_COMMIT_SHA) still serves valid desk-report and brief',async t=>{
 const f=fixture('NAS100');t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const saved=process.env.VERCEL_GIT_COMMIT_SHA;
 try{
  for(const sha of ['','not-a-sha',' ']){
   process.env.VERCEL_GIT_COMMIT_SHA=sha;
   const rep=await paHttp(req('/api/desk-report','symbol=NAS100'),'report',f.deps),r=await rep.json();
   assert.equal(rep.status,200,`report with SHA ${JSON.stringify(sha)}`);assert.equal(r.source.engine_commit,null);
   const br=await paHttp(req('/api/brief','symbol=NAS100'),'brief',f.deps),b=await br.json();
   assert.equal(br.status,200,`brief with SHA ${JSON.stringify(sha)}`);assert.equal(b.source.engine_commit,null);
  }
  process.env.VERCEL_GIT_COMMIT_SHA='6068b19'.padEnd(40,'a').toUpperCase();
  const r=await (await paHttp(req('/api/desk-report','symbol=NAS100'),'report',f.deps)).json();
  assert.equal(r.source.engine_commit,'6068b19'.padEnd(40,'a'));
 }finally{if(saved===undefined)delete process.env.VERCEL_GIT_COMMIT_SHA;else process.env.VERCEL_GIT_COMMIT_SHA=saved;}
 assert.equal(engineCommit({}),null);assert.equal(engineCommit({VERCEL_GIT_COMMIT_SHA:''}),null);
 assert.equal(engineCommit({VERCEL_GIT_COMMIT_SHA:'a'.repeat(41)}),null);assert.equal(engineCommit({VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)}),'b'.repeat(40));
});

test('pa-candles latest=N returns the last N closed candles of the snapshot',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const all=await (await paHttp(req('/api/pa-candles','symbol=EU50&timeframe=D1&limit=200'),'candles',f.deps)).json();
 const res=await paHttp(req('/api/pa-candles','symbol=EU50&timeframe=D1&latest=3'),'candles',f.deps),r=await res.json();
 assert.equal(res.status,200);assert.equal(r.candles.length,3);assert.equal(r.latest,3);
 assert.deepEqual(r.candles.map((c:{time:string})=>c.time),all.candles.slice(-3).map((c:{time:string})=>c.time));
 assert.equal(r.candles.at(-1).end,r.last_closed_at);assert.equal(r.total,all.total);assert.equal(r.omitted,all.total-3);assert.equal(r.next_offset,null);
 // latest combines with from/to; never with offset/limit.
 const day=all.candles.at(-5).time.slice(0,10);
 const ranged=await (await paHttp(req('/api/pa-candles',`symbol=EU50&timeframe=D1&latest=50&from=${day}`),'candles',f.deps)).json();
 assert.ok(ranged.candles.length<=5&&ranged.candles.every((c:{time:string})=>c.time>=day));
 for(const q of ['latest=0','latest=201','latest=x','latest=3&offset=2','latest=3&limit=5']){const bad=await paHttp(req('/api/pa-candles','symbol=EU50&timeframe=D1&'+q),'candles',f.deps);assert.equal(bad.status,400,q);assert.equal((await bad.json()).error,'INVALID_PAGE',q);}
});

test('brief batch: one response for several symbols, loaded sequentially, latest=N candles, failures stay visible',async t=>{
 const f=fixture('NAS100');t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const per={NAS100:fixture('NAS100'),EU50:fixture('EU50'),EURUSD:fixture('EURUSD')};
 let active=0,maxActive=0;const order:string[]=[];
 const deps={getCandles:async(symbol:string,tf:Timeframe)=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;if(tf==='H4')order.push(symbol);return per[symbol as 'EU50'].data[tf];},
  getAnalysisQuote:async(symbol:string)=>({...per[symbol as 'EU50'].quote,cache_hit:false,evaluated_at:f.asOf})};
 const res=await paHttp(req('/api/brief','symbols=NAS100,EU50,EURUSD&latest=12'),'brief',deps),raw=await res.text(),b=JSON.parse(raw);
 assert.equal(res.status,200);assert.equal(b.schema_version,'pa-brief-batch-v1');assert.deepEqual(b.symbols,['NAS100','EU50','EURUSD']);
 assert.deepEqual(order,['NAS100','EU50','EURUSD']);assert.equal(maxActive,1);
 assert.equal(b.trading_enabled,false);noForecast(b);assert.match(b.batch_sha256,/^[a-f0-9]{64}$/);assert.deepEqual(b.omitted.symbols_failed,[]);
 for(const s of b.symbols){const x=b.briefs[s];assert.equal(x.symbol,s);assert.equal(x.schema_version,'pa-brief-v1');assert.equal(b.results[s].snapshot_sha256,x.snapshot_sha256);
  assert.ok(Buffer.byteLength(JSON.stringify(x))<=200_000);assert.ok(x.quote.bid>0&&x.quote.ask>=x.quote.bid);
  for(const tf of PA_TFS){assert.equal(x.timeframes[tf].last_closed_candles.length,Math.min(12,x.timeframes[tf].closed_candles));assert.equal(x.selection_policy.last_closed_candles_per_tf,12);}
  // Same snapshot as the single-symbol brief.
  const single=await (await paHttp(req('/api/brief',`symbol=${s}`),'brief',deps)).json();assert.equal(single.snapshot_sha256,x.snapshot_sha256);}
 // One failing symbol: reported as its error, no substitute, others still served.
 const broken={...deps,getCandles:async(symbol:string,tf:Timeframe)=>{if(symbol==='EU50')throw Object.assign(Error('down'),{code:'CAPITAL_UPSTREAM'});return per[symbol as 'EU50'].data[tf];}};
 const part=await (await paHttp(req('/api/brief','symbols=NAS100,EU50'),'brief',broken)).json();
 assert.equal(part.status,'ERROR');assert.equal(part.results.EU50.http_status,503);assert.equal(part.results.EU50.snapshot_sha256,null);assert.equal(part.briefs.EU50.error,'UPSTREAM_OR_EVIDENCE_UNAVAILABLE');
 assert.deepEqual(part.omitted.symbols_failed,['EU50']);assert.equal(part.batch_sha256,null);assert.equal(part.briefs.NAS100.symbol,'NAS100');
 for(const q of ['symbols=','symbols=NAS100,NAS100','symbols=XAU','symbols=NAS100&symbol=EU50']){const r=await paHttp(req('/api/brief',q),'brief',deps);assert.equal(r.status,400,q);}
 const bad=await paHttp(req('/api/brief','symbols=NAS100&latest=51'),'brief',deps);assert.equal(bad.status,400);assert.equal((await bad.json()).error,'INVALID_PAGE');
});
