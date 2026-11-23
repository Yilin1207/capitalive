import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateNy,bucketEnd,bucketStart,nyDayStart} from '../lib/ny-grid';
import type {Candle} from '../lib/candle-data';

const iso=(ms:number)=>new Date(ms).toISOString();
const at=(s:string)=>Date.parse(s);
const H=3_600_000;
function hour(time:string,o:number,h:number,l:number,c:number):Candle{return {time,open:{bid:o,ask:o+1},high:{bid:h,ask:h+1},low:{bid:l,ask:l+1},close:{bid:c,ask:c+1},is_closed:true};}
/** Continuous provider HOUR bars [from, to) with a deterministic path. */
function hours(from:string,to:string){const out:Candle[]=[];for(let t=at(from),i=0;t<at(to);t+=H,i++)out.push(hour(iso(t),100+i,101+i+(i%3),99+i-(i%2),100.5+i));return out;}

test('NY grid: trading day starts 17:00 America/New_York in winter and summer',()=>{
 assert.equal(iso(nyDayStart(at('2026-11-23T03:00:00Z'))),'2026-11-22T22:00:00.000Z');// EST: Sunday 17:00 ET opens Monday
 assert.equal(iso(nyDayStart(at('2026-11-23T22:00:00Z'))),'2026-11-23T22:00:00.000Z');
 assert.equal(iso(nyDayStart(at('2026-11-23T21:59:59Z'))),'2026-11-22T22:00:00.000Z');
 assert.equal(iso(nyDayStart(at('2026-07-15T12:00:00Z'))),'2026-07-14T21:00:00.000Z');// EDT
});

test('NY grid: H4 opens at 22/02/06/10/14/18 UTC in winter and one hour earlier in summer',()=>{
 const winter=[...Array(6)].map((_,i)=>iso(bucketStart(at('2026-11-24T22:30:00Z')+i*4*H,'H4','ny')).slice(11,13));
 assert.deepEqual(winter,['22','02','06','10','14','18']);
 const summer=[...Array(6)].map((_,i)=>iso(bucketStart(at('2026-07-14T21:30:00Z')+i*4*H,'H4','ny')).slice(11,13));
 assert.deepEqual(summer,['21','01','05','09','13','17']);
 // The UTC grid is unchanged.
 assert.equal(iso(bucketStart(at('2026-11-22T23:00:00Z'),'H4','utc')),'2026-11-22T20:00:00.000Z');
});

test('NY grid: DST switch weekends (March and November) keep 4h buckets with no stub',()=>{
 // 2026-03-08 02:00 EST -> EDT. Friday is on the EST grid, Sunday's open on the EDT grid.
 assert.equal(iso(bucketStart(at('2026-03-06T19:00:00Z'),'H4','ny')),'2026-03-06T18:00:00.000Z');
 assert.equal(iso(bucketEnd(at('2026-03-06T18:00:00Z'),'H4','ny')),'2026-03-06T22:00:00.000Z');
 assert.equal(iso(bucketStart(at('2026-03-08T21:30:00Z'),'H4','ny')),'2026-03-08T21:00:00.000Z');
 assert.equal(iso(nyDayStart(at('2026-03-09T12:00:00Z'))),'2026-03-08T21:00:00.000Z');
 // 2026-11-01 02:00 EDT -> EST.
 assert.equal(iso(bucketStart(at('2026-10-30T18:00:00Z'),'H4','ny')),'2026-10-30T17:00:00.000Z');
 assert.equal(iso(bucketEnd(at('2026-10-30T17:00:00Z'),'H4','ny')),'2026-10-30T21:00:00.000Z');
 assert.equal(iso(bucketStart(at('2026-11-01T23:00:00Z'),'H4','ny')),'2026-11-01T22:00:00.000Z');
 // Trading days around the switch are exactly 24h; D1 bucket ends at the next 17:00 ET.
 assert.equal(iso(bucketEnd(at('2026-03-08T21:00:00Z'),'D1','ny')),'2026-03-09T21:00:00.000Z');
 assert.equal(iso(bucketEnd(at('2026-11-01T22:00:00Z'),'D1','ny')),'2026-11-02T22:00:00.000Z');
});

test('NY grid aggregation: Sunday open is not a stub, Friday close ends the week, every bar is a full bucket',()=>{
 // NAS100-like week: Sunday 23:00Z open (18:00 ET) to Friday 22:00Z close (17:00 ET), winter.
 const data=hours('2026-11-15T23:00:00Z','2026-11-20T22:00:00Z');
 const fetched=at('2026-11-21T00:00:00Z');
 const h4=aggregateNy(data,'H4',fetched,at('2026-11-15T00:00:00Z'));
 assert.equal(h4[0].time,'2026-11-15T22:00:00.000Z');// no 20:00Z two-hour stub
 assert.equal(h4[0].open.bid,data[0].open.bid);assert.equal(h4[0].close.bid,data[2].close.bid);// 23,00,01
 assert.equal(h4.at(-1)!.time,'2026-11-20T18:00:00.000Z');assert.equal(h4.at(-1)!.end_time,'2026-11-20T22:00:00.000Z');
 assert.equal(h4.at(-1)!.close.bid,data.at(-1)!.close.bid);
 for(const c of h4){assert.ok(['22','02','06','10','14','18'].includes(c.time.slice(11,13)),c.time);assert.equal(at(c.end_time!)-at(c.time),4*H);assert.equal(c.is_closed,true);}
 assert.equal(h4.length,5*6);
 const d1=aggregateNy(data,'D1',fetched,at('2026-11-15T00:00:00Z'));
 assert.deepEqual(d1.map(c=>c.time.slice(0,13)),['2026-11-15T22','2026-11-16T22','2026-11-17T22','2026-11-18T22','2026-11-19T22']);
 const fri=data.filter(c=>c.time>='2026-11-19T22')!;
 assert.equal(d1.at(-1)!.high.bid,Math.max(...fri.map(c=>c.high.bid!)));assert.equal(d1.at(-1)!.low.ask,Math.min(...fri.map(c=>c.low.ask!)));
});

