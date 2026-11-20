import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPaEngine} from '../lib/pa-engine/core';
import {buildPaReport,nearbyLevels,PA_TFS,type NearbyLevel} from '../lib/pa-engine/report';
import {buildPaBrief,BRIEF_LEVELS_PER_SIDE} from '../lib/pa-engine/brief';
import {validatePaBrief,validatePaReport} from '../lib/pa-engine/contract';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

// One RB formation observed at several known KL is emitted by the engine once per KL.
// nearby_levels / brief must show it once, with every evidence id and every KL context.
type Fake={id:string;kind:string;timeframe:string;origin:string;confirmed_at:string;formation_status:string;facts:Record<string,unknown>;bounds:{lower:number;upper:number};remaining_bounds:{lower:number;upper:number};lifecycle:{state:string;fill:null}};
const rb=(kl:string,lower:number,upper:number,o:{state?:string;formation?:string;origin?:string;confirmed?:string}={}):Fake=>{
 const origin=o.origin??'2026-11-05T00:00:00.000Z',confirmed=o.confirmed??'2026-11-07T00:00:00.000Z';
 return {id:`NAS100:D1:bid:RB_TWO_CANDLE:${confirmed}:${kl}`,kind:'RB_TWO_CANDLE',timeframe:'D1',origin,confirmed_at:confirmed,formation_status:o.formation??'CONFIRMED',
  facts:{kl_id:kl,rb_fvg_id:kl},bounds:{lower,upper},remaining_bounds:{lower,upper},lifecycle:{state:o.state??'CANDIDATE',fill:null}};
};
const core=(evidence:Fake[],close=27000)=>({frames:{H4:{ohlc:[{time:'2026-11-20T08:00:00.000Z',end:'2026-11-20T12:00:00.000Z',open:close,high:close+1,low:close-1,close}]}},evidence}) as unknown as Parameters<typeof nearbyLevels>[0];
const KL=['NAS100:MN1:bid:FVG:2026-05-01T00:00:00.000Z:','NAS100:W1:bid:FVG:2026-04-20T00:00:00.000Z:','NAS100:W1:bid:FVG:2026-04-27T00:00:00.000Z:'];

test('one RB formation at three KL becomes one level with all ids and contexts',()=>{
 const n=nearbyLevels(core(KL.map(k=>rb(k,26515.6,26515.6))),5)!.block.timeframes.D1;
 assert.equal(n.below.length,1);assert.deepEqual(n.eligible,{above:0,below:1,at_price:0});
 const x=n.below[0];
 assert.deepEqual(x.ids,KL.map(k=>`NAS100:D1:bid:RB_TWO_CANDLE:2026-11-07T00:00:00.000Z:${k}`).sort());
 assert.equal(x.id,x.ids[0]);assert.equal(x.formation_status,'CONFIRMED');assert.equal(x.state,'CANDIDATE');
 assert.deepEqual(x.contexts.map(c=>c.id),[...KL].sort());
 for(const c of x.contexts){assert.deepEqual(c.relationships,['kl_id','rb_fvg_id']);assert.equal(c.evidence_ids.length,1);assert.ok(x.ids.includes(c.evidence_ids[0]));}
});

test('different bounds, formation candles, state or formation status are never merged',()=>{
 const n=nearbyLevels(core([
  rb(KL[0],26515.6,26515.6),rb(KL[1],26515.6,26515.6),
  rb(KL[2],26515.6,26520),                                        // other bounds
  rb(KL[0],26515.6,26515.6,{origin:'2026-11-06T00:00:00.000Z',confirmed:'2026-11-08T00:00:00.000Z'}), // other candles
  {...rb(KL[2],26515.6,26515.6),id:'NAS100:D1:bid:RB_TWO_CANDLE:2026-11-07T00:00:00.000Z:x',lifecycle:{state:'UNVERIFIED',fill:null}},
  {...rb(KL[2],26515.6,26515.6),id:'NAS100:D1:bid:RB_TWO_CANDLE:2026-11-07T00:00:00.000Z:y',formation_status:'NEEDS_SPECIFICATION'},
 ]),10)!.block.timeframes.D1;
 assert.equal(n.below.length+n.at_price.length,5);
 assert.deepEqual(n.below.map(x=>x.ids.length).sort(),[1,1,1,1,2]);
});

