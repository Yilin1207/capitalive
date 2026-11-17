import type {buildIntelligence} from '../knowledge/intelligence';
type Intelligence=ReturnType<typeof buildIntelligence>;

/** Bounded presentation; all omissions are counted and recoverable by snapshot inspection. */
export function compactResearchContext(r:Intelligence,add:(id:string)=>string,contextLimit=1,reduced=false){
  const c=r.research_context;
  const group=(ids:string[],limit=contextLimit)=>({items:ids.slice(0,limit).map(add),total:ids.length,omitted:Math.max(0,ids.length-limit)});
  const levels=c.executive_ids.slice(0,reduced?4:32).map(id=>c.levels.find(l=>l.id===id)!);
  const targetIds=[...new Set([...(r.target_selection.selected_candidate?[r.target_selection.selected_candidate.id]:[]),...r.target_selection.target_candidates.filter(t=>t.role_eligible).sort((a,b)=>{
    const f=(id:string)=>r.frames.flatMap(f=>f.findings).find(f=>f.id===id)?.confirmed_at??'';
    return f(b.id).localeCompare(f(a.id))||a.id.localeCompare(b.id);
  }).map(t=>t.id)])].slice(0,3);
  return {revision:'context-5.1',review_required:true,author_structure:c.author_structure,
    dealing_range_selection:c.dealing_range_selection,
    candidate_narrative:c.candidate_narrative,confirmed_narrative:c.confirmed_narrative,
    observed_price_behaviour:c.observed_price_behaviour.map(o=>({...o,evidence_ids:o.evidence_ids.map(add),last_observed_fractal_leg:o.last_observed_fractal_leg?{...o.last_observed_fractal_leg,from_id:add(o.last_observed_fractal_leg.from_id),to_id:add(o.last_observed_fractal_leg.to_id)}:null})),
    executive_evidence:{items:levels.map(l=>({level:add(l.id),review_status:l.review_status,human_validated:false,
      current_role:l.lifecycle_explanation.current_role,current_role_status:l.lifecycle_explanation.current_role_status,
      role_transition_candidate:l.lifecycle_explanation.role_transition_candidate,reference_position:l.lifecycle_explanation.reference_position,
      first_interaction_at:l.lifecycle_explanation.first_interaction_at,first_interaction_scope:l.lifecycle_explanation.first_interaction_scope,
      structural_relevance:l.lifecycle_explanation.structural_relevance,reference_transition:l.reference_transition,full_test_status:l.full_test_status,
      htf_dependencies:group(l.htf_dependencies),interactions:group(l.interactions.map(x=>x.id)),
      relevance_reasons:l.relevance_reasons,uncertainty:l.uncertainty,lifecycle_reasons:l.lifecycle_explanation.reasons,invalidation:l.invalidation})),
      total:c.levels.length,omitted:c.levels.length-levels.length,selection_policy:c.selection_policy},
    conflicts:c.conflicts.map(x=>({...x,level_id:add(x.level_id),evidence_ids:x.evidence_ids.map(add)})),
    dealing_range_reviews:c.dealing_range_reviews.map(f=>{
      const candidates=[...f.candidates].sort((a,b)=>Number(b.validation.candidate_suitable_for_review)-Number(a.validation.candidate_suitable_for_review));
      const selected=f.selected;const show=candidates.slice(0,1);
      const project=(v:NonNullable<typeof selected>)=>({high:v.high.id?add(v.high.id):null,low:v.low.id?add(v.low.id):null,high_state:v.high.state,low_state:v.low.state,high_consumed:v.high.consumed,low_consumed:v.low.consumed,
        observed_boundaries_intact:v.observed_boundaries_intact,candidate_suitable_for_review:v.candidate_suitable_for_review,review_status:v.review_status,
        active_dealing_range:v.active_dealing_range,premium_discount:v.premium_discount,context_evidence:group(v.context_evidence_ids),structural_invalidation:v.structural_invalidation,requirements:v.requirements});
      const d=r.frames.find(x=>x.timeframe===f.timeframe)!.dr_detection,q=d.current;
      return {timeframe:f.timeframe,detection:{revision:d.revision,status:d.status,reason:d.reason,direction:q?.direction??null,
        high:q?add(q.high_id):null,low:q?add(q.low_id):null,lower:q?.lower??null,upper:q?.upper??null,equilibrium:q?.equilibrium??null,
        start_at:q?.start_at??null,end_at:q?.end_at??null,confirmed_at:q?.confirmed_at??null,
        close_break_at:d.close_break_at,last_wick_raid_at:d.last_wick_raid_at,premium_discount:d.premium_discount,
        origin_context:group(d.origin_context_ids),parent_ranges:d.parent_ranges.length,
        internal_fractals:d.internal_fractal_ids.length,local_candidates:d.local_candidates.length,transitions:d.transitions.length,
        internal_classification:d.internal_classification,significance:d.significance,narrative_confirmed:false},
        selected:selected?project(selected):null,candidates:{items:show.map(x=>project(x.validation)),total:candidates.length,omitted:candidates.length-show.length}};
    }),
    paths:targetIds.map(id=>{const p=c.paths.find(p=>p.target_id===id)!;const shown=p.obstacles.slice(0,reduced?1:4);
      return {target:add(id),from:p.from,to:p.to,from_basis:p.from_basis,status:p.status==='UNVERIFIED'?'UNVERIFIED':p.obstacles.length>shown.length?'PARTIAL':p.status,
        obstacles:{items:shown.map(x=>add(x.id)),total:p.total,omitted:p.total-shown.length},ohlc_coverage:p.ohlc_coverage,free_path_proven:false,
        reasons:[...p.reasons,...(shown.length<p.total?['OBSTACLES_OMITTED']:[])]};}),
    full_inspection:{path:'/api/intelligence',mode:'inspection',snapshot_sha256:r.narrative.human_review.evidence_sha256,as_of:r.as_of,requires_authorization:false}};
}
