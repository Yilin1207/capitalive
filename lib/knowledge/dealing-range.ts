import type {Frame} from './data';
import {TF_ORDER,selectRange,type Pivot,type KeyLevel,type Range} from './detectors';

export type DirectionalRange=Range&{direction:'Bullish'|'Bearish';start_id:string;end_id:string;start_at:string;end_at:string};
const pivotAt=(p:Pivot)=>String(p.facts.pivot_time??p.candle_evidence[1]?.time??p.origin);
function pair(frame:Frame,a:Pivot,b:Pivot):DirectionalRange|null{
  if(pivotAt(a)>=pivotAt(b)||a.polarity===b.polarity)return null;
  const high=a.polarity==='high'?a:b,low=a.polarity==='low'?a:b;
  const range=selectRange(frame,[high,low],{high_id:high.id,low_id:low.id}).range;
  if(!range)return null;
  // Endpoints must enclose the movement, not just two arbitrarily paired pivots.
  if(frame.bars.some(c=>c.segment===a.segment&&c.time>=pivotAt(a)&&c.time<=pivotAt(b)&&(c.high>high.price||c.low<low.price)))return null;
  return {...range,origin:pivotAt(a),direction:a.polarity==='low'?'Bullish':'Bearish',start_id:a.id,end_id:b.id,start_at:pivotAt(a),end_at:pivotAt(b)};
}

/** User-confirmed DR rules, 2026-11-17. Process confirmed pivots chronologically.
 * An internal pivot cannot reset an outer boundary. A fresh extreme extends
 * the range; a confirmed opposite outer extreme establishes the opposite leg.
 * Wick raids alone are observations, never automatic Narrative confirmation. */
