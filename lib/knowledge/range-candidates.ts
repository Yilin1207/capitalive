import {type Pivot,type KeyLevel} from './detectors';import type {Frame} from './data';
import {detectDealingRange} from './dealing-range';
/** Sequential outer range plus explicitly KL-linked local candidates.
 * Candidate enumeration never certifies trading significance or Narrative. */
export function rangeCandidates(frame:Frame,pivots:Pivot[],levels:KeyLevel[]=[]){
 const detection=detectDealingRange(frame,pivots,levels);
 const candidates=[...(detection.status==='ESTABLISHED'&&detection.current?[{...detection.current,review_required:true as const,basis:'SEQUENTIAL_OUTER_DR_SIGNIFICANCE_REQUIRES_REVIEW'}]:[]),
  ...detection.local_candidates.map(c=>({...c.range,review_required:true as const,basis:'KL_REACTION_LOCAL_DR_REQUIRES_REVIEW'}))];
 return {status:candidates.length?'REVIEW_REQUIRED':'UNAVAILABLE',candidates,selected:null,automatic_selection:false,reason:'OUTER_RANGE_AND_KL_LINKED_LOCAL_CANDIDATES_ONLY'};
}
