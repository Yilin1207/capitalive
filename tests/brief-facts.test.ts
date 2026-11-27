import test from 'node:test';
import assert from 'node:assert/strict';
import {approach,atrD1,classifyKlEvent,fractalsInsideKl,klEvents,nestedIn,premiumDiscount,strongFractals} from '../lib/pa-engine/brief-facts';
import {APPROACH_CONFIG} from '../lib/pa-engine/approach-config';
import {buildPaEngine} from '../lib/pa-engine/core';
import {paHttp} from '../lib/pa-engine/http';
import {PA_TFS} from '../lib/pa-engine/report';
import {syntheticMarket} from './fixtures/jp225-synthetic';
import type {Timeframe} from '../lib/candle-data';

type Core=Parameters<typeof nestedIn>[0];
const fixture=(symbol='NAS100')=>{const f=syntheticMarket(symbol);return {...f,deps:{getCandles:async(_s:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})}};};
const brief=async(f:ReturnType<typeof fixture>,q='')=>(await paHttp(new Request(`https://capitalive.test/api/brief?symbol=${f.data.H4.symbol}${q}`),'brief',f.deps)).json();
const zone=(id:string,kind:string,lower:number,upper:number,state='ACTIVE',fill?:{state:string;max_observed_fraction:number})=>({id,kind,timeframe:id.split(':')[1],bounds:{lower,upper},remaining_bounds:{lower,upper},lifecycle:{state,...(fill?{fill}:{})}});

test('atr_d1: mean true range of the last 14 closed D1 bars, a distance unit only',()=>{
 const f=fixture(),core=buildPaEngine(f.data,'bid'),bars=core.frames.D1.ohlc,atr=atrD1(core)!;
 const tr=bars.slice(-14).map((b,i)=>{const p=bars[bars.length-15+i].close;return Math.max(b.high-b.low,Math.abs(b.high-p),Math.abs(b.low-p));});
 assert.ok(Math.abs(atr.value-tr.reduce((a,b)=>a+b,0)/14)<1e-9);assert.equal(atr.period,14);assert.equal(atr.use,'DISTANCE_UNIT_ONLY_NOT_A_THRESHOLD');
 assert.equal(atrD1({frames:{...core.frames,D1:{...core.frames.D1,ohlc:bars.slice(0,14)}}}),null);
});

test('nested_in: only live higher-TF zones that fully contain the level',()=>{
 const evidence=[zone('X:D1:bid:FVG:a','FVG',100,120,'ACTIVE',{state:'PARTIAL',max_observed_fraction:0.3}),zone('X:W1:bid:RB_TWO_CANDLE:b','RB_TWO_CANDLE',90,130),
  zone('X:D1:bid:FVG:filled','FVG',100,120,'ACTIVE',{state:'FILLED',max_observed_fraction:1}),zone('X:D1:bid:SNR_CLOSED_BREAK:inv','SNR_CLOSED_BREAK',95,125,'INVALIDATED'),
  zone('X:H4:bid:FVG:same','FVG',100,120,'ACTIVE',{state:'UNTOUCHED',max_observed_fraction:0}),zone('X:D1:bid:FVG:partial-overlap','FVG',111,140,'ACTIVE',{state:'UNTOUCHED',max_observed_fraction:0})];
 const core={evidence} as unknown as Core;
 assert.deepEqual(nestedIn(core,'H4',{lower:105,upper:112}),['X:W1:bid:RB_TWO_CANDLE:b','X:D1:bid:FVG:a']);
 assert.deepEqual(nestedIn(core,'D1',{lower:105,upper:112}),['X:W1:bid:RB_TWO_CANDLE:b']);
 assert.deepEqual(nestedIn(core,'H4',{lower:85,upper:86}),[]);
});

