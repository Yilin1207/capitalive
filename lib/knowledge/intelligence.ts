import {buildNarrativeMethod} from './narrative-method';
import {tdaRelationships,tdaAnchorLevels} from './tda';
import {intervalCoverage} from './level-state';
import {fvgTestTimeline,currentBounds} from './fvg-remaining';
import type { CandleResponse, PriceSide, Timeframe } from "../candle-data";
import type { MarketQuote } from "../quote-normalization";
import { closedFrame, type Frame } from "./data";
import {
  TF_ORDER,
  detectFractals,
  detectFvg,
  detectInversions,
  detectRaids,
  detectRejectionBlocks,
  detectSnr,
  detectIdm,
  detectStrong,
  detectStructure,
  selectRange,
  assessRange,
  detectIrl,
  measureCompression,
  measureDisplacement,
  detectSessionGaps,
  detectOpeningLevels,
  pivotLevels,
  type KeyLevel,
  type Finding,
  type SessionCalendar,
} from "./detectors";
import { provenance, knowledgeCoverage } from "./rules";
import { assessRisk, type RiskPosition, type RiskPolicy } from "./risk";
import {assessLevel,contextualLevels} from "./level-state";
import {selectTarget} from "./target-selection";
import {resolveContext,swingFlow,narrativeAssessment} from "./narrative";
import {createHash} from 'node:crypto';
import {canonical} from '../research/blind';
import {qualityDimensions} from '../research/quality';
import type {HumanReview} from './human-review';
import {rangeCandidates} from './range-candidates';
import {detectDealingRange,selectTopDownRange} from './dealing-range';
import {buildResearchContext,validateDealingRangeEvidence,validatePathCompleteness} from './research-context';
export type IntelligenceOptions = {
  anchor_id?: string;
  human_review?: HumanReview;
  target_id?: string;
  as_of?: string;
  ranges?: Partial<Record<Timeframe, { high_id: string; low_id: string }>>;
  sessions?: SessionCalendar;
  risk?: {
    positions: RiskPosition[];
    candidate: RiskPosition;
    policy: RiskPolicy;
  };
};
export const resolveHierarchy=resolveContext;
export function buildIntelligence(
  data: Record<Timeframe, CandleResponse>,
  side: PriceSide,
  quote: MarketQuote,
  options: IntelligenceOptions = {},
) {
  if(TF_ORDER.some(tf=>!data[tf]||data[tf].timeframe!==tf||data[tf].provider!=='Capital.com'||!Number.isFinite(Date.parse(data[tf].fetched_at)))||new Set(TF_ORDER.map(tf=>data[tf].symbol)).size!==1||new Set(TF_ORDER.map(tf=>data[tf].environment)).size!==1)throw Error('INVALID_DATASET_IDENTITY');
  const fetchedAsOf = Object.values(data)
    .map((d) => d.fetched_at)
    .sort()[0];
  const asOf =
    options.as_of && options.as_of < fetchedAsOf ? options.as_of : fetchedAsOf;
  const frames = Object.fromEntries(
    TF_ORDER.map((tf) => [tf, closedFrame(data[tf], side, asOf)]),
  ) as Record<Timeframe, Frame>;
  const bases = TF_ORDER.map((tf) => {
    const frame = frames[tf],
      pivots = detectFractals(frame, 3),
      fvg = detectFvg(frame);
    return {
      tf,
      frame,
      pivots,
      fvg,
      levels: [...pivotLevels(pivots), ...fvg.levels],
    };
  });
  const allLevels = bases.flatMap((b) =>
    b.levels.map((l) => {
      const origin = b.frame.bars.find((c) => c.end === l.confirmed_at),
        segment = b.frame.bars.filter((c) => c.segment === origin?.segment);
      return {
        ...l,
        continuity_end:
          origin?.segment === b.frame.bars.at(-1)?.segment
            ? asOf
            : (segment.at(-1)?.end ?? l.confirmed_at),
      };
    }),
  );
  for(const l of allLevels)if(l.kind==='FVG')Object.assign(l,{fvg_test_steps:fvgTestTimeline(l,Object.values(frames))});
  const perFrame = bases.map(({ tf, frame, pivots, fvg }) => {
    const context = allLevels.filter(
      (l) => TF_ORDER.indexOf(l.timeframe) <= TF_ORDER.indexOf(tf),
    );
    const raids = detectRaids(frame, pivots),
      rb = detectRejectionBlocks(frame, context),
      snr = detectSnr(frame, context, allLevels),
      structure = detectStructure(frame, pivots),
      dr = selectRange(frame, pivots, options.ranges?.[tf]);
    const sessions = detectSessionGaps(frame, options.sessions);
    const findings: Finding[] = [
      ...pivots,
      ...fvg.findings,
      ...detectInversions(frame, fvg.levels),
      ...raids,
      ...rb,
      ...snr,
      ...detectIdm(frame, pivots, context),
      ...detectStrong(frame, pivots, raids, [...rb, ...snr]),
      ...structure.findings,
      ...dr.findings,
      ...detectIrl(frame, pivots, dr.range),
      ...measureCompression(frame, pivots, context),
      ...measureDisplacement(frame),
      ...sessions.findings,
      ...detectOpeningLevels(frame),
    ];
    return {
      timeframe: tf,
      data_status: frame.status,
      warnings: frame.warnings,
      diagnostics: frame.diagnostics??[],
      closed_candles: frame.bars.length,
      findings,
      range: dr.range,
      dr_detection:detectDealingRange(frame,pivots,context),
      range_candidates:rangeCandidates(frame,pivots,context),
      range_state:assessRange(frame,dr.range),
      range_blocker: dr.reason,
      session_blocker: sessions.blocked,
      structure_bias: structure.bias,
      order_flow: swingFlow(frame,pivots),
    };
  });
  const last=frames.H4.bars.at(-1),reference=last?.close??null,through=last?.end??asOf;
  const detected=[...allLevels,...contextualLevels(perFrame.flatMap(f=>f.findings))];
  const states=detected.map(l=>assessLevel(l,frames,asOf,through));
  const researchContext=buildResearchContext(frames,perFrame.flatMap(f=>f.findings),detected,states,reference);
  const dealingRangeReviews=perFrame.map(f=>({timeframe:f.timeframe,
    selected:(f.range??f.dr_detection.current)?validateDealingRangeEvidence((f.range??f.dr_detection.current)!,states,frames[f.timeframe],detected,!f.range&&f.dr_detection.status==='ESTABLISHED'):null,
    candidates:f.range_candidates.candidates.filter(range=>range.basis==='KL_REACTION_LOCAL_DR_REQUIRES_REVIEW').map(range=>({range,validation:validateDealingRangeEvidence(range,states,frames[f.timeframe],detected)}))}));
  const active=detected.filter(l=>states.find(s=>s.id===l.id)?.state==='ACTIVE').map(l=>({...currentBounds(l,states.find(s=>s.id===l.id)),role:states.find(s=>s.id===l.id)!.current_role??l.role}));
  const tda=tdaRelationships(frames,perFrame.flatMap(f=>f.findings),detected,states,perFrame.map(f=>({timeframe:f.timeframe,range:f.range??f.dr_detection.current,state:f.range?f.range_state.state:f.dr_detection.status==='ESTABLISHED'?'ACTIVE':f.dr_detection.status})),reference);
  const narrativeMethod=buildNarrativeMethod(frames,perFrame.flatMap(f=>f.findings),detected,states,perFrame.map(f=>({timeframe:f.timeframe,range:f.range??f.dr_detection.current,active:f.range?f.range_state.state==='ACTIVE':f.dr_detection.status==='ESTABLISHED'})),reference);
  const pois=tdaAnchorLevels(detected,tda).map(l=>currentBounds(l,states.find(s=>s.id===l.id)));
  const reactionIds=tda.anchors.filter(a=>a.eligible_as_poi&&a.context!=='AWAITING_DELIVERY').map(a=>a.id);
  const hierarchy=resolveHierarchy(pois,reference,options.anchor_id??(pois.some(p=>p.id===narrativeMethod.selected_id)?narrativeMethod.selected_id!:undefined),reactionIds),direction=hierarchy.candidate_bias==='Bullish'?'up':hierarchy.candidate_bias==='Bearish'?'down':null;
  // Empty/unknown frames cannot prove an obstacle-free path. Calendar, finite
  // history and detector boundary limitations remain explicit even if no IDs were truncated.
  const relevantTfs=TF_ORDER; // Higher-TF obstacles also require observed coverage.
  const pathCoverage=relevantTfs.some(tf=>frames[tf].status==='UNVERIFIED'||!frames[tf].bars.length)?'UNKNOWN':relevantTfs.every(tf=>frames[tf].warnings.length===0&&intervalCoverage([frames[tf]],frames[tf].bars[0].time,frames[tf].bars.at(-1)!.end).complete)?'COMPLETE':'PARTIAL';
  const selectedMethod=narrativeMethod.candidates.find(x=>x.id===hierarchy.a?.id);
  const targetSelection=selectTarget(detected,states,reference,direction,hierarchy.a,options.target_id??selectedMethod?.B?.id,pathCoverage);
  const researchPaths=targetSelection.target_candidates.filter(c=>c.role_eligible).map(c=>({target_id:c.id,
    from_basis:hierarchy.a?'ANCHOR_BOUNDARY':'LAST_CLOSED_H4',
    ...validatePathCompleteness(detected,states,frames,hierarchy.a?(direction==='up'?hierarchy.a.upper:hierarchy.a.lower):reference,c.price,[c.id,...(hierarchy.a?[hierarchy.a.id]:[])])}));
  const targetLevel=detected.find(l=>l.id===targetSelection.candidate_target?.id),target=targetLevel?currentBounds(targetLevel,states.find(s=>s.id===targetLevel.id)):null,a=hierarchy.a;
  const manualC=options.human_review?.C;
  const validManualC=!!manualC&&!!a&&manualC.timeframe===a.timeframe&&Number.isFinite(manualC.price)&&(a.role==='support'?manualC.price<=a.lower:manualC.price>=a.upper)&&manualC.condition==='CLOSE_BEYOND'&&!frames[a.timeframe].bars.some(b=>b.time>=a.confirmed_at&&(a.role==='support'?b.close<manualC.price:b.close>manualC.price));
  const methodC=selectedMethod?.C&&selectedMethod.C.close_breached===false?selectedMethod.C:null;
  const c=validManualC?{price:manualC!.price,timeframe:manualC!.timeframe,condition:'User specified own-TF closed structural breach',source_id:a!.id}:
    methodC?{price:methodC.price,timeframe:methodC.timeframe,condition:'Research method own-TF structural boundary breach',source_id:methodC.source_ids.find(id=>{const l=detected.find(l=>l.id===id);return l&&(a!.role==='support'?l.lower:l.upper)===methodC.price;})??methodC.source_ids[0]}:
    a?.kind==='FVG'?{price:a.role==='support'?a.lower:a.upper,timeframe:a.timeframe,condition:'closed full boundary breach',source_id:a.id}:null;
  const reliable =
    knowledgeCoverage().stale_rules.length === 0 &&
    TF_ORDER.every(
      (tf) => frames[tf].status !== "UNVERIFIED" && data[tf].timeframe === tf,
    ) &&
    new Set(Object.values(data).map((d) => d.symbol)).size === 1 &&
    new Set(Object.values(data).map((d) => d.environment)).size === 1;
  const conclusionEvidence = {
    timeframes: TF_ORDER,
    data_status: reliable ? "PARTIAL" : "UNVERIFIED",
    candle_evidence: [
      ...(a?.source_finding.candle_evidence ?? []),
      ...(target?.source_finding.candle_evidence ?? []),
    ],
    invalidation:
      "Review when A/B/C, supporting closed candles or source revisions change",
  };
  const evidenceHash=createHash('sha256').update(canonical({dr_revision:'dr-sequence-1',rb_revision:'rb-first-close-2',snr_revision:'snr-formation-context-2',fvg_revision:'fvg-unfilled-1',narrative_method_revision:'narrative-method-1',tda_revision:'tda-notion-1',as_of:asOf,side,frames:TF_ORDER.map(tf=>({tf,symbol:frames[tf].symbol,bars:frames[tf].bars,warnings:frames[tf].warnings})),environment:data.H4.environment,anchor_id:options.anchor_id??null,target_id:options.target_id??null,ranges:options.ranges??{},sources:knowledgeCoverage().catalog_revision})).digest('hex');
  const assessment=narrativeAssessment(hierarchy,states,perFrame,targetSelection,reference,reliable,options.human_review,evidenceHash,!!c,tda.anchors.some(x=>x.id===a?.id&&x.eligible_as_poi));
  const narrative = {
    ...provenance("EDGE.NARRATIVE.v5"),
    ...assessment,
    ...conclusionEvidence,
    bias: assessment.bias,
    candidate_bias: assessment.candidate_bias,
    A: a
      ? {
          id: a.id,
          timeframe: a.timeframe,
          kind: a.kind,
          lower: a.lower,
          upper: a.upper,
          evidence: a.source_finding,
        }
      : null,
    B: target
      ? {
          id: target.id,
          status: targetSelection.candidate_status,
          path_status: targetSelection.status,
          timeframe: target.timeframe,
          price: direction === "up" ? target.lower : target.upper,
          evidence: target.source_finding,
        }
      : null,
    C: c,
    data_status: reliable ? "PARTIAL" : "UNVERIFIED",
    candle_evidence: conclusionEvidence.candle_evidence,
    counterarguments: [
      ...options.human_review?.counterarguments??[],
      `HTF conflict: ${hierarchy.conflicts.length} opposing levels; structure and qualitative SOF can disagree.`,
      `Target/path uncertainty: ${targetSelection.blockers.join(', ')||'No observed obstacle; unobserved prior history still limits inference'}.`,
      'Data limitation: holiday completeness, historical revisions and Demo/Live equivalence remain unverified.',
      hierarchy.reason,
      ...assessment.blockers,
      ...hierarchy.conflicts.map((l) => `OPPOSING_HTF_KL:${l.id}`),
      ...provenance("EDGE.NARRATIVE.v2").counterarguments,
    ],
    invalidation: {
      entry: "Separate chosen execution structure; no entry selected",
      KL: c ?? "NEEDS_SPECIFICATION",
      narrative:
        "Requires review of HTF A/B/C; local H4 break alone does not cancel narrative",
    },
  };
  const canPropose = !assessment.review_required && assessment.bias!=='Neutral' && !!a && !!target && !!c;
  const downstream = perFrame.filter(
    (f) => a && TF_ORDER.indexOf(f.timeframe) > TF_ORDER.indexOf(a.timeframe),
  );
  const selectedTda=tda.anchors.find(x=>x.id===a?.id);
  const vc=perFrame.flatMap(f=>f.findings).filter(f=>selectedTda?.vc_ids.includes(f.id));
  const idm = downstream
    .flatMap((f) => f.findings)
    .filter((f) => f.kind === "IDM_INSIDE_POI" && f.facts.poi_id === a?.id);
  const h4Frame=perFrame.find(f=>f.timeframe==='H4'),h4Range=h4Frame?.range??(h4Frame?.dr_detection.status==='ESTABLISHED'?h4Frame.dr_detection.current:null);
  const execution = {
    ...provenance("EDGE.EXECUTION.v1"),
    ...conclusionEvidence,
    status: "REVIEW_REQUIRED",
    entry_status: canPropose?'ENTRY_CONDITIONAL':'REVIEW_REQUIRED',
    entry_invalidated:assessment.entry_invalidated,
    KL_invalidated:assessment.KL_invalidated,
    narrative_invalidated:assessment.narrative_invalidated,
    models: [
      {
        model: "VC_FVG",
        available: canPropose && vc.some(v=>v.kind==='FVG'&&states.find(s=>s.id===v.id)?.state==='ACTIVE'),
        evidence_ids: vc.filter(v=>v.kind==='FVG').map(v=>v.id),
        reason:
          "Closed directional FVG in HTF KL context; no order and no volume measurement claim",
      },
      {
        model: "VC_RB_SNR",
        available: false,
        prerequisites_observed:vc.some(v=>['RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(v.kind)),
        evidence_ids:vc.filter(v=>['RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(v.kind)).map(v=>v.id),
        reason: 'Causal X-1 RB/SNR reaction observed; execution and stops require review',
      },
      {
        model: "NO_VC_IDM",
        available: false,
        prerequisites_observed: canPropose && idm.length > 0,
        evidence_ids: idm.map((v) => v.id),
        reason:
          "Requires a verified Strong High/Low stop boundary; a PA reference alone does not specify trade stops",
      },
      {
        model: "KL_MARKET_LIMIT",
        available: canPropose,
        prerequisites_observed: canPropose,
        evidence_ids: a ? [a.id] : [],
        reason:
          "Documented No VC method; conditional research plan only. Exact entry/stop, costs and idea risk still need review; no order or automatic SL/TP.",
      },
      {
        model: "H4_DEALING_RANGE",
        available:
          canPropose &&
          !!h4Range &&
          (h4Frame?.range?h4Frame.range_state.state==='ACTIVE':h4Frame?.dr_detection.status==='ESTABLISHED') &&
          h4Range.confirmed_at >= a!.confirmed_at &&
          h4Range.lower <= a!.upper &&
          h4Range.upper >= a!.lower,
        evidence_ids: h4Range ? [h4Range.high_id, h4Range.low_id] : [],
        reason: h4Range
          ? "Selected range intersects KL; candidate method only, not a confirmed entry"
          : "EXPLICIT_H4_RANGE_REQUIRED",
      },
    ],
    order: null,
    no_vc_is_signal: false,
  };
  const risk = assessRisk(
    options.risk?.positions ?? [],
    options.risk?.candidate ?? null,
    options.risk?.policy ?? null,
    asOf,
  );
  return {
    ok: true,
    schema_version: "edge-knowledge-5",
    research_revision:'5.1',
    research_context:{...researchContext,candidate_narrative:hierarchy.candidate_bias,confirmed_narrative:narrative.confirmed_narrative,
      dealing_range_reviews:dealingRangeReviews,dealing_range_selection:selectTopDownRange(perFrame),paths:researchPaths},
    symbol: data.H4.symbol,
    environment: data.H4.environment,
    price_side: side,
    as_of: asOf,
    selection:{anchor_id:options.anchor_id??null,target_id:options.target_id??null,ranges:options.ranges??{}},
    tda,
    narrative_method:narrativeMethod,
    pipeline: [
      "DATA_QUALITY",
      "MN1",
      "W1",
      "D1",
      "H4",
      "NARRATIVE",
      "EXECUTION",
      "RISK",
      "VERDICT",
    ],
    hierarchy: {
      ...provenance("EDGE.TDA.v2"),
      ...conclusionEvidence,
      order: TF_ORDER,
      chains: TF_ORDER.map((tf, i) => ({
        x: tf,
        x_minus_1: TF_ORDER[i + 1] ?? null,
        x_minus_2: TF_ORDER[i + 2] ?? null,
      })),
      conflicts: hierarchy.conflicts.map((l) => l.id),
    },
    data_quality: {
      dimensions:qualityDimensions(data,quote),
      status: reliable ? "PARTIAL" : "UNVERIFIED",
      closed_only: true,
      as_of_policy: "requested historical cutoff capped at common minimum fetched timestamp",
      reference_kind: "last_admissible_closed_H4_close",
      reference_price: reference,
      quote_observation: {
        fresh: quote.fresh,
        provider_timestamp_available:
          quote.provider_timestamp_available === true,
        quote_time: quote.quote_time,
      },
      quote_used_as_closed_evidence: false,
    },
    levels: {state_rule:provenance('EDGE.LEVEL_STATE.v3'),test_episodes_policy:'Sum of per-timeframe episodes; overlapping TF observations are not independent tests',detected_levels:detected.map(l=>({id:l.id,kind:l.kind,timeframe:l.timeframe,lower:l.lower,upper:l.upper,initial_role:l.role,confirmed_at:l.confirmed_at,source_finding_id:l.source_finding.id})),active_level_ids:active.map(l=>l.id),states:states.map(({sources,rule_status,specification,invalidation,...state})=>state)},
    target_selection: targetSelection,
    frames: perFrame,
    narrative,
    execution,
    risk,
    assessment: {
      ...provenance("EDGE.EVIDENCE.v1"),
      ...conclusionEvidence,
      macro_edge: { status: "NOT_EVALUATED", context: null },
      trade_quality: {
        status: "INCOMPLETE",
        has_A: !!a,
        has_B: !!target,
        has_C: !!c,
      },
      evidence_confidence: {
        status: reliable ? "PARTIAL" : "UNVERIFIED",
        findings: perFrame.reduce((n, f) => n + f.findings.length, 0),
        profitability_validated: false,
      },
      probability_tp: null,
      readiness:{research:'PENDING_USER_LABELS_AND_EXPERT_REVIEW',decision_support:'NOT_VALIDATED',live_execution:'DISABLED',metrics:{precision:null,recall:null,false_positives:null,false_negatives:null,narrative_agreement:null,target_agreement:null,reason:'Blind labels not yet frozen or compared'}},
    },
    verdict: {
      ...provenance("EDGE.EVIDENCE.v1"),
      status: reliable ? "OBSERVATION_ONLY" : "INSUFFICIENT_DATA",
      action: "NOT_EVALUATED",
      decision_authority: 'EXTERNAL_TRADING_RESEARCH_DESK',
      reasons: [...assessment.blockers,...targetSelection.blockers],
      data_status: reliable ? "PARTIAL" : "UNVERIFIED",
      timeframes: TF_ORDER,
      candle_evidence: last ? [last] : [],
      counterarguments: [
        "Unspecified qualitative rules are gated",
        "No independent out-of-sample evidence",
        "Execution and personal risk policy need explicit review",
      ],
      invalidation:
        "Withdraw conclusion when supporting data, source revision or structural context changes",
    },
    knowledge: knowledgeCoverage(),
    journal: {
      ...provenance("EDGE.JOURNAL.v1"),
      signal_input: false,
      prompts: [
        "Was the plan recorded before the outcome?",
        "Was idea risk counted across all attempts?",
        "Was entry invalidation confused with narrative invalidation?",
      ],
    },
  };
}
