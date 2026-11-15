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
export type IntelligenceOptions = {
  as_of?: string;
  ranges?: Partial<Record<Timeframe, { high_id: string; low_id: string }>>;
  sessions?: SessionCalendar;
  risk?: {
    positions: RiskPosition[];
    candidate: RiskPosition;
    policy: RiskPolicy;
  };
};
export function resolveHierarchy(levels: KeyLevel[], reference: number | null) {
  if (reference === null)
    return {
      bias: "Neutral",
      a: null,
      conflicts: [],
      reason: "NO_REFERENCE_PRICE",
    };
  const hits = levels
    .filter(
      (l) =>
        ["MN1", "W1"].includes(l.timeframe) &&
        reference >= l.lower &&
        reference <= l.upper &&
        l.qualified,
    )
    .sort(
      (a, b) =>
        TF_ORDER.indexOf(a.timeframe) - TF_ORDER.indexOf(b.timeframe) ||
        a.id.localeCompare(b.id),
    );
  const a = hits[0] ?? null,
    conflicts = a ? hits.filter((l) => l.role !== a.role) : [];
  return {
    bias:
      !a || conflicts.length
        ? "Neutral"
        : a.role === "support"
          ? "Bullish"
          : "Bearish",
    a,
    conflicts,
    reason: conflicts.length
      ? "CONFLICTING_HTF_KL"
      : a
        ? "HTF_KL_CONTEXT"
        : "NO_ACTIVE_MN1_W1_KL",
  };
}
export function buildIntelligence(
  data: Record<Timeframe, CandleResponse>,
  side: PriceSide,
  quote: MarketQuote,
  options: IntelligenceOptions = {},
) {
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
      closed_candles: frame.bars.length,
      findings,
      range: dr.range,
      range_blocker: dr.reason,
      session_blocker: sessions.blocked,
      structure_bias: structure.bias,
    };
  });
  const last = frames.H4.bars.at(-1),
    reference = last?.close ?? null,
    active = allLevels.filter(
      (l) =>
        l.confirmed_at <= asOf &&
        l.continuity_end >= asOf &&
        (!l.invalidated_at || l.invalidated_at > asOf),
    );
  const hierarchy = resolveHierarchy(active, reference),
    direction =
      hierarchy.bias === "Bullish"
        ? "up"
        : hierarchy.bias === "Bearish"
          ? "down"
          : null;
  const raids = perFrame.flatMap((f) =>
    f.findings.filter((x) => x.kind === "RAID"),
  );
  const targets = active
    .filter(
      (l) =>
        ["MN1", "W1", "D1"].includes(l.timeframe) &&
        l.id !== hierarchy.a?.id &&
        !raids.some((r) => r.facts.pivot_id === l.id) &&
        reference !== null &&
        (direction === "up"
          ? l.lower > reference
          : direction === "down"
            ? l.upper < reference
            : false),
    )
    .sort(
      (a, b) =>
        Math.abs((direction === "up" ? a.lower : a.upper) - reference!) -
        Math.abs((direction === "up" ? b.lower : b.upper) - reference!),
    );
  const target = targets[0] ?? null,
    a = hierarchy.a;
  const c =
    a?.kind === "FVG"
      ? {
          price: a.role === "support" ? a.lower : a.upper,
          timeframe: a.timeframe,
          condition: "closed full boundary breach",
          source_id: a.id,
        }
      : null;
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
  const narrative = {
    ...provenance("EDGE.NARRATIVE.v1"),
    ...conclusionEvidence,
    bias: reliable && target && c ? hierarchy.bias : "Neutral",
    candidate_bias: hierarchy.bias,
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
      hierarchy.reason,
      ...hierarchy.conflicts.map((l) => `OPPOSING_HTF_KL:${l.id}`),
      ...provenance("EDGE.NARRATIVE.v1").counterarguments,
    ],
    invalidation: {
      entry: "Separate chosen execution structure; no entry selected",
      KL: c ?? "NEEDS_SPECIFICATION",
      narrative:
        "Requires review of HTF A/B/C; local H4 break alone does not cancel narrative",
    },
  };
  const canPropose = narrative.bias !== "Neutral" && !!a && !!target && !!c;
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
          (narrative.bias === "Bullish" ? "bullish" : "bearish") &&
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
        available: false,
        prerequisites_observed: canPropose,
        evidence_ids: a ? [a.id] : [],
        reason:
          "Reversal context and exact execution/stop selection need review; A/B/C alone is insufficient",
      },
      {
        model: "H4_DEALING_RANGE",
        available:
          canPropose &&
          !!h4Range &&
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
    schema_version: "edge-knowledge-1",
    symbol: data.H4.symbol,
    environment: data.H4.environment,
    price_side: side,
    as_of: asOf,
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
    frames: perFrame,
    narrative,
    execution,
    risk,
    assessment: {
      ...provenance("EDGE.EVIDENCE.v1"),
      ...conclusionEvidence,
      macro_edge: { status: "UNVALIDATED", context: narrative.bias },
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
    },
    verdict: {
      ...provenance("EDGE.EVIDENCE.v1"),
      status: reliable ? "OBSERVATION_ONLY" : "INSUFFICIENT_DATA",
      action: null,
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
