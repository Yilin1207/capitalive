import catalog from "@/knowledge/the-edge/catalog.json";
import reviewedRevisions from "@/knowledge/the-edge/reviewed-revisions.json";
import { EXAMPLES } from "./examples";

export type RuleStatus = "DOCUMENTED" | "FORMALIZED" | "TESTED" | "VALIDATED";
export type Rule = {
  id: string;
  concept: string;
  version: number;
  status: RuleStatus;
  specification: "EXECUTABLE" | "PARTIAL" | "NEEDS_SPECIFICATION";
  source_ids: string[];
  definition: string;
  formation: string[];
  confirmation: string[];
  invalidation: string[];
  timeframes: string[];
  htf_dependencies: string[];
  poi: string;
  vc: string;
  trigger: string;
  target: string;
  examples: string[];
  counterexamples: string[];
  unresolved: string[];
  implementation: string;
  validation: {
    unit: string | null;
    golden: string | null;
    out_of_sample: "NOT_RUN";
    profitability: "UNVERIFIED";
  };
};
const source = {
  fractal: "419e05dadd18817692d6efb4d9a1db5d",
  fvg: "419e05dadd18817abc57e446cd074bdc",
  rb: "419e05dadd1881f68a6bd60a2e1d2cff",
  snr: "419e05dadd1881c6a539fe10cf3ea892",
  raid: "418e05dadd18811ba86bc816d4f1d2dc",
  dr: "418e05dadd188105b1afc1a536f434e2",
  compression: "418e05dadd188135bf68eb2f9066b094",
  irl: "418e05dadd1881a3965bfba58563ff9d",
  gap: "418e05dadd1881c2a027eb107bbd95ab",
  open: "418e05dadd1881809c26f6f14090b017",
  tda: "418e05dadd1881eb8321c5c4edb17a06",
  narrative: "418e05dadd18812aa4e7c5f3fbe3cebe",
  entry: "418e05dadd18810a8ae7ef1c01be7232",
  risk: "418e05dadd1881b4add1f45e4193f5d7",
  evidence: "418e05dadd188164b877c4b8124325de",
  psychology: "418e05dadd1881fcb926f8c281eabd25",
};
type Spec = [
  string,
  string,
  keyof typeof source,
  Rule["specification"],
  string,
  string[],
  string[],
];
const specs: Spec[] = [
  [
    "FRACTAL_3",
    "Fractal High / Low, author 3-bar",
    "fractal",
    "EXECUTABLE",
    "Strict middle high/low against one neighbour on each side.",
    ["Three valid closed contiguous bars; ties are excluded."],
    ["Equality policy is an explicit conservative implementation convention."],
  ],
  [
    "FRACTAL_5",
    "Fractal High / Low, Capitalive 5-bar",
    "fractal",
    "EXECUTABLE",
    "Existing five-bar variant kept separate from the author three-bar model.",
    ["Five valid closed bars; two neighbours each side."],
    ["Project variant, not attributed to THE EDGE."],
  ],
  [
    "FVG",
    "Fair Value Gap geometry",
    "fvg",
    "EXECUTABLE",
    "Non-overlapping outer wicks across three closed bars, with the middle body spanning the interval.",
    ["Strict positive gap; middle directional body spans bounds."],
    ["Geometry alone is not a VC or entry; context remains required."],
  ],
  [
    "IFVG",
    "FVG breach / inversion candidate",
    "raid",
    "PARTIAL",
    "A closed breach of the far FVG boundary removes the old directional premise.",
    ["Close beyond far boundary; body inside is insufficient."],
    [
      "Breach is executable; an automatic opposite-side trading role is not specified.",
    ],
  ],
  [
    "RAID",
    "Fractal liquidity raid",
    "raid",
    "EXECUTABLE",
    "Strict wick penetration of an already confirmed fractal; equality is a separate touch.",
    ["Reference fractal known before the raid bar opens."],
    ["No close-back requirement; raid does not itself invalidate narrative."],
  ],
  [
    "RB",
    "Two-candle Rejection Block",
    "rb",
    "PARTIAL",
    "Opposite directional candles interact with a known KL and close back outside it.",
    ["Sell/Buy at support or Buy/Sell at resistance; explicit KL."],
    [
      "Reviewed diagrams place the RB reference at the body junction outside KL; unequal close/open, stop buffers and full executable zone remain unspecified. Full candle envelope is diagnostic only.",
    ],
  ],
  [
    "SNR",
    "Two-candle SNR with KL context",
    "snr",
    "PARTIAL",
    "Opposite-candle origin, subsequent delivery into KL and a closed break of the origin.",
    ["Origin precedes KL reaction; breakout is independent of FVG."],
    [
      "Support-break text says above, but reviewed diagrams el02_04/el02_09 show below; implementation follows the diagram and records this conflict.",
      "Reviewed diagrams define the body junction. A band for unequal adjacent close/open is a project convention; break alone does not establish a successful retest.",
    ],
  ],
  [
    "IDM",
    "Inducement inside POI",
    "fractal",
    "PARTIAL",
    "Confirmed fractal inside a known same/parent-TF POI.",
    ["X−1 preferred, same X allowed; POI known by confirmation."],
    [
      "Near POI distance undefined: only inside is implemented.",
      "Entry needs narrative and target; IDM is not an order.",
    ],
  ],
  [
    "STRONG",
    "Strong High / Low",
    "fractal",
    "PARTIAL",
    "Fractal involved in liquidity interaction plus RB/SNR volume-confirmation evidence.",
    ["Link pivot, raid and later VC on the relevant timeframe."],
    [
      "RB/SNR boundary ambiguity propagates; never label an ordinary pivot strong.",
    ],
  ],
  [
    "BOS_CHOCH",
    "Closed structure break, project convention",
    "fractal",
    "PARTIAL",
    "First close beyond a known pivot; opposite previous break direction is CHOCH.",
    ["Chronological pivots; no forming bars."],
    [
      "Terminology / bias state machine is a Capitalive convention, not a complete author rule.",
    ],
  ],
  [
    "DR",
    "Explicit Dealing Range",
    "dr",
    "EXECUTABLE",
    "Range between two distinct confirmed high/low pivots selected by ID.",
    ["High > Low; both known as of evaluation; explicit selection retained."],
    [
      "Automatic selection of a significant macro range is discretionary and not formalized.",
    ],
  ],
  [
    "PREMIUM_DISCOUNT",
    "Premium / Discount / EQ",
    "dr",
    "EXECUTABLE",
    "EQ is arithmetic midpoint of selected DR; upper/lower halves are premium/discount.",
    ["Valid selected DR."],
    ["EQ is not a claim about fair value or expected return."],
  ],
  [
    "IRL",
    "Internal Range Liquidity",
    "irl",
    "PARTIAL",
    "Confirmed fractals strictly inside an explicit DR after its origin.",
    ["Internal geometry, available only after both confirmations."],
    [
      "A continuation trigger additionally needs response/context not specified numerically.",
    ],
  ],
  [
    "COMPRESSION",
    "Compression / LRL",
    "compression",
    "NEEDS_SPECIFICATION",
    "Fractal sequence approaching KL; speed/contraction are observations.",
    ["Known KL; sequence of confirmed pivots."],
    [
      "Minimum sequence length, slowness, contraction tolerance and relevant KL selection are undefined.",
      "No automatic reversal conclusion.",
    ],
  ],
  [
    "DISPLACEMENT",
    "Displacement measurements",
    "compression",
    "NEEDS_SPECIFICATION",
    "Observe directional candle body and range without inventing an aggression threshold.",
    ["Valid closed bar."],
    [
      "Minimum body, ATR multiple and multi-bar impulse window are not defined by source.",
    ],
  ],
  [
    "SESSION_GAP",
    "Session opening gap",
    "gap",
    "EXECUTABLE",
    "Previous session close versus next session open under an explicit verified session calendar.",
    [
      "Both boundary candles closed; supplied session IDs/boundaries and timezone.",
    ],
    [
      "Missing provider calendar blocks identification; nominal OHLC time gaps are not sessions.",
      "Author fill percentages remain unreplicated hypotheses.",
    ],
  ],
  [
    "WEEKLY_OPEN",
    "Weekly Open",
    "open",
    "EXECUTABLE",
    "Open of a supplied, closed provider W1 candle.",
    ["Provider timeframe W1, valid closure."],
    [
      "Provider-specific boundary, not a universal spot/futures opening.",
      "Current forming week deliberately excluded by closed-bar contract.",
    ],
  ],
  [
    "MONTHLY_OPEN",
    "Monthly Open",
    "open",
    "EXECUTABLE",
    "Open of a supplied, closed provider MN1 candle.",
    ["Provider timeframe MN1, valid closure."],
    [
      "UTC aggregated CFD month is not an exchange calendar.",
      "Current forming month deliberately excluded.",
    ],
  ],
  [
    "TDA",
    "MN1 → W1 → D1 → H4 hierarchy",
    "tda",
    "EXECUTABLE",
    "Higher-timeframe context is resolved before lower execution observations.",
    ["X, X−1 and X−2 available; conflicts retained."],
    ["No lower-timeframe vote overrides a contradictory higher KL."],
  ],
  [
    "NARRATIVE",
    "A / B / C narrative",
    "narrative",
    "PARTIAL",
    "A is a qualified HTF KL, B a confirmed D1+ target, C explicit structural invalidation.",
    ["All required evidence available; neutral when missing or conflicting."],
    [
      "Discretionary KL significance and automatic full narrative invalidation are not fully specified.",
    ],
  ],
  [
    "EXECUTION",
    "VC and No VC alternatives",
    "entry",
    "PARTIAL",
    "Separate potential VC, IDM, KL market/limit and H4 DR paths.",
    ["Narrative, target and explicit invalidation first."],
    [
      "Absence of VC never generates a signal; incomplete methods remain unavailable.",
    ],
  ],
  [
    "RISK",
    "Position / idea / period / exposure budgets",
    "risk",
    "EXECUTABLE",
    "Aggregate losses, open and pending risks with one idea_id and explicit account-currency limits.",
    ["User supplies limits; additions need new structural evidence."],
    [
      "No default 0.5/1/2/10 percent policy; no automatic increase or broker orders.",
    ],
  ],
  [
    "EVIDENCE",
    "Macro EDGE / quality / confidence",
    "evidence",
    "EXECUTABLE",
    "Report context, trade prerequisites and evidence quality separately.",
    ["Rule and candle provenance; explicit data limitations."],
    [
      "No numeric probability or validated expected value without independent OOS evidence.",
    ],
  ],
  [
    "JOURNAL",
    "Psychology journal only",
    "psychology",
    "EXECUTABLE",
    "Decision review prompts are isolated from market detectors.",
    ["Journal/process inputs only."],
    ["Psychology cannot create or alter a price signal."],
  ],
];
export const RULES: Rule[] = specs.map(
  ([name, concept, src, specification, definition, formation, unresolved]) => ({
    id: `EDGE.${name}.v1`,
    concept,
    version: 1,
    status: specification === "NEEDS_SPECIFICATION" ? "DOCUMENTED" : "TESTED",
    specification,
    source_ids: [source[src]],
    definition,
    formation,
    confirmation: [
      "Use only admissible closed candles; record confirmation time separately from origin.",
      ...formation,
    ],
    invalidation: [EXAMPLES[name][2]],
    timeframes:
      name === "WEEKLY_OPEN"
        ? ["W1"]
        : name === "MONTHLY_OPEN"
          ? ["MN1"]
          : ["MN1", "W1", "D1", "H4"],
    htf_dependencies: [
      "X → X−1 → X−2; never use a source confirmed after the observation.",
    ],
    poi: "Explicit confirmed KL when required",
    vc: "PA geometry alone is not confirmed volume",
    trigger: "Observation only unless all documented prerequisites exist",
    target: "Confirmed D1+ structural target; never probability",
    examples: [EXAMPLES[name][0]],
    counterexamples: [EXAMPLES[name][1]],
    unresolved,
    implementation:
      specification === "NEEDS_SPECIFICATION"
        ? "Measurements and blocked classification only"
        : "Versioned deterministic subset; limitations remain attached",
    validation: {
      unit:
        name === "RISK"
          ? "tests/knowledge-risk.test.ts"
          : ["TDA", "NARRATIVE", "EXECUTION", "EVIDENCE", "JOURNAL"].includes(
                name,
              )
            ? "tests/knowledge-pipeline.test.ts"
            : "tests/knowledge-detectors.test.ts",
      golden: ["RB", "SNR"].includes(name)
        ? "Original normalized schematic cases checked against reviewed RB/SNR diagrams; not historical price transcriptions"
        : "Original schematic cases from textual conditions; remaining source diagrams not independently transcribed",
      out_of_sample: "NOT_RUN",
      profitability: "UNVERIFIED",
    },
  }),
);
for(const [name,concept,definition,src] of [
 ['LEVEL_STATE','As-of multi-timeframe level state','Separate geometric detection, observed activity, liquidity consumption and confirmed role retest; coverage is an explicit prerequisite.','raid'],
 ['TARGET_ROLE','Structural target eligibility','Validate directional role, observed continuity, consumption and A-to-B obstacles. Unique structural TF anchor or explicit ID; no nearest-price fallback.','narrative'],
 ['NARRATIVE','Evidence-based candidate narrative','KL containment is context only. Expose HTF structure, explicit DR/location, reaction, delivery, order-flow limits and target evidence; unresolved author criteria require review.','narrative'],
] as const){
 const base=RULES.find(r=>r.id==='EDGE.NARRATIVE.v1')!;
 RULES.push({...base,id:`EDGE.${name}.v2`,concept,version:2,status:'TESTED',specification:'PARTIAL',source_ids:[source[src],source.tda],definition,formation:['Closed observations must follow level confirmation and precede evaluation; maintain per-level interval coverage.'],confirmation:['Geometric target is not validated until role and path checks pass.'],invalidation:['New role break, liquidity consumption, data gap or source change requires re-evaluation.'],examples:['Named V2 regression cases declare expected outcomes before execution.'],counterexamples:['Old fractal above price is not automatically a bullish target; local raid is not an HTF BOS.'],unresolved:['Role-retest evidence protocol is a conservative project formalization, not a universal author rule.','Delivery and author SOF thresholds remain undefined; no profitability inference.'],validation:{unit:'tests/knowledge-v2.test.ts',golden:'Predeclared synthetic expected outcomes; separate immutable provider snapshots for replay',out_of_sample:'NOT_RUN',profitability:'UNVERIFIED'}});
}
export function rule(id: string) {
  const r = RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Unknown rule ${id}`);
  return r;
}
export function sourceCurrent(id: string) {
  const d = catalog.documents.find((d) => d.id === id);
  return (
    !!d &&
    d.source_status === "FETCHED" &&
    !d.truncated &&
    !d.unknown_block_count &&
    (reviewedRevisions as Record<string, string>)[id] === d.revision
  );
}
export function provenance(id: string) {
  const r = rule(id),
    current = r.source_ids.every(sourceCurrent);
  return {
    rule_id: r.id,
    rule_version: r.version,
    rule_status: current ? r.status : "DOCUMENTED",
    specification: current ? r.specification : "NEEDS_SPECIFICATION",
    sources: r.source_ids.map((id) => {
      const d = catalog.documents.find((d) => d.id === id);
      return { id, url: d?.url ?? null, revision: d?.revision ?? null };
    }),
    counterarguments: [
      ...r.unresolved,
      ...(current ? [] : ["SOURCE_CHANGED_OR_UNAVAILABLE_REVIEW_REQUIRED"]),
    ],
  };
}
export function knowledgeCoverage() {
  return {
    expected: catalog.expected_materials,
    imported: catalog.documents.filter((d) => d.source_status === "FETCHED")
      .length,
    catalog_revision: catalog.imported_at,
    stale_rules: RULES.filter((r) => !r.source_ids.every(sourceCurrent)).map(
      (r) => r.id,
    ),
    rules: RULES.length,
    formalized: RULES.filter((r) => r.status !== "DOCUMENTED").length,
    tested: RULES.filter(
      (r) => r.status === "TESTED" || r.status === "VALIDATED",
    ).length,
    validated: RULES.filter((r) => r.status === "VALIDATED").length,
    needs_specification: RULES.filter(
      (r) => r.specification === "NEEDS_SPECIFICATION",
    ).map((r) => r.id),
    partial: RULES.filter((r) => r.specification === "PARTIAL").map(
      (r) => r.id,
    ),
    images_total: catalog.documents.reduce((n, d) => n + d.image_count, 0),
    images_reviewed: catalog.documents.reduce(
      (n, d) => n + d.images_reviewed,
      0,
    ),
    out_of_sample: "NOT_RUN",
    raw_text_stored: false,
  };
}
export function searchKnowledge(query = "") {
  const q = query.trim().toLocaleLowerCase();
  return {
    documents: catalog.documents.filter((d) =>
      `${d.title} ${d.summary} ${d.category}`.toLocaleLowerCase().includes(q),
    ),
    rules: RULES.filter((r) =>
      `${r.id} ${r.concept} ${r.definition}`.toLocaleLowerCase().includes(q),
    ),
    coverage: knowledgeCoverage(),
  };
}
