import type {Bar} from '../knowledge/data';
import {APPROACH_CONFIG} from './approach-config';
import {PA_TFS,type NearbyLevel,type PaEngine} from './report';

/** Geometric / closed-candle facts added to the brief. No significance, direction or trade field. */
type Tf=(typeof PA_TFS)[number];
type Core=Pick<PaEngine,'frames'|'evidence'>;
type Evidence=PaEngine['evidence'][number];
const round=(x:number,d=4)=>Number(x.toFixed(d));
const higherTfs=(tf:Tf)=>PA_TFS.slice(0,PA_TFS.indexOf(tf));
const lowerOrSameTfs=(tf:Tf)=>PA_TFS.slice(PA_TFS.indexOf(tf));
/** ATR period of the distance unit only (never a level threshold). */
export const ATR_D1_PERIOD=14;

/** D1 ATR (simple mean of the last N true ranges of closed D1 bars): a distance unit only. */
export function atrD1(core:Pick<PaEngine,'frames'>,period=ATR_D1_PERIOD){
 const bars=core.frames.D1.ohlc;if(bars.length<period+1)return null;
 const tr=bars.slice(-period).map((b,i)=>{const prev=bars[bars.length-period-1+i].close;return Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev));});
 return {value:round(tr.reduce((a,b)=>a+b,0)/period,10),period,basis:'D1_CLOSED_TRUE_RANGE_MEAN' as const,through:bars.at(-1)!.end,use:'DISTANCE_UNIT_ONLY_NOT_A_THRESHOLD' as const};
}

