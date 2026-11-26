import type {Timeframe} from '../candle-data';
import type {Bar} from '../knowledge/data';
import {remainingBounds} from '../knowledge/fvg-remaining';
import {approach, atrD1, classifyKlEvent, type KlEventType} from './brief-facts';
import type {PaEngine, PaEvidence} from './core';
import {activeThesisRange} from './thesis-location';
import {THESIS_OBSERVATION_CONFIG} from './thesis-observation-config';

const TIMEFRAMES = ['MN1','W1','D1','H4'] as const;
type ObservedTf = 'D1' | 'W1';
export type ThesisEventSection = 'kl_events'|'new_rb'|'new_snr'|'new_fractal3'|'strong_near_price';
const ITEM_LIMIT = 3;
const round = (value:number) => Number(value.toFixed(6));
const ratio = (value:number, unit:number|null) => unit && unit>0 ? round(value/unit) : null;
const bounded = <T>(items:T[],limit=ITEM_LIMIT) => ({total:items.length, items:items.slice(0,limit)});
const latest = (a:{at:string;id:string}, b:{at:string;id:string}) => b.at.localeCompare(a.at)||a.id.localeCompare(b.id);
const fractal = (e:PaEvidence) => e.kind==='FRACTAL' && e.facts.variant===3;
const pivotTime = (e:PaEvidence) => String(e.facts.pivot_time ?? e.candle_evidence[1]?.time);
const knownKinds = new Set(['FRACTAL','FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK']);

function segmentBars(core:PaEngine, tf:Timeframe) {
  const bars=core.frames[tf].ohlc;
  return bars.filter(b=>b.segment===bars.at(-1)?.segment);
}

function strength(core:PaEngine, tf:ObservedTf, bars:Bar[], window:Bar[], recent:PaEvidence[], atr:number|null) {
  const first=window[0], last=window.at(-1);
  const change=first && last ? last.close-first.open : 0;
  const direction=change>0?'bullish':change<0?'bearish':null;
  const fvg=recent.filter(e=>e.kind==='FVG');
  const bullish=fvg.filter(e=>e.facts.direction==='bullish').length;
  const bearish=fvg.filter(e=>e.facts.direction==='bearish').length;
  const avgBody=(group:Bar[]) => group.length===5 ? ratio(group.reduce((n,b)=>n+Math.abs(b.close-b.open),0)/5,atr) : null;
  const measured=approach(core,tf,atr,null,{window_bars:window.length,expansion_min_bars:null,expansion_min_move_atr_d1:null,compression_min_overlap_pairs:null,compression_min_contracting_bars:null});
  const own=core.evidence.filter(e=>e.timeframe===tf && fractal(e) && bars[0] && pivotTime(e)>=bars[0].time && last && e.confirmed_at<=last.end)
    .sort((a,b)=>b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id));
  // An outside candle can confirm both a high and a low at once. It has no unique latest swing.
  const swing=own[0] && own[0].confirmed_at!==own[1]?.confirmed_at ? own[0] : null;
  return {
    from:first?.time??null, through:last?.end??null, bars:window.length,
    move_direction:direction, new_fvg_count:{bullish,bearish,with_move:direction==='bullish'?bullish:direction==='bearish'?bearish:null,against_move:direction==='bullish'?bearish:direction==='bearish'?bullish:null},
    avg_body_atr:{last5:avgBody(bars.slice(-5)),prev5:avgBody(bars.slice(-10,-5))},
    overlap_ratio:window.length>=2 && measured ? round(measured.overlapping_body_pairs/(window.length-1)) : null,
    fractals_formed:recent.filter(fractal).length,
    bars_without_correction:bars.length>=2 ? measured?.bars_without_correction??null : null,
    last_swing:swing?{id:swing.id,price:Number(swing.facts.price),polarity:swing.facts.polarity,confirmed_at:swing.confirmed_at}:null,
    move_atr:swing && last ? ratio(Math.abs(last.close-Number(swing.facts.price)),atr) : null
  };
}

// Reduce FVG bounds using only wick observations that had closed by each event's open.
function fvgHistory(core:PaEngine, e:PaEvidence) {
  const bounds=e.bounds!;
  const width=bounds.upper-bounds.lower;
  const observations=TIMEFRAMES.slice(TIMEFRAMES.indexOf(e.timeframe)).flatMap(tf=>core.frames[tf].ohlc.filter(
    b=>b.time>=e.confirmed_at && b.high>=bounds.lower && b.low<=bounds.upper
  )).sort((a,b)=>a.end.localeCompare(b.end));
  let max=0;
  const steps:{at:string;fraction:number}[]=[];
  for(const b of observations) {
    const depth=e.formation_role==='support' ? bounds.upper-b.low : b.high-bounds.lower;
    const fraction=Math.min(1,depth/width);
    if(fraction>max) { max=fraction; steps.push({at:b.end,fraction}); }
    if(max===1) break;
  }
  return steps;
}