test('per-side limit counts grouped levels, not evidence ids',()=>{
 // Seven distinct formations below the price, each observed at three KL (21 evidence ids).
 const evidence=Array.from({length:7},(_,i)=>KL.map(k=>rb(k,26000+i*10,26000+i*10,{origin:`2026-10-0${i+1}T00:00:00.000Z`,confirmed:`2026-10-0${i+2}T00:00:00.000Z`}))).flat();
 const n=nearbyLevels(core(evidence),5)!.block.timeframes.D1;
 assert.equal(n.below.length,5);assert.equal(n.eligible.below,7);
 assert.deepEqual(n.below.map(x=>x.upper),[26060,26050,26040,26030,26020]);
 for(const x of n.below)assert.equal(x.ids.length,3);
});

function archived(symbol:string,side:'bid'|'ask'='bid'){
 const input=JSON.parse(readFileSync(`tests/fixtures/edge-v2/${symbol}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
 const now=new Date(Math.max(...Object.values(input.data).map(d=>Date.parse(d.fetched_at)))).toISOString();
 const quote={...input.quote,provider_timestamp:now,retrieved_at:now,fresh:true,market_status:'TRADEABLE'} as MarketQuote;
 const core=buildPaEngine(input.data,side),report=buildPaReport(core,input.data,quote,now);
 return {core,report,brief:buildPaBrief(report,core,'https://capitalive.test')};
}
const levelsOf=(timeframes:Record<string,{above:NearbyLevel[];below:NearbyLevel[];at_price:NearbyLevel[]}>)=>Object.values(timeframes).flatMap(f=>[...f.above,...f.below,...f.at_price]);

for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'] as const)test(`${symbol} ${side}: archived data has no duplicate formation in nearby_levels or brief`,()=>{
 const {core,report,brief}=archived(symbol,side);
 validatePaReport(report,symbol);validatePaBrief(brief,symbol);
 const byId=new Map(core.evidence.map(e=>[e.id,e]));
 const key=(id:string)=>{const e=byId.get(id)!;return JSON.stringify([e.timeframe,e.kind,e.origin,e.confirmed_at,e.remaining_bounds,e.bounds]);};
 let merged=0;
 for(const levels of [levelsOf(report.nearby_levels!.timeframes),levelsOf(Object.fromEntries(PA_TFS.map(tf=>[tf,brief.timeframes[tf].levels!])) as never)]){
  const keys=levels.map(x=>key(x.id));assert.equal(new Set(keys).size,keys.length,'one row per formation');
  for(const x of levels){
   assert.ok(['CONFIRMED','NEEDS_SPECIFICATION'].includes(x.formation_status));
   for(const id of x.ids){assert.equal(key(id),key(x.id));assert.equal(byId.get(id)!.formation_status,x.formation_status);assert.equal(byId.get(id)!.lifecycle!.state,x.state);}
   // Every evidence of the same formation and state is inside the group.
   const peers=core.evidence.filter(e=>key(e.id)===key(x.id)&&e.lifecycle?.state===x.state&&e.formation_status===x.formation_status).map(e=>e.id).sort();
   assert.deepEqual(x.ids,peers);merged+=x.ids.length>1?1:0;
  }
 }
 assert.ok(merged+levelsOf(nearbyLevels(core,1000)!.block.timeframes).filter(x=>x.ids.length>1).length>0,'fixture contains multi-KL formations');
 for(const tf of PA_TFS){const t=brief.timeframes[tf].levels!;for(const k of ['above','below','at_price'] as const)assert.ok(t[k].length<=BRIEF_LEVELS_PER_SIDE);}
});

test('validatePaBrief rejects forbidden keys, size, leaked observations, relative links and broken groups',()=>{
 const {brief}=archived('NAS100');validatePaBrief(brief,'NAS100');
 const first=()=>{const b=structuredClone(brief) as any;const tf=PA_TFS.find(t=>b.timeframes[t].levels.below.length)!;return {b,x:b.timeframes[tf].levels.below[0],t:b.timeframes[tf]};};
 const mutations:[string,(b:any)=>void][]=[
  ['forbidden key',b=>{b.timeframes.H4.entry=1;}],
  ['nested forbidden key',b=>{b.quote.take_profit=1;}],
  ['trading enabled',b=>{b.trading_enabled=true;}],
  ['quote as evidence',b=>{b.quote.used_as_closed_evidence=true;}],
  ['stale with levels',b=>{b.status='STALE';b.observations_available=false;}],
  ['relative link',b=>{b.links.self='/api/brief?symbol=NAS100';}],
  ['wrong symbol',b=>{b.symbol='EU50';}],
 ];
 for(const [name,mutate] of mutations){const b=structuredClone(brief);mutate(b);assert.throws(()=>validatePaBrief(b,'NAS100'),/INVALID_EVIDENCE/,name);}
 const groupMutations:[string,(x:any,t:any)=>void][]=[
  ['ids not starting with id',x=>{x.ids=[...x.ids].reverse();x.ids.push('NAS100:D1:bid:FRACTAL:zzz');}],
  ['urls do not match ids',x=>{x.urls=[];}],
  ['context outside group',x=>{x.contexts=[{id:'NAS100:MN1:bid:FVG:a',relationships:['kl_id'],evidence_ids:['NAS100:H4:bid:FVG:other']}];}],
  ['unknown relationship',x=>{x.contexts=[{id:'NAS100:MN1:bid:FVG:a',relationships:['significance'],evidence_ids:[x.id]}];}],
  ['bad formation status',x=>{x.formation_status='STRONG';}],
  ['consumed level',x=>{x.state='CONSUMED';}],
  ['omitted count',(_x,t)=>{t.levels.omitted++;}],
 ];
 for(const [name,mutate] of groupMutations){const {b,x,t}=first();mutate(x,t);assert.throws(()=>validatePaBrief(b,'NAS100'),/INVALID_EVIDENCE/,name);}
 const big=structuredClone(brief) as any;big.warnings.push('X'.repeat(70000));assert.throws(()=>validatePaBrief(big),/BRIEF_TOO_LARGE/);
 const secret=structuredClone(brief) as any;secret.warnings.push('EXTERNAL_TEST_SECRET_12345');assert.throws(()=>validatePaBrief(secret,'NAS100',['EXTERNAL_TEST_SECRET_12345']),/SECRET_IN_BRIEF/);
});

test('desk-report contract rejects a nearby group whose ids or contexts are inconsistent',()=>{
 const {report}=archived('NAS100');validatePaReport(report,'NAS100');
 const level=(r:any)=>levelsOf(r.nearby_levels.timeframes).find(x=>x.ids.length>1)!;
 const b=structuredClone(report) as any;const lb=level(b) as any;lb.ids=[...lb.ids,lb.ids[0]];assert.throws(()=>validatePaReport(b,'NAS100'),/INVALID_EVIDENCE/);
 const c=structuredClone(report) as any;const lc=level(c) as any;lc.contexts[0].evidence_ids=['NAS100:D1:bid:RB_TWO_CANDLE:not-in-group'];assert.throws(()=>validatePaReport(c,'NAS100'),/INVALID_EVIDENCE/);
 const d=structuredClone(report) as any;const ld=level(d) as any;ld.id=ld.ids[1];assert.throws(()=>validatePaReport(d,'NAS100'),/INVALID_EVIDENCE/);
 // Reports built before grouping (no ids/contexts/formation_status) stay valid.
 const old=structuredClone(report) as any;delete old.nearby_levels.grouping;for(const x of levelsOf(old.nearby_levels.timeframes) as any[]){delete x.ids;delete x.contexts;delete x.formation_status;}
 validatePaReport(old,'NAS100');
});