test('NY grid aggregation: forming bucket, missing side, rejected hour and truncated window',()=>{
 const data=hours('2026-11-16T22:00:00Z','2026-11-17T05:00:00Z');
 const forming=aggregateNy(data,'H4',at('2026-11-17T05:00:00Z'),0);
 assert.deepEqual(forming.map(c=>c.is_closed),[true,false]);
 const gap=data.map((c,i)=>i===1?{...c,open:{...c.open,ask:null}}:c);
 const g=aggregateNy(gap,'H4',at('2026-11-18T00:00:00Z'),0)[0];assert.equal(g.open.ask,null);assert.equal(g.high.ask,null);assert.equal(g.open.bid,data[0].open.bid);
 const rejected=aggregateNy(data,'H4',at('2026-11-18T00:00:00Z'),0,['2026-11-17T03:00:00.000Z']);
 assert.equal(rejected[0].history_completeness,undefined);assert.equal(rejected[1].history_completeness,'partial_validation');
 // A bucket that started before the fetch window is dropped rather than shown truncated.
 assert.deepEqual(aggregateNy(data,'H4',at('2026-11-18T00:00:00Z'),at('2026-11-16T23:00:00Z')).map(c=>c.time),['2026-11-17T02:00:00.000Z']);
});

import {closedFrame} from '../lib/knowledge/data';
import {paHttp} from '../lib/pa-engine/http';
import {syntheticMarket} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';

test('NY D1 bars starting Sunday 17:00 ET are not merged again as Sunday sessions',()=>{
 const f=syntheticMarket('NAS100');
 // Monday..Friday NY trading days of one week: Monday's opens Sunday 22:00Z.
 const days=['2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12'].map((d,i)=>hour(`${d}T22:00:00.000Z`,100+i,110+i,90+i,101+i));
 const data={...f.data.D1,candles:days,metadata:{...f.data.D1.metadata,grid:'ny' as const}};
 const frame=closedFrame(data,'bid',f.asOf);
 assert.deepEqual(frame.bars.map(b=>b.time),days.map(d=>d.time));
 assert.equal(frame.bars[0].end,'2026-11-09T22:00:00.000Z');
 assert.equal(frame.bars[1].high,111);// Tuesday keeps its own high
});

test('grid parameter: ny is the default, utc is explicit, invalid grid is rejected; grid is in every response',async t=>{
 const f=syntheticMarket('EU50');t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const asked:string[]=[];
 const grid=(g:string|undefined)=>({getCandles:async(_s:string,tf:Timeframe,_l:number,_r?:boolean,gr?:string)=>{asked.push(`${tf}:${gr}`);
  const d=f.data[tf];return g&&(tf==='H4'||tf==='D1')?{...d,metadata:{...d.metadata,grid:g as 'ny'}}:d;},
  getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})});
 const r=(path:string,q:string)=>new Request(`https://capitalive.test${path}?${q}`);
 const ny=grid('ny');
 const brief=await (await paHttp(r('/api/brief','symbol=EU50'),'brief',ny)).json();
 assert.deepEqual(asked,['MN1:ny','W1:ny','D1:ny','H4:ny']);
 assert.deepEqual(brief.grid,{requested:'ny',by_tf:{MN1:'utc_calendar',W1:'utc_week',D1:'ny',H4:'ny'}});
 assert.equal(brief.timeframes.H4.grid,'ny');assert.equal(brief.engine.contract,'pa-engine-v6.1');
 assert.ok(brief.links.evidence_all.includes('grid=ny'));
 const report=await (await paHttp(r('/api/desk-report','symbol=EU50'),'report',ny)).json();
 assert.equal(report.grid.requested,'ny');assert.equal(report.frames.D1.grid,'ny');assert.ok(report.frames.H4.ohlc_path.includes('grid=ny'));
 const page=await (await paHttp(r('/api/pa-candles','symbol=EU50&timeframe=H4&latest=2'),'candles',ny)).json();
 assert.equal(page.grid.by_tf.H4,'ny');assert.equal(page.last_closed_at_by_tf.H4,page.last_closed_at);assert.equal(page.engine.revision,'pa-only-6.0.0');
 asked.length=0;
 const utc=await (await paHttp(r('/api/brief','symbol=EU50&grid=utc'),'brief',grid(undefined))).json();
 assert.deepEqual(asked,['MN1:utc','W1:utc','D1:utc','H4:utc']);assert.equal(utc.grid.requested,'utc');assert.equal(utc.grid.by_tf.H4,'utc');
 assert.notEqual(utc.snapshot_sha256,brief.snapshot_sha256);
 const bad=await paHttp(r('/api/brief','symbol=EU50&grid=london'),'brief',ny);assert.equal(bad.status,400);assert.equal((await bad.json()).error,'INVALID_GRID');
});