function validDuring(e:PaEvidence, b:Bar) {
  const s=e.lifecycle;
  if(!s || !e.bounds || b.time<e.confirmed_at || b.end>s.continuity_end) return false;
  if(s.invalidated_at && s.invalidated_at<b.end) return false;
  if(e.kind==='FRACTAL' && s.first_raid && s.first_raid.confirmed_at<b.end) return false;
  const filledAt=s.fill?.fully_tested_at;
  return !filledAt || filledAt>=b.end;
}

function observedContact(e:PaEvidence,bars:Bar[],i:number,bounds:{lower:number;upper:number}):{type:KlEventType;from:'above'|'below'}|null {
  const {lower,upper}=bounds, b=bars[i], previous=bars[i-1].close;
  const intersects=b.high>=lower && b.low<=upper;
  if(previous<lower || previous>upper) {
    if(!intersects) return null;
    const type=classifyKlEvent(previous,b,lower,upper);
    return type?{from:previous<lower?'below':'above',type:type==='RAID' && e.kind!=='FRACTAL'?'REJECTION':type}:null;
  }
  // A close inside establishes contact. An exit may gap past the edge without trading inside again.
  let from:'above'|'below'=e.formation_role==='support'?'above':'below';
  for(let j=i-2;j>=0 && bars[j].end>=e.confirmed_at;j--) {
    if(bars[j].close<lower) { from='below'; break; }
    if(bars[j].close>upper) { from='above'; break; }
  }
  if(from==='above' ? b.close<lower : b.close>upper) return {from,type:'ACCEPTANCE'};
  if(from==='above' ? b.close>upper : b.close<lower) {
    if(lower!==upper || e.kind!=='FRACTAL') return {from,type:'REJECTION'};
    if(intersects) return {from,type:(from==='above'?b.low<lower:b.high>upper)?'RAID':'TOUCH'};
    return null;
  }
  return {from,type:'TOUCH'};
}

function keyLevelEvents(core:PaEngine, tf:ObservedTf, bars:Bar[], window:Bar[], limit=ITEM_LIMIT) {
  const rows:{id:string;tf:ObservedTf;level_tf:Timeframe;level_kind:string;type:KlEventType;at:string;from:'above'|'below';lower:number;upper:number}[]=[];
  const start=bars.length-window.length;
  for(const e of core.evidence) {
    if(!knownKinds.has(e.kind) || !e.bounds || TIMEFRAMES.indexOf(e.timeframe)>TIMEFRAMES.indexOf(tf)) continue;
    let history:ReturnType<typeof fvgHistory>|undefined;
    for(let i=Math.max(1,start);i<bars.length;i++) {
      const b=bars[i];
      const previous=bars[i-1].close;
      if(!validDuring(e,b) || ((b.high<e.bounds.lower || b.low>e.bounds.upper) && (previous<e.bounds.lower || previous>e.bounds.upper))) continue;
      let bounds:PaEvidence['bounds']=e.bounds;
      if(e.kind==='FVG') {
        history??=fvgHistory(core,e);
        const prior=history.filter(s=>s.at<=b.time).at(-1)?.fraction??0;
        bounds=remainingBounds({...bounds,role:e.formation_role!},prior);
        if(!bounds) continue;
      }
      const observed=observedContact(e,bars,i,bounds);
      if(!observed) continue;
      rows.push({id:e.id,tf,level_tf:e.timeframe,level_kind:e.kind,...observed,at:b.end,...bounds});
    }
  }
  return bounded(rows.sort(latest),limit);
}

type StrongProof = {
  id:string;tf:Timeframe;kind:string;polarity:'high'|'low';strong:true;reason:'RAID_THEN_RB'|'RAID_THEN_SNR'|'TESTED_MONTHLY_SNR_IN_DISCOUNT'|'TESTED_MONTHLY_SNR_IN_PREMIUM';
  at:string;evidence_ids:string[];price:number;test_tf?:Timeframe;test_at?:string
};