/** Live zones usable as containers: RB/SNR/FVG(unfilled remainder) that are not invalidated or consumed. */
function liveZone(e:Evidence){
 const s=e.lifecycle;if(!s||!['FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(e.kind)||s.state==='INVALIDATED'||s.state==='CONSUMED')return null;
 const b=e.kind==='FVG'?e.remaining_bounds:e.bounds;
 if(!b||!(b.upper>b.lower)||e.kind==='FVG'&&(!s.fill||s.fill.state==='FILLED'||s.fill.max_observed_fraction>=1))return null;
 return b;
}
/** Ids of live higher-TF zones whose bounds fully contain the level (geometric containment only). */
export function nestedIn(core:Core,tf:Tf,level:{lower:number;upper:number},cap=5){
 const higher=higherTfs(tf);
 return core.evidence.filter(e=>higher.includes(e.timeframe as Tf)).flatMap(e=>{const b=liveZone(e);return b&&b.lower<=level.lower&&level.upper<=b.upper?[e.id]:[];})
  .sort((a,b)=>PA_TFS.indexOf(a.split(':')[1] as Tf)-PA_TFS.indexOf(b.split(':')[1] as Tf)||a.localeCompare(b)).slice(0,cap);
}

/** Premium/discount of the current DR (automatic pair = candidate unless high_id/low_id were given). */
export function premiumDiscount(dr:{status:string;current:{lower:number;upper:number;equilibrium:number}|null;explicit_range?:unknown},ref:number|null){
 if(!dr.current||ref===null)return null;
 const {lower:low,upper:high,equilibrium:eq}=dr.current,pct=high>low?round((ref-low)/(high-low)*100,2):null;
 const zone=ref>high?'ABOVE_RANGE':ref<low?'BELOW_RANGE':ref>eq?'PREMIUM':ref<eq?'DISCOUNT':'EQ';
 return {high,low,eq,price:ref,price_basis:'LAST_CLOSED_H4_CLOSE' as const,price_position_pct:pct,zone,distance_to_high:round(high-ref,10),distance_to_low:round(ref-low,10),
  dr_status:dr.status,confirmed:dr.status==='ESTABLISHED',selection:dr.explicit_range?'EXPLICIT_IDS':'AUTOMATIC_CANDIDATE',eq_band:'NEEDS_SPECIFICATION_EXACT_EQUALITY_ONLY'};
}

export type KlEventType='TOUCH'|'REJECTION'|'ACCEPTANCE'|'RAID';
/** Classify one closed candle approaching [lower, upper] from the side of the previous close.
 * Zone: close back beyond the near boundary = REJECTION, beyond the far boundary = ACCEPTANCE, inside = TOUCH.
 * Point level (fractal): wick beyond and close back = RAID, close beyond = ACCEPTANCE, equality = TOUCH.
 * Candle colour and wick proportion are never criteria. */
export function classifyKlEvent(prevClose:number,b:Pick<Bar,'high'|'low'|'close'>,lower:number,upper:number):KlEventType|null{
 const fromBelow=prevClose<lower,fromAbove=prevClose>upper;if(!fromBelow&&!fromAbove)return null;
 const near=fromBelow?lower:upper,far=fromBelow?upper:lower,reached=fromBelow?b.high>=near:b.low<=near;if(!reached)return null;
 const beyond=(x:number,edge:number)=>fromBelow?x>edge:x<edge,back=(x:number,edge:number)=>fromBelow?x<edge:x>edge;
 if(lower===upper){const crossed=fromBelow?b.high>near:b.low<near;if(!crossed)return 'TOUCH';return beyond(b.close,far)?'ACCEPTANCE':back(b.close,near)?'RAID':'TOUCH';}
 return beyond(b.close,far)?'ACCEPTANCE':back(b.close,near)?'REJECTION':'TOUCH';
}
/** Closed-candle events at a level on its own TF and lower TFs after the formation closed. */
export function klEvents(core:Core,level:Pick<NearbyLevel,'id'|'lower'|'upper'>,last=2){
 const e=core.evidence.find(x=>x.id===level.id);if(!e)return null;
 const b=e.bounds??{lower:level.lower,upper:level.upper};
 const tf=e.timeframe as Tf,events:{tf:Tf;type:KlEventType;at:string}[]=[];
 for(const t of lowerOrSameTfs(tf)){const bars=core.frames[t].ohlc;
  for(let i=1;i<bars.length;i++){const x=bars[i];if(x.time<e.confirmed_at||bars[i-1].segment!==x.segment)continue;
   const type=classifyKlEvent(bars[i-1].close,x,b.lower,b.upper);if(type)events.push({tf:t,type,at:x.end});}}
 const own=events.filter(x=>x.tf===tf),counts={TOUCH:0,REJECTION:0,ACCEPTANCE:0,RAID:0};for(const x of own)counts[x.type]++;
 return {bounds_basis:'ORIGINAL' as const,own_tf_counts:counts,last:events.sort((a,c)=>c.at.localeCompare(a.at)||PA_TFS.indexOf(a.tf)-PA_TFS.indexOf(c.tf)).slice(0,last)};
}

/** Facts about the latest closed candles of a TF; flags stay NOT_EVALUATED until thresholds are approved. */
export function approach(core:Pick<PaEngine,'frames'>,tf:Tf,atr:number|null,levels:{above:NearbyLevel[];below:NearbyLevel[];at_price:NearbyLevel[]}|null,cfg=APPROACH_CONFIG){
 const bars=core.frames[tf].ohlc,n=bars.length;if(n<2)return null;
 const last=bars[n-1],sign=Math.sign(last.close-bars[n-2].close);
 let run=0;if(sign)for(let i=n-1;i>0&&bars[i].segment===bars[i-1].segment&&Math.sign(bars[i].close-bars[i-1].close)===sign;i--)run++;
 const move=Math.abs(last.close-bars[n-1-run].close),win=bars.slice(-cfg.window_bars);
 let overlaps=0;for(let i=1;i<win.length;i++){const a=win[i-1],c=win[i];if(Math.max(Math.min(a.open,a.close),Math.min(c.open,c.close))<Math.min(Math.max(a.open,a.close),Math.max(c.open,c.close)))overlaps++;}
 let contracting=0;for(let i=n-1;i>0&&n-i<cfg.window_bars&&bars[i].high-bars[i].low<bars[i-1].high-bars[i-1].low;i--)contracting++;
 const toward=levels?(levels.at_price[0]??(sign>0?levels.above[0]:sign<0?levels.below[0]:undefined)):undefined;
 const thresholds=[cfg.expansion_min_bars,cfg.expansion_min_move_atr_d1,cfg.compression_min_overlap_pairs,cfg.compression_min_contracting_bars];
 const moveAtr=atr?round(move/atr):null;
 let flag:'EXPANSION_NO_CORRECTION'|'COMPRESSION'|'NONE'|'NOT_EVALUATED'='NOT_EVALUATED';
 if(thresholds.every(x=>x!==null)&&moveAtr!==null)flag=run>=cfg.expansion_min_bars!&&moveAtr>=cfg.expansion_min_move_atr_d1!?'EXPANSION_NO_CORRECTION':overlaps>=cfg.compression_min_overlap_pairs!||contracting>=cfg.compression_min_contracting_bars!?'COMPRESSION':'NONE';
 return {through:last.end,closes:sign>0?'RISING' as const:sign<0?'FALLING' as const:'UNCHANGED' as const,bars_without_correction:run,move:round(move,10),move_atr_d1:moveAtr,
  window_bars:win.length,overlapping_body_pairs:overlaps,contracting_ranges:contracting,
  nearest_level_on_path:toward?{id:toward.id,kind:toward.kind,distance:toward.distance,at_price:levels!.at_price.includes(toward)}:null,
  flag,thresholds:thresholds.every(x=>x!==null)?'USER_APPROVED':'NEEDS_SPECIFICATION'};
}

/** THE EDGE «Strong High / Low (HRL)» facts, two separate flags (user decision 2026-11-23):
 * VC_AT_FRACTAL — an RB/SNR of the same TF, oriented away from the fractal, formed on one of its three candles;
 * RAIDED_PRIOR_FRACTAL — one of the fractal's candles was the first strict crossing of an earlier same-polarity fractal. */
export function strongFractals(core:Core,tf:Tf,cap=3){
 const own=core.evidence.filter(e=>e.timeframe===tf),rows=[];
 for(const f of own.filter(e=>e.kind==='FRACTAL')){
  const times=new Set(f.candle_evidence.map(c=>c.time)),polarity=f.facts.polarity;
  // VC oriented away from the fractal: bullish RB / support SNR at a low, bearish RB / resistance SNR at a high.
  const oriented=(e:Evidence)=>e.kind==='RB_TWO_CANDLE'?e.facts.direction===(polarity==='low'?'bullish':'bearish'):e.facts.proposed_role===(polarity==='low'?'support':'resistance');
  const vc=own.filter(e=>['RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(e.kind)&&oriented(e)&&e.candle_evidence.slice(0,2).some(c=>times.has(c.time)));
  const raided=own.filter(e=>e.kind==='RAID'&&e.facts.polarity===polarity&&e.facts.pivot_id!==f.id&&e.candle_evidence.some(c=>times.has(c.time)));
  if(!vc.length&&!raided.length)continue;
  rows.push({id:f.id,price:f.facts.price,confirmed_at:f.confirmed_at,state:f.lifecycle?.state??null,
   flags:[...(vc.length?['VC_AT_FRACTAL']:[]),...(raided.length?['RAIDED_PRIOR_FRACTAL']:[])],
   // Strong range = VC bounds on the VC timeframe (details via the evidence id).
   vc:vc.map(e=>({id:e.id,lower:e.bounds?.lower??null,upper:e.bounds?.upper??null})).slice(0,2),
   raided_fractal_ids:[...new Set(raided.map(e=>String(e.facts.pivot_id)))].slice(0,2)});
 }
 rows.sort((a,b)=>b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id));
 return {total:rows.length,items:rows.slice(0,cap),significance:'NOT_EVALUATED' as const};
}

/** Fractals of this TF inside a live KL of the same or next higher TF (THE EDGE IDM geometry «внутри POI»).
 * «возле POI» has no exact definition, so IDM itself stays NEEDS_SPECIFICATION. */
export function fractalsInsideKl(core:Core,tf:Tf,cap=3){
 const rows=core.evidence.filter(e=>e.timeframe===tf&&e.kind==='FRACTAL_INSIDE_POI').map(e=>({id:String(e.facts.pivot_id),kl_id:String(e.facts.poi_id),tf_relation:String(e.facts.tf_relation),price:Number(e.facts.price),confirmed_at:e.confirmed_at}))
  .sort((a,b)=>b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id));
 return {total:rows.length,items:rows.slice(0,cap),idm_status:'NEEDS_SPECIFICATION' as const};
}