export function detectDealingRange(frame:Frame,pivots:Pivot[],levels:KeyLevel[]=[]){
  const last=frame.bars.at(-1),eligible=pivots.filter(p=>p.variant===3&&p.segment===last?.segment&&p.confirmed_at<=frame.as_of&&p.candle_evidence.every(c=>c.closed_at<=p.confirmed_at))
    .sort((a,b)=>a.confirmed_at.localeCompare(b.confirmed_at)||pivotAt(a).localeCompare(pivotAt(b))||a.id.localeCompare(b.id));
  let seed:Pivot|null=null,current:DirectionalRange|null=null;
  const byId=new Map(eligible.map(p=>[p.id,p]));
  const originContext=(p:Pivot)=>levels.filter(l=>l.qualified&&TF_ORDER.indexOf(l.timeframe)<=TF_ORDER.indexOf(frame.timeframe)&&l.confirmed_at<=pivotAt(p)&&
    (!l.invalidated_at||l.invalidated_at>p.confirmed_at)&&l.source_finding.id!==p.id&&
    l.role===(p.polarity==='low'?'support':'resistance')&&p.candle_evidence.some(c=>c.time>=l.confirmed_at&&c.high>=l.lower&&c.low<=l.upper)&&
    (p.polarity==='low'?p.candle_evidence.at(-1)!.close>l.upper:p.candle_evidence.at(-1)!.close<l.lower)&&
    !(l.kind==='FVG'&&l.timeframe===frame.timeframe&&frame.bars.some(c=>c.time>=l.confirmed_at&&c.end<=pivotAt(p)&&(l.role==='support'?c.close<l.lower:c.close>l.upper))));
  const parentRanges:DirectionalRange[]=[];
  let currentContext:string[]=[];
  const transitions:{kind:string;at:string;high_id:string;low_id:string;previous_high_id:string|null;previous_low_id:string|null}[]=[];
  for(const p of eligible){
    if(!current){
      if(!seed){seed=p;continue;}
      if(pivotAt(seed)===pivotAt(p)){seed=null;continue;} // Outside-bar high/low has no known intrabar ordering.
      if(seed.polarity===p.polarity){if(p.polarity==='low'?p.price<seed.price:p.price>seed.price)seed=p;continue;}
      const proposed=pair(frame,seed,p);
      if(!proposed){seed=p;continue;}
      current=proposed;transitions.push({kind:'ESTABLISHED',at:current.confirmed_at,high_id:current.high_id,low_id:current.low_id,previous_high_id:null,previous_low_id:null});continue;
    }
    if(pivotAt(p)<=current.end_at)continue;
    const extendsHigh=p.polarity==='high'&&p.price>current.upper,extendsLow=p.polarity==='low'&&p.price<current.lower;
    if(!extendsHigh&&!extendsLow)continue;
    let start=byId.get(extendsHigh?current.low_id:current.high_id)!;
    // Exception: a completed correction at an existing KL can start a fresh
    // local range when its expansion exceeds the prior terminal extreme.
    // Keep the parent; a mere internal fractal or wick intersection is insufficient.
    const localOrigin=eligible.filter(q=>q.polarity!==p.polarity&&pivotAt(q)>current!.end_at&&q.confirmed_at<=p.confirmed_at&&pivotAt(q)<pivotAt(p)&&originContext(q).length&&pair(frame,q,p))
      .sort((a,b)=>extendsHigh?a.price-b.price||pivotAt(b).localeCompare(pivotAt(a)):b.price-a.price||pivotAt(b).localeCompare(pivotAt(a)))[0];
    if(localOrigin)start=localOrigin;
    const proposed=pair(frame,start,p);if(!proposed)continue;
    if(localOrigin){parentRanges.push(current);currentContext=originContext(localOrigin).map(l=>l.id);}
    else if(proposed.direction!==current.direction)currentContext=[];
    transitions.push({kind:localOrigin?'KL_ORIGIN_NEW_RANGE':proposed.direction===current.direction?'EXPANDED':'OPPOSITE_LEG_ESTABLISHED',at:proposed.confirmed_at,high_id:proposed.high_id,low_id:proposed.low_id,previous_high_id:current.high_id,previous_low_id:current.low_id});
    current=proposed;
  }
  const after=current?frame.bars.filter(b=>b.segment===current!.segment&&b.end>=current!.confirmed_at):[];
  const closeBreak=current?after.find(b=>b.close<current!.lower||b.close>current!.upper):undefined;
  const wick=current?after.filter(b=>b.high>current!.upper||b.low<current!.lower):[];
  const status=!current?'AWAITING_CONFIRMED_PAIR':closeBreak?'AWAITING_NEW_EXTREME':'ESTABLISHED';
  const localCandidates:{range:DirectionalRange;parent_high_id:string;parent_low_id:string;context_ids:string[];review_required:true}[]=[];
  if(current){
    const internal=eligible.filter(p=>pivotAt(p)>current!.start_at&&p.price>current!.lower&&p.price<current!.upper&&p.id!==current!.high_id&&p.id!==current!.low_id);
    for(let i=0;i<internal.length-1;i++){
      const a=internal[i],b=internal[i+1],range=pair(frame,a,b);if(!range)continue;
      // A local exception needs a causally available KL interaction, never merely "inside DR".
      const context=originContext(a);
      if(!context.length||frame.bars.some(c=>c.time>=range.confirmed_at&&c.segment===range.segment&&(c.close<range.lower||c.close>range.upper)))continue;
      localCandidates.push({range,parent_high_id:current.high_id,parent_low_id:current.low_id,context_ids:context.map(l=>l.id),review_required:true});
    }
  }
  return {revision:'dr-sequence-1',status,current,automatic_selection:!!current,selection_scope:'OUTER_RANGE_IN_OBSERVED_CONTIGUOUS_HISTORY',
    reason:!current?'BOTH_CHRONOLOGICAL_FRACTAL3_BOUNDARIES_REQUIRED':closeBreak?'CLOSED_BOUNDARY_BREAK_WAIT_FOR_CONFIRMED_EXTREME':'CHRONOLOGICAL_EXTREMES_ESTABLISHED',
    close_break_at:closeBreak?.end??null,last_wick_raid_at:wick.at(-1)?.end??null,
    premium_discount:status==='ESTABLISHED'&&current&&last?(last.close<current.equilibrium?'DISCOUNT':last.close>current.equilibrium?'PREMIUM':'EQUILIBRIUM'):null,
    internal_fractal_ids:current?eligible.filter(p=>pivotAt(p)>current!.start_at&&p.price>current!.lower&&p.price<current!.upper&&p.id!==current!.high_id&&p.id!==current!.low_id).map(p=>p.id):[],
    internal_classification:'INTERNAL_LIQUIDITY_NOT_AUTOMATIC_IDM',local_candidates:localCandidates,parent_ranges:parentRanges,origin_context_ids:currentContext,transitions,
    significance:'REVIEW_REQUIRED',narrative_confirmed:false};
}

export function selectTopDownRange(rows:{timeframe:string;dr_detection:ReturnType<typeof detectDealingRange>}[]){
  const ordered=TF_ORDER.map(tf=>rows.find(f=>f.timeframe===tf)).filter((f):f is typeof rows[number]=>!!f);
  const selected=ordered.find(f=>f.dr_detection.status==='ESTABLISHED');
  return {timeframe:selected?.timeframe??null,reason:selected?'FIRST_ESTABLISHED_DR_FROM_MN1_TO_H4':'NO_ESTABLISHED_DR',
    skipped:ordered.slice(0,selected?ordered.indexOf(selected):ordered.length).map(f=>({timeframe:f.timeframe,reason:f.dr_detection.reason})),narrative_confirmed:false};
}
