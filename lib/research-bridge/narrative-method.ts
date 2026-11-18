import type {buildIntelligence} from '../knowledge/intelligence';
export function compactNarrativeMethod(r:ReturnType<typeof buildIntelligence>,add:(id:string)=>string,tier:number){
 const m=r.narrative_method,group=(ids:string[],n=1)=>({items:ids.slice(0,n).map(add),total:ids.length,omitted:Math.max(0,ids.length-n)});
 const ordered=[...m.candidates].sort((a,b)=>Number(b.id===m.selected_id)-Number(a.id===m.selected_id)||Number(b.current_reaction)-Number(a.current_reaction)||(b.quality.score??0)-(a.quality.score??0)||a.id.localeCompare(b.id));
 const rows=ordered.slice(0,tier>=2?1:2);
 const boundary=(x:typeof rows[number]['C'])=>x?{...x,source_ids:x.source_ids.map(add)}:null;
 return {revision:m.revision,score_policy:m.score_policy,delivery_policy:m.delivery_policy,primary_context:m.primary_context,mn1_w1_conflict:m.mn1_w1_conflict,
  contexts:m.contexts.map(c=>({timeframe:c.timeframe,position:c.position})),selection_status:m.selection_status,automatic_confirmation:false,probability:null,
  candidates:{items:rows.map(c=>({selected:c.id===m.selected_id,A:{...c.A,source_ids:c.A.source_ids.map(add)},direction:c.direction,current_reaction:c.current_reaction,
   quality:{score:c.quality.score,factors:c.quality.factors,hold_episodes:c.quality.hold_episodes,anchor_position:c.quality.anchor_position},
   delivery:c.delivery?(()=>{const {opposing_ids,...facts}=c.delivery;return {...facts,opposing:group(opposing_ids)};})():null,
   B:c.B?{level:add(c.B.id),timeframe:c.B.timeframe,price:c.B.price,confirmed_at:c.B.confirmed_at}:null,target_count:c.target_count,obstacles:group(c.obstacle_ids),
   C:boundary(c.C),entry_stop:boundary(c.entry_stop),rr:c.rr,entry_status:c.entry_status,narrative_status:c.narrative_status,confirmed_narrative:null,review_required:true})),total:m.candidates.length,omitted:m.candidates.length-rows.length}};
}