test('brief levels carry distance_atr_d1 and nested_in; sorting stays by distance',async t=>{
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const b=await brief(f);assert.ok(b.atr_d1.value>0);
 let n=0;
 for(const tf of PA_TFS)for(const k of ['above','below','at_price']){let prev=-1;
  for(const x of b.timeframes[tf].levels[k]){n++;assert.ok(Math.abs(x.distance_atr_d1-x.distance/b.atr_d1.value)<1e-4);assert.ok(Array.isArray(x.nested_in));assert.ok(x.distance>=prev);prev=x.distance;
   for(const id of x.nested_in)assert.ok(PA_TFS.indexOf(id.split(':')[1])<PA_TFS.indexOf(tf));}}
 assert.ok(n>0);assert.equal(b.selection_policy.levels,'NEAREST_BY_DISTANCE_NOT_SIGNIFICANCE');
});

test('premium_discount: position of the last closed H4 close in the current DR of each TF',async t=>{
 const dr=(status:string,explicit?:unknown)=>({status,current:{lower:100,upper:200,equilibrium:150},...(explicit?{explicit_range:explicit}:{})});
 const at=(p:number,s='ESTABLISHED')=>premiumDiscount(dr(s),p)!;
 assert.deepEqual([at(175).zone,at(125).zone,at(150).zone,at(250).zone,at(50).zone],['PREMIUM','DISCOUNT','EQ','ABOVE_RANGE','BELOW_RANGE']);
 assert.equal(at(125).price_position_pct,25);assert.equal(at(250).price_position_pct,150);assert.equal(at(125).distance_to_high,75);assert.equal(at(125).distance_to_low,25);
 assert.equal(at(125).confirmed,true);assert.equal(at(125).selection,'AUTOMATIC_CANDIDATE');assert.equal(at(125,'AWAITING_NEW_EXTREME').confirmed,false);
 assert.equal(premiumDiscount(dr('ESTABLISHED',{high_id:'a',low_id:'b'}),125)!.selection,'EXPLICIT_IDS');
 assert.equal(premiumDiscount({status:'AWAITING_CONFIRMED_PAIR',current:null},125),null);
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const b=await brief(f);let seen=0;
 for(const tf of PA_TFS){const d=b.timeframes[tf].dealing_range;if(!d.current){assert.equal(d.premium_discount,null);continue;}seen++;
  const p=d.premium_discount;assert.equal(p.high,d.current.upper);assert.equal(p.low,d.current.lower);assert.equal(p.eq,d.current.equilibrium);assert.equal(p.price,b.reference.price);
  assert.ok(Math.abs(p.price_position_pct-(b.reference.price-p.low)/(p.high-p.low)*100)<0.01);}
 assert.ok(seen>0);
});

