import {PA_TFS,type PaEngine} from './report';

/** Geometric / closed-candle facts added to the brief. No significance, direction or trade field. */
type Tf=(typeof PA_TFS)[number];
type Core=Pick<PaEngine,'frames'|'evidence'>;
type Evidence=PaEngine['evidence'][number];
const round=(x:number,d=4)=>Number(x.toFixed(d));
const higherTfs=(tf:Tf)=>PA_TFS.slice(0,PA_TFS.indexOf(tf));
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
