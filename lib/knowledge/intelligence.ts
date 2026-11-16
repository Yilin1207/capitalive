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
      five = detectFractals(frame, 5),
      fvg = detectFvg(frame);
    return {
      tf,
      frame,
      pivots,
      five,
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
  const perFrame = bases.map(({ tf, frame, pivots, five, fvg }) => {
    const context = allLevels.filter(
      (l) => TF_ORDER.indexOf(l.timeframe) <= TF_ORDER.indexOf(tf),
    );
    const raids = detectRaids(frame, pivots),
      rb = detectRejectionBlocks(frame, context),
      snr = detectSnr(frame, context),
      structure = detectStructure(frame, pivots),
      dr = selectRange(frame, [...pivots, ...five], options.ranges?.[tf]);
    const sessions = detectSessionGaps(frame, options.sessions);
    const findings: Finding[] = [
      ...pivots,
      ...five,
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
      range_candidates:rangeCandidates(frame,pivots),
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
  const active=detected.filter(l=>states.find(s=>s.id===l.id)?.state==='ACTIVE').map(l=>({...l,role:states.find(s=>s.id===l.id)!.current_role??l.role}));
  const hierarchy=resolveHierarchy(active,reference,options.anchor_id),direction=hierarchy.candidate_bias==='Bullish'?'up':hierarchy.candidate_bias==='Bearish'?'down':null;
  // Empty/unknown frames cannot prove an obstacle-free path. Calendar, finite
  // history and detector boundary limitations remain explicit even if no IDs were truncated.
  const pathCoverage=TF_ORDER.slice(0,3).some(tf=>frames[tf].status==='UNVERIFIED')?'UNKNOWN':'PARTIAL';
  const targetSelection=selectTarget(detected,states,reference,direction,hierarchy.a,options.target_id,pathCoverage);
  const target=detected.find(l=>l.id===targetSelection.validated_target?.id)??null,a=hierarchy.a;
  const manualC=options.human_review?.C;
  const validManualC=!!manualC&&!!a&&manualC.timeframe===a.timeframe&&Number.isFinite(manualC.price)&&(a.role==='support'?manualC.price<=a.lower:manualC.price>=a.upper)&&manualC.condition==='CLOSE_BEYOND'&&!frames[a.timeframe].bars.some(b=>b.time>=a.confirmed_at&&(a.role==='support'?b.close<manualC.price:b.close>manualC.price));
  const c =
    a?.kind === "FVG"
      ? {
          price: a.role === "support" ? a.lower : a.upper,
          timeframe: a.timeframe,
          condition: "closed full boundary breach",
          source_id: a.id,
        }
      : validManualC?{price:manualC!.price,timeframe:manualC!.timeframe,condition:'User specified own-TF closed structural breach',source_id:a!.id}:null;
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
  const evidenceHash=createHash('sha256').update(canonical({as_of:asOf,side,frames:TF_ORDER.map(tf=>({tf,symbol:frames[tf].symbol,bars:frames[tf].bars,warnings:frames[tf].warnings})),environment:data.H4.environment,anchor_id:options.anchor_id??null,target_id:options.target_id??null,ranges:options.ranges??{},sources:knowledgeCoverage().catalog_revision})).digest('hex');
  const assessment=narrativeAssessment(hierarchy,states,perFrame,targetSelection,reference,reliable,options.human_review,evidenceHash,!!c);
  const narrative = {
    ...provenance("EDGE.NARRATIVE.v3"),
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
  const vc = downstream
    .flatMap((f) => f.findings)
    .filter(
      (f) =>
        f.kind === "FVG" &&
        f.origin >= a!.confirmed_at &&
        f.facts.direction ===
          (narrative.candidate_bias === "Bullish" ? "bullish" : "bearish") &&
        f.candle_evidence.some((b) => b.high >= a!.lower && b.low <= a!.upper),
    );
  const idm = downstream
    .flatMap((f) => f.findings)
    .filter((f) => f.kind === "IDM_INSIDE_POI" && f.facts.poi_id === a?.id);
  const h4Range = perFrame.find((f) => f.timeframe === "H4")?.range;
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
        available: canPropose && vc.length > 0,
        evidence_ids: vc.map((v) => v.id),
        reason:
          "Closed directional FVG in HTF KL context; no order and no volume measurement claim",
      },
      {
        model: "VC_RB_SNR",
        available: false,
        evidence_ids: [],
        reason: "Author boundary conventions still need specification",
      },
      {
        model: "NO_VC_IDM",
        available: false,
        prerequisites_observed: canPropose && idm.length > 0,
        evidence_ids: idm.map((v) => v.id),
        reason:
          "Requires a verified Strong High/Low stop boundary; RB/SNR bounds remain unspecified",
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
          perFrame.find(f=>f.timeframe==='H4')?.range_state.state==='ACTIVE' &&
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
    schema_version: "edge-knowledge-3",
    symbol: data.H4.symbol,
    environment: data.H4.environment,
    price_side: side,
    as_of: asOf,
    selection:{anchor_id:options.anchor_id??null,target_id:options.target_id??null,ranges:options.ranges??{}},
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
      ...provenance("EDGE.TDA.v1"),
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
    levels: {state_rule:provenance('EDGE.LEVEL_STATE.v2'),test_episodes_policy:'Sum of per-timeframe episodes; overlapping TF observations are not independent tests',detected_levels:detected.map(l=>({id:l.id,kind:l.kind,timeframe:l.timeframe,lower:l.lower,upper:l.upper,initial_role:l.role,confirmed_at:l.confirmed_at,source_finding_id:l.source_finding.id})),active_level_ids:active.map(l=>l.id),states:states.map(({sources,rule_status,specification,invalidation,...state})=>state)},
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