test('kl events: touch, rejection, acceptance and raid by closed candles only',async t=>{
 const bar=(high:number,low:number,close:number)=>({high,low,close});
 // Zone 100..110 approached from below (previous close 95).
 assert.equal(classifyKlEvent(95,bar(99,94,98),100,110),null);// no contact
 assert.equal(classifyKlEvent(95,bar(104,94,103),100,110),'TOUCH');// closed inside
 assert.equal(classifyKlEvent(95,bar(112,94,97),100,110),'REJECTION');// closed back below the near edge, even after a wick through
 assert.equal(classifyKlEvent(95,bar(115,94,111),100,110),'ACCEPTANCE');// closed beyond the far edge
 assert.equal(classifyKlEvent(95,bar(100,94,96),100,110),'REJECTION');// equality reaches the zone
 // From above (previous close 115).
 assert.equal(classifyKlEvent(115,bar(116,108,113),100,110),'REJECTION');assert.equal(classifyKlEvent(115,bar(116,95,99),100,110),'ACCEPTANCE');
 assert.equal(classifyKlEvent(105,bar(116,95,99),100,110),null);// previous close inside: not an approach
 // Fractal high at 100 approached from below; fractal low at 100 from above.
 assert.equal(classifyKlEvent(95,bar(100,94,98),100,100),'TOUCH');assert.equal(classifyKlEvent(95,bar(101,94,99),100,100),'RAID');
 assert.equal(classifyKlEvent(95,bar(103,94,101),100,100),'ACCEPTANCE');assert.equal(classifyKlEvent(105,bar(106,99,101),100,100),'RAID');
 // Candle colour is not a criterion: same OHLC extremes, different open, same class.
 assert.equal(classifyKlEvent(95,{...bar(112,94,97),open:96} as never,100,110),classifyKlEvent(95,{...bar(112,94,97),open:111} as never,100,110));
 // Engine: events start after the formation closed and use closed bars of the level TF and lower TFs.
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const core=buildPaEngine(f.data,'bid'),b=await brief(f);let checked=0;
 for(const tf of PA_TFS)for(const k of ['above','below','at_price'])for(const x of b.timeframes[tf].levels[k]){
  const ev=x.kl_events,e=core.evidence.find(y=>y.id===x.id)!;const original=klEvents(core,x);assert.deepEqual(ev,b.omitted.fact_details_size_trimmed.includes('KL_EVENTS_LAST')?{...original,last:[]}:original);
  assert.ok(ev!.last.length<=3);for(const y of ev!.last){assert.ok(y.at>e.confirmed_at&&y.at<=b.as_of);assert.ok(PA_TFS.indexOf(y.tf)>=PA_TFS.indexOf(tf));}
  checked++;}
 assert.ok(checked>0);
});

test('approach: run without counter-close, move in D1 ATR, body overlap, contracting ranges; flags only with approved thresholds',async t=>{
 // o,h,l,c per bar; last four closes rise without a counter-close, last two ranges contract.
 const raw=[[100,104,96,98],[98,103,95,97],[97,106,96,105],[105,112,104,111],[111,116,109,115],[115,118,113,117]];
 const ohlc=raw.map(([open,high,low,close],i)=>({index:i,time:`2026-11-1${i}T00:00:00.000Z`,end:`2026-11-1${i}T04:00:00.000Z`,open,high,low,close,segment:0}));
 const core={frames:{H4:{ohlc}}} as unknown as Parameters<typeof approach>[0];
 const level={id:'X:H4:bid:FVG:a',kind:'FVG',distance:3} as never;
 const a=approach(core,'H4',10,{above:[level],below:[],at_price:[]})!;
 assert.equal(a.closes,'RISING');assert.equal(a.bars_without_correction,4);assert.equal(a.move,20);assert.equal(a.move_atr_d1,2);
 assert.equal(a.window_bars,6);assert.equal(a.overlapping_body_pairs,1);assert.equal(a.contracting_ranges,3);
 assert.deepEqual(a.nearest_level_on_path,{id:'X:H4:bid:FVG:a',kind:'FVG',distance:3,at_price:false});
 assert.equal(a.flag,'NOT_EVALUATED');assert.equal(a.thresholds,'NEEDS_SPECIFICATION');
 const cfg={...APPROACH_CONFIG,expansion_min_bars:4,expansion_min_move_atr_d1:1.5,compression_min_overlap_pairs:4,compression_min_contracting_bars:4};
 assert.equal(approach(core,'H4',10,null,cfg)!.flag,'EXPANSION_NO_CORRECTION');
 assert.equal(approach(core,'H4',10,null,{...cfg,expansion_min_bars:5,compression_min_contracting_bars:2})!.flag,'COMPRESSION');
 assert.equal(approach(core,'H4',10,null,{...cfg,expansion_min_bars:5})!.flag,'NONE');
 // A gap boundary (new segment) ends the run.
 const split={frames:{H4:{ohlc:ohlc.map((b,i)=>({...b,segment:i<4?0:1}))}}} as unknown as Parameters<typeof approach>[0];
 assert.equal(approach(split,'H4',10,null)!.bars_without_correction,1);
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const b=await brief(f);assert.equal(b.approach_config.status,'NEEDS_SPECIFICATION');
 for(const tf of PA_TFS){const x=b.timeframes[tf].approach;assert.equal(x.flag,'NOT_EVALUATED');assert.equal(x.through,b.timeframes[tf].last_closed_at);}
});

