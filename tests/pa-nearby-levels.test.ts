import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPaEngine} from '../lib/pa-engine/core';
import {buildPaReport,nearbyLevels,PA_MAX_BYTES,PA_TFS} from '../lib/pa-engine/report';
import {validatePaReport} from '../lib/pa-engine/contract';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

// Archived provider snapshots; the quote is re-stamped at the snapshot clock so the
// report is deliverable (PARTIAL). The quote never feeds closed-candle evidence.
function archived(symbol:string,side:'bid'|'ask'='bid'){
 const input=JSON.parse(readFileSync(`tests/fixtures/edge-v2/${symbol}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
 const now=new Date(Math.max(...Object.values(input.data).map(d=>Date.parse(d.fetched_at)))).toISOString();
 const quote={...input.quote,provider_timestamp:now,retrieved_at:now,fresh:true,market_status:'TRADEABLE'} as MarketQuote;
 const staleQuote={...quote,provider_timestamp:new Date(Date.parse(now)-3600000).toISOString(),fresh:false} as MarketQuote;
 return {core:buildPaEngine(input.data,side),data:input.data,quote,now,staleQuote};
}
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
const included=(n:{timeframes:Record<string,{above:unknown[];below:unknown[];at_price:unknown[]}>}|null)=>n?Object.values(n.timeframes).reduce((k,f)=>k+f.above.length+f.below.length+f.at_price.length,0):0;

// Minimal synthetic core: nearbyLevels only reads frames.H4.ohlc and evidence.
type Fake={id:string;kind:string;timeframe:string;bounds:{lower:number;upper:number}|null;remaining_bounds:{lower:number;upper:number}|null;lifecycle:{state:string;fill:{state:string;max_observed_fraction:number}|null}|null};
const level=(id:string,lower:number,upper:number,state='ACTIVE',kind='FRACTAL',tf='D1'):Fake=>({id:`NAS100:${tf}:bid:${kind}:${id}`,kind,timeframe:tf,bounds:{lower,upper},remaining_bounds:{lower,upper},lifecycle:{state,fill:null}});
const fvg=(id:string,lower:number,upper:number,remaining:{lower:number;upper:number}|null,fraction:number,state='ACTIVE',fill='PARTIAL'):Fake=>({id:`NAS100:D1:bid:FVG:${id}`,kind:'FVG',timeframe:'D1',bounds:{lower,upper},remaining_bounds:remaining,lifecycle:{state,fill:{state:fill,max_observed_fraction:fraction}}});
const fakeCore=(evidence:Fake[],close=100)=>({frames:{H4:{ohlc:[{time:'2026-11-20T08:00:00.000Z',end:'2026-11-20T12:00:00.000Z',open:close,high:close+1,low:close-1,close}]}},evidence}) as unknown as Parameters<typeof nearbyLevels>[0];

test('nearby_levels excludes INVALIDATED, fully filled FVG and consumed non-fractals; keeps raided fractals (Notion Fractal Raid)',()=>{
 const n=nearbyLevels(fakeCore([
  level('consumed',101,101,'CONSUMED'),level('consumed-rb',101.5,101.5,'CONSUMED','RB_TWO_CANDLE'),level('invalidated',102,102,'INVALIDATED'),
  fvg('filled-tested',103,104,null,1,'TESTED','FILLED'),fvg('filled-invalidated',95,96,null,1,'INVALIDATED','FILLED'),
  level('active',110,110),level('candidate',97,98,'CANDIDATE','RB_TWO_CANDLE'),level('unverified',90,90,'UNVERIFIED'),
  {...level('raid',100.5,100.5),kind:'RAID'},{...level('no-lifecycle',100.2,100.2),lifecycle:null},
 ]))!.block.timeframes.D1;
 const ids=[...n.above,...n.below,...n.at_price].map(x=>x.id.split(':').at(-1)).sort();
 assert.deepEqual(ids,['active','candidate','consumed','unverified']);
 assert.deepEqual(n.eligible,{above:2,below:2,at_price:0});
});

test('nearby_levels uses the FVG remainder for bounds and distance after a partial test',()=>{
 // Support FVG 90..98 tested halfway from the top: remainder 90..94, so distance is 6, not 2.
 // Resistance FVG 104..110 tested halfway from the bottom: remainder 107..110, distance 7, not 4.
 const n=nearbyLevels(fakeCore([fvg('support',90,98,{lower:90,upper:94},0.5),fvg('resistance',104,110,{lower:107,upper:110},0.5),fvg('untouched',80,85,{lower:80,upper:85},0,'ACTIVE','UNTOUCHED')]))!.block.timeframes.D1;
 assert.deepEqual(n.below.map(x=>[x.id.split(':').at(-1),x.lower,x.upper,x.distance,x.bounds_basis,x.fill]),[['support',90,94,6,'FVG_REMAINING','PARTIAL'],['untouched',80,85,15,'ORIGINAL','UNTOUCHED']]);
 assert.deepEqual(n.above.map(x=>[x.lower,x.upper,x.distance,x.bounds_basis]),[[107,110,7,'FVG_REMAINING']]);
});

test('nearby_levels is geometric: nearest first, per-side limit, containing levels at distance 0, no float noise',()=>{
 const n=nearbyLevels(fakeCore([level('a5',150,150),level('a1',101,101),level('a3',120,130),level('a2',105,105),level('a4',140,140),level('in',99,101.5),level('b',41.9,42.1)],100.1))!.block;
 const d1=n.timeframes.D1;
 assert.deepEqual(d1.above.map(x=>x.id.split(':').at(-1)),['a1','a2','a3']);assert.equal(d1.eligible.above,5);
 assert.deepEqual(d1.above.map(x=>x.distance),[0.9,4.9,19.9]);
 assert.deepEqual(d1.at_price.map(x=>[x.id.split(':').at(-1),x.distance]),[['in',0]]);
 assert.equal(d1.below[0].distance,58);
 assert.deepEqual(n.reference,{price:100.1,at:'2026-11-20T12:00:00.000Z',basis:'LAST_CLOSED_H4_CLOSE'});
 assert.equal(n.selection_policy,'NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE');
 assert.deepEqual(Object.keys(n.timeframes),[...PA_TFS]);
});

for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'] as const)test(`${symbol} ${side}: report with nearby_levels stays within ${PA_MAX_BYTES} bytes and matches engine lifecycle`,()=>{
 const f=archived(symbol,side),r=buildPaReport(f.core,f.data,f.quote,f.now);
 validatePaReport(r,symbol);assert.equal(r.status,'PARTIAL');assert.ok(bytes(r)+1<=PA_MAX_BYTES);
 const n=r.nearby_levels!;assert.ok(n&&included(n)>0);
 const byId=new Map(f.core.evidence.map(e=>[e.id,e]));
 for(const tf of PA_TFS)for(const x of [...n.timeframes[tf].above,...n.timeframes[tf].below,...n.timeframes[tf].at_price]){
  const e=byId.get(x.id)!;assert.equal(e.timeframe,tf);assert.equal(x.state,e.lifecycle!.state);
  assert.ok(x.state!=='INVALIDATED'&&(x.state!=='CONSUMED'||x.kind==='FRACTAL'));
  const b=e.kind==='FVG'?e.remaining_bounds!:e.bounds!;assert.deepEqual([x.lower,x.upper],[b.lower,b.upper]);
 }
 const eligible=PA_TFS.reduce((k,tf)=>{const c=n.timeframes[tf].eligible;return k+c.above+c.below+c.at_price;},0);
 assert.equal(r.omitted.nearby_levels,eligible-included(n));assert.equal(n.size_trimmed,0);
 // Snapshot identity is unchanged by the new display block.
 assert.equal(r.snapshot_sha256,buildPaReport(f.core,f.data,{...f.quote,bid:f.quote.bid!*1.01,ask:f.quote.ask!*1.01},f.now).snapshot_sha256);
});

test('size pressure: evidence tail is trimmed before nearby_levels; nearby trimming is counted in omitted',()=>{
 const f=archived('NAS100'),base=buildPaReport(f.core,f.data,f.quote,f.now),nb=base.nearby_levels!;
 // 1) Inflate evidence so it no longer fits: nearby_levels must survive intact.
 const heavy=structuredClone(f.core);for(const e of heavy.evidence)e.limitations.push('SIZE_PRESSURE_'+'x'.repeat(6000));
 const a=buildPaReport(heavy,f.data,f.quote,f.now);validatePaReport(a,'NAS100');
 assert.ok(bytes(a)+1<=PA_MAX_BYTES);assert.ok(a.evidence.length<base.evidence.length);assert.deepEqual(a.nearby_levels,nb);
 // 2) Leave room for only part of the block: farthest levels go first and are reported.
 const tight=structuredClone(f.core),fixed=bytes({...base,evidence:[],nearby_levels:null});
 tight.warnings.push('SIZE_PRESSURE_'+'y'.repeat(PA_MAX_BYTES-64-fixed-Math.floor(bytes(nb)/2)));
 const b=buildPaReport(tight,f.data,f.quote,f.now);validatePaReport(b,'NAS100');
 assert.ok(bytes(b)+64<=PA_MAX_BYTES);assert.equal(b.evidence.length,0);
 const kept=b.nearby_levels!;assert.ok(kept.size_trimmed>0&&included(kept)>0);assert.equal(included(kept)+kept.size_trimmed,included(nb));
 assert.equal(b.omitted.nearby_levels,base.omitted.nearby_levels+kept.size_trimmed);
 const maxKept=Math.max(...PA_TFS.flatMap(tf=>[...kept.timeframes[tf].above,...kept.timeframes[tf].below,...kept.timeframes[tf].at_price].map(x=>x.distance)));
 const keptIds=new Set(PA_TFS.flatMap(tf=>[...kept.timeframes[tf].above,...kept.timeframes[tf].below,...kept.timeframes[tf].at_price].map(x=>x.id)));
 for(const tf of PA_TFS)for(const x of [...nb.timeframes[tf].above,...nb.timeframes[tf].below,...nb.timeframes[tf].at_price])if(!keptIds.has(x.id))assert.ok(x.distance>=maxKept);
});

test('STALE report withholds nearby_levels and counts them as omitted',()=>{
 const f=archived('NAS100'),r=buildPaReport(f.core,f.data,f.staleQuote,f.now);
 validatePaReport(r,'NAS100');assert.equal(r.status,'STALE');assert.equal(r.nearby_levels,null);
 const n=nearbyLevels(f.core)!;assert.equal(r.omitted.nearby_levels,n.eligible);assert.ok(n.eligible>0);
});

test('contract accepts reports without nearby_levels and rejects inconsistent blocks',()=>{
 const f=archived('NAS100'),r=buildPaReport(f.core,f.data,f.quote,f.now);
 const legacy=structuredClone(r) as Record<string,any>;delete legacy.nearby_levels;delete legacy.omitted.nearby_levels;validatePaReport(legacy,'NAS100');
 const side=(['above','below'] as const).find(s=>PA_TFS.some(tf=>r.nearby_levels!.timeframes[tf][s].length>=2))!;
 const tf=PA_TFS.find(t=>r.nearby_levels!.timeframes[t][side].length>=2)!;
 const stale=buildPaReport(f.core,f.data,f.staleQuote,f.now) as Record<string,any>;validatePaReport(stale,'NAS100');
 stale.nearby_levels=structuredClone(r.nearby_levels);assert.throws(()=>validatePaReport(stale,'NAS100'),/INVALID_EVIDENCE/);
 const mutations:((x:any)=>void)[]=[
  x=>{const l=x.nearby_levels.timeframes[tf][side][0];l.state='CONSUMED';if(l.kind==='FRACTAL')l.kind='SNR_CLOSED_BREAK';},
  x=>{x.nearby_levels.timeframes[tf][side][0].state='INVALIDATED';},
  x=>{x.nearby_levels.timeframes[tf][side][0].distance+=1;},
  x=>{x.nearby_levels.timeframes[tf][side].reverse();},
  x=>{x.nearby_levels.timeframes[tf][side][0].significance=1;},
  x=>{x.nearby_levels.selection_policy='STRONGEST_FIRST';},
  x=>{const other=side==='above'?'below':'above';x.nearby_levels.timeframes[tf][other].unshift(x.nearby_levels.timeframes[tf][side].shift());},
  x=>{x.nearby_levels.per_side_limit=x.nearby_levels.timeframes[tf][side].length-1;},
  x=>{x.omitted.nearby_levels=-1;},
 ];
 for(const mutate of mutations){const x=structuredClone(r);mutate(x);assert.throws(()=>validatePaReport(x,'NAS100'),/INVALID_EVIDENCE/);}
});