function fractalProofs(core:PaEngine) {
  const proofs=new Map<string,StrongProof>();
  const byId=new Map(core.evidence.map(e=>[e.id,e]));
  const raids=new Map<string,PaEvidence[]>(), confirmations=new Map<string,PaEvidence[]>();
  function add(map:Map<string,PaEvidence[]>,e:PaEvidence,time:string|undefined) {
    if(!time) return;
    const key=e.timeframe+time, bucket=map.get(key);
    if(bucket) bucket.push(e); else map.set(key,[e]);
  }
  for(const e of core.evidence) {
    if(e.kind==='RAID') add(raids,e,e.candle_evidence[0]?.time);
    if(e.kind==='RB_TWO_CANDLE') add(confirmations,e,e.candle_evidence[0]?.time);
    if(e.kind==='SNR_CLOSED_BREAK') {
      // Link to the origin pair or the recorded delivery. A breakout alone cannot establish the link.
      const delivery=(e.facts.formation as {delivery_at?:string|null}|undefined)?.delivery_at;
      const times=new Set(e.candle_evidence.slice(0,2).map(c=>c.time));
      const delivered=e.candle_evidence.find(c=>c.closed_at===delivery);
      if(delivered) times.add(delivered.time);
      for(const time of times) add(confirmations,e,time);
    }
  }
  const monthly=core.evidence.filter(e=>e.timeframe==='MN1' && e.kind==='SNR_CLOSED_BREAK' && e.formation_status==='CONFIRMED');
  for(const f of core.evidence) {
    if(!fractal(f) || (f.timeframe!=='W1' && f.timeframe!=='D1')) continue;
    const time=pivotTime(f), key=f.timeframe+time;
    for(const raid of raids.get(key)??[]) {
      const prior=byId.get(String(raid.facts.pivot_id));
      if(!prior || !fractal(prior) || prior.id===f.id || prior.timeframe!==f.timeframe || prior.confirmed_at>time ||
        prior.facts.polarity!==f.facts.polarity || raid.facts.polarity!==f.facts.polarity) continue;
      if(!prior.lifecycle || prior.lifecycle.continuity_end<raid.confirmed_at || (prior.lifecycle.first_raid && prior.lifecycle.first_raid.time<time)) continue;
      const low=f.facts.polarity==='low';
      const vc=(confirmations.get(key)??[]).filter(e=>e.confirmed_at>raid.confirmed_at && (
        e.kind==='RB_TWO_CANDLE'? e.facts.direction===(low?'bullish':'bearish') : e.facts.proposed_role===(low?'support':'resistance')
      )).sort((a,b)=>a.confirmed_at.localeCompare(b.confirmed_at)||a.id.localeCompare(b.id))[0];
      if(!vc) continue;
      const at=vc.confirmed_at>f.confirmed_at?vc.confirmed_at:f.confirmed_at;
      proofs.set(f.id,{id:f.id,tf:f.timeframe,kind:'FRACTAL',polarity:low?'low':'high',strong:true,reason:vc.kind==='RB_TWO_CANDLE'?'RAID_THEN_RB':'RAID_THEN_SNR',
        at,evidence_ids:[f.id,prior.id,raid.id,vc.id],price:Number(f.facts.price)});
      break;
    }
    if(!proofs.has(f.id) && monthly.length) {
      const alternative=monthlyProof(core,f,monthly);
      if(alternative) proofs.set(f.id,alternative);
    }
  }
  return proofs;
}

function monthlyProof(core:PaEngine, pivot:PaEvidence, monthly:PaEvidence[]):StrongProof|null {
  const price=Number(pivot.facts.price), low=pivot.facts.polarity==='low';
  const bars=core.frames[pivot.timeframe].ohlc;
  const index=bars.findIndex(b=>b.time===pivotTime(pivot)), b=bars[index], previous=bars[index-1];
  if(!b || !previous || previous.segment!==b.segment || price!==(low?b.low:b.high)) return null;
  for(const zone of monthly) {
    if(!zone.bounds || zone.facts.proposed_role!==(low?'support':'resistance') || !validDuring(zone,b) ||
        (zone.lifecycle?.invalidated_at && zone.lifecycle.invalidated_at<=b.end)) continue;
    const {lower,upper}=zone.bounds;
    if(price<lower || price>upper || (low ? previous.close<=upper || b.close<lower : previous.close>=lower || b.close>upper)) continue;
    const range=activeThesisRange(core,'MN1',b.time,price);
    if(!range || (low ? upper>=range.eq || lower<range.low : lower<=range.eq || upper>range.high)) continue;
    return {id:pivot.id,tf:pivot.timeframe,kind:pivot.kind,polarity:low?'low':'high',strong:true,reason:low?'TESTED_MONTHLY_SNR_IN_DISCOUNT':'TESTED_MONTHLY_SNR_IN_PREMIUM',
      at:pivot.confirmed_at,test_tf:pivot.timeframe,test_at:b.end,evidence_ids:[pivot.id,zone.id,range.low_id,range.high_id],price};
  }
  return null;
}