test('strong fractals: VC_AT_FRACTAL and RAIDED_PRIOR_FRACTAL are separate flags; X-1 fractals inside KL listed, IDM unspecified',async t=>{
 const c=(time:string)=>({time});
 const ev=(id:string,kind:string,times:string[],facts:Record<string,unknown>,confirmed_at='2026-11-10T12:00:00.000Z')=>({id,kind,timeframe:'H4',candle_evidence:times.map(c),facts,confirmed_at,bounds:{lower:100,upper:100},lifecycle:{state:'ACTIVE'}});
 const T=['2026-11-10T00:00:00.000Z','2026-11-10T04:00:00.000Z','2026-11-10T08:00:00.000Z'];
 const evidence=[
  ev('X:H4:bid:FRACTAL:both','FRACTAL',T,{polarity:'low',price:100}),
  ev('X:H4:bid:RB_TWO_CANDLE:up','RB_TWO_CANDLE',[T[1],T[2]],{direction:'bullish',kl_id:'X:D1:bid:FVG:z'}),
  ev('X:H4:bid:RB_TWO_CANDLE:down','RB_TWO_CANDLE',[T[1],T[2]],{direction:'bearish',kl_id:'k'}),// wrong orientation for a low
  ev('X:H4:bid:RAID:g','RAID',[T[1]],{polarity:'low',pivot_id:'X:H4:bid:FRACTAL:old'}),
  ev('X:H4:bid:RAID:h','RAID',[T[1]],{polarity:'high',pivot_id:'X:H4:bid:FRACTAL:oldhigh'}),// other polarity
  ev('X:H4:bid:FRACTAL:raidonly','FRACTAL',['2026-11-11T00:00:00.000Z','2026-11-11T04:00:00.000Z','2026-11-11T08:00:00.000Z'],{polarity:'high',price:120},'2026-11-11T12:00:00.000Z'),
  ev('X:H4:bid:RAID:r2','RAID',['2026-11-11T04:00:00.000Z'],{polarity:'high',pivot_id:'X:H4:bid:FRACTAL:p'}),
  ev('X:H4:bid:FRACTAL:plain','FRACTAL',['2026-11-12T00:00:00.000Z','2026-11-12T04:00:00.000Z','2026-11-12T08:00:00.000Z'],{polarity:'low',price:90}),
  ev('X:H4:bid:FRACTAL_INSIDE_POI:i','FRACTAL_INSIDE_POI',[T[1]],{pivot_id:'X:H4:bid:FRACTAL:both',poi_id:'X:D1:bid:FVG:z',tf_relation:'X-1',price:100}),
 ];
 const core={evidence} as unknown as Parameters<typeof strongFractals>[0];
 const s=strongFractals(core,'H4');
 assert.equal(s.total,2);assert.equal(s.significance,'NOT_EVALUATED');
 assert.deepEqual(s.by_flag,{VC_AT_FRACTAL:1,RAIDED_PRIOR_FRACTAL:2,BOTH:1});
 const both=s.items.find(x=>x.id==='X:H4:bid:FRACTAL:both')!;
 assert.deepEqual(both.flags,['VC_AT_FRACTAL','RAIDED_PRIOR_FRACTAL']);assert.deepEqual(both.vc.map(x=>x.id),['X:H4:bid:RB_TWO_CANDLE:up']);assert.deepEqual(both.raided_fractal_ids,['X:H4:bid:FRACTAL:old']);
 assert.deepEqual(s.items.find(x=>x.id==='X:H4:bid:FRACTAL:raidonly')!.flags,['RAIDED_PRIOR_FRACTAL']);
 assert.equal(s.items[0].id,'X:H4:bid:FRACTAL:raidonly');// most recent first
 const inside=fractalsInsideKl(core,'H4');
 assert.equal(inside.idm_status,'SEE_ACTIVE_DR');assert.deepEqual(inside.items.map(x=>[x.id,x.kl_id,x.tf_relation]),[['X:H4:bid:FRACTAL:both','X:D1:bid:FVG:z','X-1']]);
 const f=fixture();t.mock.timers.enable({apis:['Date'],now:Date.parse(f.asOf)});
 const engine=buildPaEngine(f.data,'bid'),b=await brief(f);
 for(const tf of PA_TFS){assert.deepEqual(b.timeframes[tf].strong_fractals,strongFractals(engine,tf));assert.deepEqual(b.timeframes[tf].fractals_inside_kl,fractalsInsideKl(engine,tf));}
});

