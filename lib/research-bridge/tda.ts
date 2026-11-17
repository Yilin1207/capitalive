import type {buildIntelligence} from '../knowledge/intelligence';
/** Explicitly counted projection, never ranks POI significance or invents a scenario. */
export function compactTda(r:ReturnType<typeof buildIntelligence>,add:(id:string)=>string,tier:number){
 const group=(ids:string[],limit:number)=>({items:ids.slice(0,limit).map(add),total:ids.length,omitted:Math.max(0,ids.length-limit)});
 const selected=r.narrative.A?.id,all=r.tda.anchors.filter(a=>a.eligible_as_poi);
 const ordered=[...all].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||Number(b.context==='PRICE_AT_POI')-Number(a.context==='PRICE_AT_POI')||(b.last_contact_at??'').localeCompare(a.last_contact_at??'')||a.id.localeCompare(b.id));
 const limit=tier>=3?1:3,rows=ordered.slice(0,limit),detail=tier>=5?0:tier>=3?1:2;
 return {revision:r.tda.revision,scope:r.tda.scope,target_policy:r.tda.target_policy,trigger_policy:r.tda.trigger_policy,automatic_narrative_confirmation:false,
  selected_anchor:selected?add(selected):null,unavailable_timeframes:r.tda.unavailable_timeframes,
  anchors:{items:rows.map(a=>({level:add(a.id),eligible_as_poi:true,liquidity_available:a.liquidity_available,context:a.context,last_contact_at:a.last_contact_at,review_required:true,
   vc:group(a.vc_ids,detail),vc_timeframe:a.vc_timeframe,vc_status:a.vc_status,triggers:group(a.trigger_ids,detail),
   refinements:{items:a.refinements.slice(0,detail).map(x=>({trigger:add(x.trigger_id),confirmed_at:x.confirmed_at,vc:group(x.vc_ids,detail),vc_timeframe:x.vc_timeframe,status:x.status,parent_confirmation_required:false})),total:a.refinements.length,omitted:Math.max(0,a.refinements.length-detail)},
   range:a.range?{timeframe:a.range.timeframe,high:add(a.range.high_id),low:add(a.range.low_id),confirmed_at:a.range.confirmed_at}:null,premium_discount:a.premium_discount,opposing:group(a.opposing_ids,detail),delivery:a.delivery,limitations:a.limitations})),total:all.length,omitted:all.length-rows.length},
  range_pois:r.tda.range_pois.map(q=>({timeframe:q.timeframe,high:add(q.high_id),low:add(q.low_id),confirmed_at:q.confirmed_at,directional_anchor:false,triggers:group(q.trigger_ids,tier>=3?0:1),review_required:true})),
  potential_target:r.target_selection.candidate_target?add(r.target_selection.candidate_target.id):null,target_status:r.target_selection.candidate_status,path_completeness:r.target_selection.path_completeness,free_path_proven:false,probability:null};
}