function strongNearPrice(core:PaEngine, fractals:Map<string,StrongProof>, atr:number|null, limit=ITEM_LIMIT) {
  const ref=core.frames.H4.ohlc.at(-1);
  const rows:(StrongProof&{distance:number;distance_atr_d1:number|null})[]=[];
  if(ref) for(const e of core.evidence) {
    if(!e.lifecycle || e.confirmed_at>ref.end || e.lifecycle.continuity_end<ref.end || (e.lifecycle.invalidated_at && e.lifecycle.invalidated_at<=ref.end)) continue;
    if(e.lifecycle.first_raid && e.lifecycle.first_raid.confirmed_at<=ref.end) continue;
    const proof=fractals.get(e.id);
    if(!proof || proof.at>ref.end) continue;
    const distance=round(Math.abs(proof.price-ref.close));
    rows.push({...proof,distance,distance_atr_d1:ratio(distance,atr)});
  }
  return {reference:ref?{price:ref.close,at:ref.end}:null,...bounded(rows.sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id)),limit)};
}

function formations(recent:PaEvidence[], proofs:Map<string,StrongProof>, limit=ITEM_LIMIT) {
  const rows=recent.map(e=>({e,id:e.id,at:e.confirmed_at})).sort(latest);
  const base=(e:PaEvidence)=>({id:e.id,tf:e.timeframe,at:e.confirmed_at});
  function unique(kind:string) {
    const groups=new Map<string,{e:PaEvidence;context_count:number}>();
    for(const {e} of rows) {
      if(e.kind!==kind) continue;
      const key=JSON.stringify([e.origin,e.confirmed_at,e.bounds,e.facts.rb_type,e.facts.direction,e.facts.after_kl_delivery]);
      const group=groups.get(key);
      if(group) group.context_count++;
      else groups.set(key,{e,context_count:1});
    }
    return [...groups.values()];
  }
  const rb=unique('RB_TWO_CANDLE').map(({e,context_count})=>({...base(e),rb_type:e.facts.rb_type,direction:e.facts.direction,kl_id:e.facts.kl_id,context_count}));
  const snr=unique('SNR_CLOSED_BREAK').map(({e,context_count})=>({...base(e),side:e.facts.side,after_kl_delivery:e.facts.after_kl_delivery,kl_id:e.facts.kl_id,context_count}));
  const pivots=rows.filter(({e})=>fractal(e)).map(({e})=>{
    const p=proofs.get(e.id);
    return {...base(e),polarity:e.facts.polarity,price:e.facts.price,strong:!!p,...(p?{reason:p.reason,strong_at:p.at,evidence_ids:p.evidence_ids}:{})};
  });
  return {new_rb:bounded(rb,limit),new_snr:bounded(snr,limit),new_fractal3:bounded(pivots,limit)};
}

function observationWindow(core:PaEngine,tf:ObservedTf,windowBars:number) {
  const bars=segmentBars(core,tf), window=bars.slice(-windowBars);
  const start=window[0]?.time, end=window.at(-1)?.end;
  const recent=core.evidence.filter(e=>e.timeframe===tf && start && end && e.confirmed_at>start && e.confirmed_at<=end);
  return {bars,window,recent};
}

function dailyAtr(core:PaEngine) {
  return segmentBars(core,'D1').length>=15 ? atrD1(core)?.value??null : null;
}

/** The unabridged section in exactly the brief's order, for snapshot-pinned pagination. */
export function eventItems(core:PaEngine,tf:ObservedTf,section:ThesisEventSection) {
  if(section==='strong_near_price') return strongNearPrice(core,fractalProofs(core),dailyAtr(core),Infinity).items;
  const {bars,window,recent}=observationWindow(core,tf,THESIS_OBSERVATION_CONFIG.window_bars);
  if(section==='kl_events') return keyLevelEvents(core,tf,bars,window,Infinity).items;
  const proofs=section==='new_fractal3'?fractalProofs(core):new Map<string,StrongProof>();
  return formations(recent,proofs,Infinity)[section].items;
}

export function thesisObservations(core:PaEngine, windowBars=THESIS_OBSERVATION_CONFIG.window_bars) {
  if(!Number.isSafeInteger(windowBars)||windowBars<1) throw new RangeError('windowBars must be a positive integer');
  const atr=dailyAtr(core);
  const proofs=fractalProofs(core);
  function observe(tf:ObservedTf) {
    const {bars,window,recent}=observationWindow(core,tf,windowBars);
    return {
      strength:strength(core,tf,bars,window,recent,atr),
      opposite:{kl_events:keyLevelEvents(core,tf,bars,window),...formations(recent,proofs)}
    };
  }
  const daily=observe('D1'),weekly=observe('W1');
  return {
    strength:{window_bars:windowBars,thresholds:'NEEDS_SPECIFICATION' as const,D1:daily.strength,W1:weekly.strength},
    opposite_side:{window_bars:windowBars,per_list_limit:ITEM_LIMIT,D1:daily.opposite,W1:weekly.opposite,strong_near_price:strongNearPrice(core,proofs,atr)}
  };
}
