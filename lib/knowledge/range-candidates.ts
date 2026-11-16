import {assessRange,selectRange,type Pivot} from './detectors';import type {Frame} from './data';
/** Exhaustive geometric candidates within observed continuous history. Significance
 * and impulse origin are qualitative author conditions: no automatic macro DR. */
export function rangeCandidates(frame:Frame,pivots:Pivot[]){
 const last=frame.bars.at(-1),eligible=pivots.filter(p=>p.variant===3&&p.segment===last?.segment&&p.confirmed_at<=frame.as_of);
 const candidates=[];
 for(const high of eligible.filter(p=>p.polarity==='high'))for(const low of eligible.filter(p=>p.polarity==='low')){
  const {range}=selectRange(frame,[high,low],{high_id:high.id,low_id:low.id});
  if(!range||!last||last.close<range.lower||last.close>range.upper||assessRange(frame,range).state!=='ACTIVE')continue;
  candidates.push({...range,review_required:true as const,basis:'CONFIRMED_FRACTAL3_GEOMETRY_NOT_AUTHOR_SIGNIFICANCE' as const});
 }
 candidates.sort((a,b)=>b.confirmed_at.localeCompare(a.confirmed_at)||a.high_id.localeCompare(b.high_id)||a.low_id.localeCompare(b.low_id));
 return {status:candidates.length?'REVIEW_REQUIRED':'UNAVAILABLE',candidates,selected:null,automatic_selection:false,reason:'AUTHOR_IMPULSE_ORIGIN_AND_SIGNIFICANT_EXTREME_REQUIRE_REVIEW'};
}