test('definitions: approach is facts-only; the RB-from-FVG open question is resolved (flag removed)',()=>{
 const d=buildPaEngine(fixture().data,'bid').definitions as Record<string,string>;
 assert.equal(d.rb_from_fvg_without_body_close,undefined);
 assert.equal(d.strong_high_low,'RULEBOOK_Q10');assert.equal(d.idm,'FRACTAL_INSIDE_ACTIVE_DR');assert.equal(d.significance,'NOT_EVALUATED');
 assert.equal(d.approach_character,'FACTS_ONLY_THRESHOLDS_NEEDS_SPECIFICATION');
});

test('size: a single brief trims fact details before levels and lists what was trimmed; the batch cap keeps everything',async()=>{
 const {readFileSync}=await import('node:fs');const {buildPaReport}=await import('../lib/pa-engine/report');const {buildPaBrief}=await import('../lib/pa-engine/brief');
 const input=JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8'));
 const now=new Date(Math.max(...Object.values(input.data as Record<string,{fetched_at:string}>).map(d=>Date.parse(d.fetched_at)))).toISOString();
 const core=buildPaEngine(input.data,'bid'),report=buildPaReport(core,input.data,{...input.quote,provider_timestamp:now,retrieved_at:now,fresh:true,market_status:'TRADEABLE'},now);
 const full=buildPaBrief(report,core,'https://capitalive.test','ny',{maxBytes:200_000});
 const single=buildPaBrief(report,core,'https://capitalive.test','ny');
 const longest=buildPaBrief(report,core,'https://capitalive-preview-example-yilin1207s-projects.vercel.app','utc',{candles:50});
 assert.ok(Buffer.byteLength(JSON.stringify(longest))+1<=65536);
 for(const tf of PA_TFS)assert.equal(longest.timeframes[tf].last_closed_candles.length,Math.min(50,core.frames[tf].closed_candles));
 assert.ok(Buffer.byteLength(JSON.stringify(full))>65536);assert.deepEqual(full.omitted.fact_details_size_trimmed,[]);
 assert.ok(Buffer.byteLength(JSON.stringify(single))<65536);assert.equal(single.omitted.levels_size_trimmed,single.omitted.levels-full.omitted.levels);
 assert.deepEqual(single.thesis_inputs,full.thesis_inputs);
 assert.deepEqual(single.omitted.fact_details_size_trimmed,['KL_EVENTS_LAST','STRONG_FRACTALS_AND_INSIDE_KL_ITEMS_BEYOND_FIRST']);
 for(const tf of PA_TFS){const a=single.timeframes[tf],b=full.timeframes[tf];
  for(const side of ['above','below','at_price'] as const)assert.deepEqual(a.levels![side].map(x=>x.id),b.levels![side].slice(0,a.levels![side].length).map(x=>x.id));
  assert.equal(a.strong_fractals!.total,b.strong_fractals!.total);assert.ok(a.strong_fractals!.items.length<=1);
  for(const x of a.levels!.below)assert.deepEqual(x.kl_events!.own_tf_counts,b.levels!.below.find(y=>y.id===x.id)!.kl_events!.own_tf_counts);}
});
