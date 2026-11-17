import type { Frame, Bar } from "./data";
import { contiguous } from "./data";
import type { Timeframe } from "../candle-data";
import { provenance } from "./rules";
import {snrFormationContext} from "./snr-context";
export const TF_ORDER: Timeframe[] = ["MN1", "W1", "D1", "H4"];
export type Finding = {
  id: string;
  kind: string;
  timeframe: Timeframe;
  side: string;
  origin: string;
  confirmed_at: string;
  data_status: Frame["status"];
  candle_evidence: {
    time: string;
    closed_at: string;
    index: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
  rule_id: string;
  rule_version: number;
  rule_status: string;
  specification: string;
  sources: ReturnType<typeof provenance>["sources"];
  counterarguments: string[];
  invalidation: string;
  facts: Record<string, unknown>;
  state: "OBSERVED" | "CANDIDATE" | "NEEDS_SPECIFICATION";
};
export type Pivot = Finding & {
  price: number;
  polarity: "high" | "low";
  index: number;
  segment: number;
  variant: 3;
};
export type KeyLevel = {
  id: string;
  kind: "FRACTAL" | "FVG" | "RB" | "SNR";
  timeframe: Timeframe;
  side: string;
  lower: number;
  upper: number;
  role: "support" | "resistance";
  confirmed_at: string;
  invalidated_at?: string | null;
  continuity_end?: string;
  source_finding: Finding;
  qualified: boolean;
};
export type Range = {
  high_id: string;
  low_id: string;
  lower: number;
  upper: number;
  equilibrium: number;
  confirmed_at: string;
  origin: string;
  timeframe: Timeframe;
  segment: number;
};
function event(
  frame: Frame,
  name: string,
  kind: string,
  bars: Bar[],
  facts: Record<string, unknown>,
  invalidation: string,
  state: Finding["state"] = "OBSERVED",
  suffix = "",
): Finding {
  const last = bars.at(-1);
  return {
    id: `${frame.symbol}:${frame.timeframe}:${frame.side}:${kind}:${last?.time ?? frame.as_of}:${suffix}`,
    kind,
    timeframe: frame.timeframe,
    side: frame.side,
    origin: bars[0]?.time ?? frame.as_of,
    confirmed_at: last?.end ?? frame.as_of,
    data_status: frame.status,
    candle_evidence: bars.map((b) => ({
      time: b.time,
      closed_at: b.end,
      index: b.index,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    })),
    ...provenance(`EDGE.${name}.v${['RB','SNR'].includes(name)?2:1}`),
    counterarguments: [
      ...provenance(`EDGE.${name}.v${['RB','SNR'].includes(name)?2:1}`).counterarguments,
      ...frame.warnings,
    ],
    invalidation,
    facts,
    state:
      provenance(`EDGE.${name}.v${['RB','SNR'].includes(name)?2:1}`).specification === "NEEDS_SPECIFICATION"
        ? "NEEDS_SPECIFICATION"
        : state,
  };
}
export function detectFractals(frame: Frame, variant: 3 = 3): Pivot[] {
  if(variant!==3)throw Error("UNSUPPORTED_FRACTAL_VARIANT");
  const out: Pivot[] = [],
    n = 1,
    bars = frame.bars;
  for (let i = n; i < bars.length - n; i++) {
    const window = bars.slice(i - n, i + n + 1);
    if (!contiguous(window)) continue;
    const b = bars[i];
    for (const polarity of ["high", "low"] as const) {
      if (
        !window.every(
          (x) =>
            x === b || (polarity === "high" ? b.high > x.high : b.low < x.low),
        )
      )
        continue;
      out.push({
        ...event(
          frame,
          `FRACTAL_${variant}`,
          "FRACTAL",
          window,
          {
            polarity,
            price: b[polarity],
            variant,
            confirmation_policy: "right_neighbours_closed",
            pivot_time: b.time,
          },
          "Strict later wick crossing consumes liquidity; it does not itself invalidate KL.",
          "OBSERVED",
          `${variant}:${polarity}:${b.time}`,
        ),
        price: b[polarity],
        polarity,
        index: b.index,
        segment: b.segment,
        variant,
      });
    }
  }
  return out;
}
export function detectFvg(frame: Frame) {
  const findings: Finding[] = [],
    levels: KeyLevel[] = [];
  for (let i = 2; i < frame.bars.length; i++) {
    const bars = frame.bars.slice(i - 2, i + 1);
    if (!contiguous(bars)) continue;
    const [a, b, c] = bars;
    for (const up of [true, false]) {
      const lower = up ? a.high : c.high,
        upper = up ? c.low : a.low;
      if (
        !(
          upper > lower &&
          (up ? b.close > b.open : b.close < b.open) &&
          Math.min(b.open, b.close) <= lower &&
          Math.max(b.open, b.close) >= upper
        )
      )
        continue;
      const e = event(
        frame,
        "FVG",
        "FVG",
        bars,
        { lower, upper, direction: up ? "bullish" : "bearish" },
        "Closed breach of far boundary withdraws old premise; wick fill is reported separately.",
      );
      findings.push(e);
      const breach = frame.bars.find(
        (x) =>
          x.segment === c.segment &&
          x.index > c.index &&
          (up ? x.close < lower : x.close > upper),
      );
      levels.push({
        id: e.id,
        kind: "FVG",
        timeframe: frame.timeframe,
        side: frame.side,
        lower,
        upper,
        role: up ? "support" : "resistance",
        confirmed_at: e.confirmed_at,
        invalidated_at: breach?.end ?? null,
        source_finding: e,
        qualified: true,
      });
    }
  }
  return { findings, levels };
}
export function detectInversions(frame: Frame, levels: KeyLevel[]) {
  const out: Finding[] = [];
  for (const level of levels.filter(
    (l) =>
      l.kind === "FVG" &&
      l.timeframe === frame.timeframe &&
      l.side === frame.side,
  )) {
    const origin = frame.bars.find((b) => b.end === level.confirmed_at);
    const b = frame.bars.find(
      (b) =>
        origin &&
        b.segment === origin.segment &&
        b.time >= level.confirmed_at &&
        (level.role === "support"
          ? b.close < level.lower
          : b.close > level.upper),
    );
    if (b)
      out.push(
        event(
          frame,
          "IFVG",
          "FVG_CLOSED_BREACH",
          [b],
          {
            source_id: level.id,
            old_role: level.role,
            opposite_role_confirmed: false,
          },
          "A breach alone does not prove a tradable inverted role.",
          "CANDIDATE",
          level.id,
        ),
      );
  }
  return out;
}
export function detectRaids(frame: Frame, pivots: Pivot[]) {
  const out: Finding[] = [];
  for (const p of pivots)
    for (const kind of ["TOUCH", "RAID"] as const) {
      const b = frame.bars.find(
        (b) =>
          b.segment === p.segment &&
          b.time >= p.confirmed_at &&
          (kind === "TOUCH"
            ? b[p.polarity] === p.price
            : p.polarity === "high"
              ? b.high > p.price
              : b.low < p.price),
      );
      if (b)
        out.push(
          event(
            frame,
            "RAID",
            kind,
            [b],
            {
              pivot_id: p.id,
              price: p.price,
              polarity: p.polarity,
              depth: Math.abs(b[p.polarity] - p.price),
              close_back:
                p.polarity === "high" ? b.close < p.price : b.close > p.price,
            },
            "Consumed liquidity; no automatic narrative cancellation.",
            "OBSERVED",
            p.id,
          ),
        );
    }
  return out;
}
export function knownLevel(level: KeyLevel, b: Bar, frame: Frame) {
  return (
    level.qualified &&
    level.side === frame.side &&
    Number.isFinite(level.lower) &&
    Number.isFinite(level.upper) &&
    level.lower > 0 &&
    level.upper >= level.lower &&
    level.confirmed_at <= b.time &&
    (!level.invalidated_at || level.invalidated_at > b.time) &&
    (!level.continuity_end || b.end <= level.continuity_end) &&
    TF_ORDER.indexOf(level.timeframe) <= TF_ORDER.indexOf(frame.timeframe)
  );
}
const hit = (b: Bar, l: KeyLevel) => b.high >= l.lower && b.low <= l.upper;
const interaction = (b: Bar, l: KeyLevel) =>
  l.kind === "FRACTAL"
    ? l.role === "support"
      ? b.low < l.lower
      : b.high > l.upper
    : hit(b, l);
export function detectRejectionBlocks(frame: Frame, context: KeyLevel[]) {
  const out: Finding[] = [];
  for (let i = 1; i < frame.bars.length; i++) {
    const a = frame.bars[i - 1],
      b = frame.bars[i];
    if (!contiguous([a, b]) || b.end>frame.as_of) continue;
    const up=a.close<a.open&&b.close>b.open,down=a.close>a.open&&b.close<b.open;
    if(!up&&!down)continue; // Doji and a lone rejection do not form RB.
    const eligible=context.filter(kl=>knownLevel(kl,a,frame)&&knownLevel(kl,b,frame)&&
      (!kl.invalidated_at||kl.invalidated_at>b.end)&&['FRACTAL','FVG'].includes(kl.kind)&&
      kl.role===(up?'support':'resistance')&&(interaction(a,kl)||interaction(b,kl))&&
      (kl.kind==='FVG'||((up?a.close>kl.upper&&b.close>kl.upper:a.close<kl.lower&&b.close<kl.lower)&&
        !frame.bars.slice(0,i-1).some(c=>c.time>=kl.confirmed_at&&interaction(c,kl)))))
      .sort((x,y)=>TF_ORDER.indexOf(x.timeframe)-TF_ORDER.indexOf(y.timeframe)||y.confirmed_at.localeCompare(x.confirmed_at)||x.id.localeCompare(y.id));
    // User clarification 2026-11-17: FVG interaction is sufficient, even when
    // bodies remain inside the zone. A strict, reclaimed liquidity raid is stronger.
    const raid=eligible.find(l=>l.kind==='FRACTAL'),fvg=eligible.find(l=>l.kind==='FVG');
    for (const kl of eligible) {
      const liquidity=kl.kind==='FRACTAL'?kl:raid,inefficiency=kl.kind==='FVG'?kl:fvg;
      out.push(
        event(
          frame,
          "RB",
          "RB_TWO_CANDLE",
          [a, b],
          {
            kl_id: kl.id,
            ...(liquidity?{rb_liquidity_id:liquidity.id}:{}),
            ...(inefficiency?{rb_fvg_id:inefficiency.id}:{}),
            revision:'rb-first-close-2',
            formation_confirmed:true,
            level_price:a.close,
            level_policy:'FIRST_CANDLE_CLOSE',
            basis:liquidity?(inefficiency?'FVG_AND_LIQUIDITY_RAID':'LIQUIDITY_RAID'):'FVG_INTERACTION',
            relative_quality:liquidity?'RAID_BACKED':'WEAKER_FVG_ONLY',
            quality_is_probability:false,
            significance:'REVIEW_REQUIRED',
            liquidity_history:liquidity?'NO_PRIOR_CROSSING_IN_OBSERVED_FRAME':'NOT_APPLICABLE',
            direction: up ? "bullish" : "bearish",
            envelope: {
              lower: Math.min(a.low, b.low),
              upper: Math.max(a.high, b.high),
            },
            author_bounds_verified: true,
            junction: {
              lower: a.close,
              upper: a.close,
            },
            schematic_reference:
              "el01_03/el01_04; user clarification 2026-11-17: first close, weaker FVG-only interaction; either wick can raid",
          },
          "Formation is observed; subsequent trade validity and stop placement require review, not automatic Narrative confirmation.",
          "OBSERVED",
          kl.id,
        ),
      );
    }
  }
  return out;
}
export function detectSnr(frame: Frame, context: KeyLevel[], lowerLevels: KeyLevel[] = []) {
  const out: Finding[] = [];
  for (let i=1;i<frame.bars.length;i++) {
    const a=frame.bars[i-1],b=frame.bars[i];
    if(!contiguous([a,b])||b.end>frame.as_of)continue;
    const resistance=a.close>a.open&&b.close<b.open,support=a.close<a.open&&b.close>b.open;
    if(!resistance&&!support)continue;
    const lower=a.close,upper=a.close;
    const later=frame.bars.slice(i+1).filter(x=>x.segment===a.segment&&x.end<=frame.as_of);
    const breakout=later.find(x=>resistance?x.close>upper:x.close<lower);
    if(!breakout)continue;
    const eligible=(kl:KeyLevel,x:Bar)=>['FRACTAL','FVG'].includes(kl.kind)&&knownLevel(kl,x,frame)&&(!kl.invalidated_at||kl.invalidated_at>breakout.end)&&knownLevel(kl,breakout,frame)&&interaction(x,kl)&&kl.role===(resistance?'support':'resistance');
    const delivery=later.find(x=>x.index<=breakout.index&&context.some(kl=>eligible(kl,x)));
    if(!delivery)continue;
    const kl=context.filter(kl=>eligible(kl,delivery)).sort((a,b)=>TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe)||b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id))[0];
    const formation=snrFormationContext(frame,a,b,delivery,breakout,lower,resistance,context,lowerLevels);
    out.push(event(frame,'SNR','SNR_CLOSED_BREAK',[a,b,delivery,breakout],{
      kl_id:kl.id,lower,upper,direction:resistance?'bullish':'bearish',old_role:resistance?'resistance':'support',proposed_role:resistance?'support':'resistance',
      fvg_required:false,bounds_policy:'FIRST_CANDLE_CLOSE',formation,
      ...(formation.x1_fvg_id?{snr_x1_fvg_id:formation.x1_fvg_id}:{}),...(formation.opposing_kl_id?{snr_opposing_kl_id:formation.opposing_kl_id}:{}),
      schematic_reference:'el02_01/el02_02/el02_04; user 2026-11-17: repeated failed tests, impulse and formation location matter',
    },'Own-TF counter-close withdraws the proposed role; formation strength is contextual and does not confirm Narrative or a successful retest.','CANDIDATE',a.time+':'+kl.id));
  }
  return out;
}
export function detectIdm(frame: Frame, pivots: Pivot[], pois: KeyLevel[]) {
  const out: Finding[] = [];
  for (const p of pivots)
    for (const poi of pois) {
      const gap =
        TF_ORDER.indexOf(frame.timeframe) - TF_ORDER.indexOf(poi.timeframe);
      if (
        !poi.qualified ||
        !Number.isFinite(poi.lower) ||
        !Number.isFinite(poi.upper) ||
        poi.lower <= 0 ||
        poi.upper < poi.lower ||
        gap < 0 ||
        gap > 1 ||
        poi.side !== frame.side ||
        poi.id === p.id ||
        poi.confirmed_at > p.confirmed_at ||
        (poi.continuity_end && poi.continuity_end < p.confirmed_at) ||
        (poi.invalidated_at && poi.invalidated_at <= p.confirmed_at) ||
        p.price < poi.lower ||
        p.price > poi.upper
      )
        continue;
      const bars = frame.bars.filter((b) =>
        p.candle_evidence.some((e) => e.index === b.index),
      );
      out.push(
        event(
          frame,
          "IDM",
          "IDM_INSIDE_POI",
          bars,
          {
            pivot_id: p.id,
            poi_id: poi.id,
            price: p.price,
            tf_relation: gap === 1 ? "X-1" : "X",
            poi_qualified: poi.qualified,
          },
          "POI invalidation or consumed fractal; entry also needs narrative and target.",
          "CANDIDATE",
          `${p.id}:${poi.id}`,
        ),
      );
    }
  return out;
}
export function detectStrong(
  frame: Frame,
  pivots: Pivot[],
  raids: Finding[],
  vc: Finding[],
) {
  const out: Finding[] = [];
  for (const p of pivots) {
    const raid = raids.find(
      (r) =>
        r.kind === "RAID" && r.facts.polarity===p.polarity && r.candle_evidence.some((b) => b.index === p.index),
    );
    if (!raid) continue;
    const proof = vc.find(
      (v) =>
        ["RB_TWO_CANDLE", "SNR_CLOSED_BREAK"].includes(v.kind) &&
        (v.kind==='RB_TWO_CANDLE'?v.facts.direction===(p.polarity==='low'?'bullish':'bearish'):v.facts.proposed_role===(p.polarity==='low'?'support':'resistance')) &&
        v.candle_evidence.some((b) => b.index === p.index) &&
        v.confirmed_at >= raid.confirmed_at,
    );
    if (!proof) continue;
    const bars = frame.bars.filter(
      (b) =>
        proof.candle_evidence.some((e) => e.index === b.index) ||
        p.candle_evidence.some((e) => e.index === b.index),
    );
    out.push(
      event(
        frame,
        "STRONG",
        "STRONG_PIVOT_CANDIDATE",
        bars,
        { pivot_id: p.id, raid_id: raid.id, vc_id: proof.id, price: p.price },
        "VC invalidation; author zone bounds remain unresolved.",
        "CANDIDATE",
        p.id,
      ),
    );
  }
  return out;
}
export function detectStructure(frame: Frame, pivots: Pivot[]) {
  // Author BOS/CHOCH machine criteria are not established; no generic pivot-break bias.
  void frame; void pivots;
  return { findings: [] as Finding[], bias: "Neutral", status: "NEEDS_SPECIFICATION" };
}

export function selectRange(
  frame: Frame,
  pivots: Pivot[],
  selection?: { high_id: string; low_id: string },
): { range: Range | null; findings: Finding[]; reason: string | null } {
  if (!selection)
    return {
      range: null,
      findings: [],
      reason: "EXPLICIT_RANGE_SELECTION_REQUIRED",
    };
  const high = pivots.find(
      (p) => p.id === selection.high_id && p.polarity === "high",
    ),
    low = pivots.find((p) => p.id === selection.low_id && p.polarity === "low");
  if (
    !high ||
    !low ||
    high.variant !== low.variant ||
    high.index === low.index ||
    high.segment !== low.segment ||
    high.price <= low.price
  )
    return {
      range: null,
      findings: [],
      reason: "INVALID_CONFIRMED_RANGE_PAIR",
    };
  const range: Range = {
    high_id: high.id,
    low_id: low.id,
    lower: low.price,
    upper: high.price,
    equilibrium: (high.price + low.price) / 2,
    confirmed_at:
      high.confirmed_at > low.confirmed_at
        ? high.confirmed_at
        : low.confirmed_at,
    origin: high.origin < low.origin ? high.origin : low.origin,
    timeframe: frame.timeframe,
    segment: high.segment,
  };
  const bars = frame.bars.filter((b) =>
    [...high.candle_evidence, ...low.candle_evidence].some(
      (e) => e.index === b.index,
    ),
  );
  return {
    range,
    findings: [
      event(
        frame,
        "DR",
        "DEALING_RANGE",
        bars,
        { ...range, selection: "explicit" },
        "Strict closed boundary break; internal raid alone is not full range invalidation.",
      ),
      event(
        frame,
        "PREMIUM_DISCOUNT",
        "PREMIUM_DISCOUNT",
        bars,
        {
          discount: [range.lower, range.equilibrium],
          premium: [range.equilibrium, range.upper],
          equilibrium: range.equilibrium,
        },
        "Recalculate only when selected range changes.",
      ),
    ],
    reason: null,
  };
}
export function assessRange(frame:Frame,range:Range|null){
 if(!range)return {state:'UNSELECTED',invalidated_at:null};
 const broken=frame.bars.find(b=>b.time>=range.confirmed_at&&b.segment===range.segment&&(b.close<range.lower||b.close>range.upper));
 return {state:broken?'INVALIDATED':range.segment!==frame.bars.at(-1)?.segment?'UNVERIFIED':'ACTIVE',invalidated_at:broken?.end??null};
}
export function detectIrl(frame: Frame, pivots: Pivot[], range: Range | null) {
  if (!range) return [];
  const invalidatedAt=assessRange(frame,range).invalidated_at;
  return pivots
    .filter(
      (p) =>
        p.segment === range.segment &&
        p.id !== range.high_id &&
        p.id !== range.low_id &&
        p.price > range.lower &&
        p.price < range.upper &&
        p.origin >= range.origin &&
        (!invalidatedAt || (p.confirmed_at>range.confirmed_at?p.confirmed_at:range.confirmed_at)<invalidatedAt),
    )
    .map((p) => {
      const end =
          p.confirmed_at > range.confirmed_at
            ? p.confirmed_at
            : range.confirmed_at,
        bars = frame.bars.filter(
          (b) =>
            p.candle_evidence.some((e) => e.index === b.index) || b.end === end,
        );
      return event(
        frame,
        "IRL",
        "INTERNAL_LIQUIDITY",
        bars,
        {
          pivot_id: p.id,
          range_high: range.high_id,
          range_low: range.low_id,
          price: p.price,
        },
        "Range invalidation or consumed pivot; continuation is not guaranteed.",
        "CANDIDATE",
        p.id,
      );
    });
}
export function measureCompression(
  frame: Frame,
  pivots: Pivot[],
  context: KeyLevel[],
) {
  const last = frame.bars.at(-1);
  if (!last) return [];
  const active = context.filter((l) => knownLevel(l, last, frame)),
    sequence = pivots.filter(
      (p) => p.variant === 3 && p.segment === last.segment,
    );
  return [
    event(
      frame,
      "COMPRESSION",
      "COMPRESSION_UNSPECIFIED",
      [last],
      {
        pivot_ids: sequence.map((p) => p.id),
        context_ids: active.map((l) => l.id),
        reversal: false,
      },
      "No classification until minimum count, speed/contraction and KL policy are specified.",
      "NEEDS_SPECIFICATION",
    ),
  ];
}
export function measureDisplacement(frame: Frame) {
  const b = frame.bars.at(-1);
  return b
    ? [
        event(
          frame,
          "DISPLACEMENT",
          "DISPLACEMENT_UNSPECIFIED",
          [b],
          {
            body: Math.abs(b.close - b.open),
            range: b.high - b.low,
            body_fraction:
              b.high === b.low
                ? null
                : Math.abs(b.close - b.open) / (b.high - b.low),
            direction:
              b.close > b.open ? "up" : b.close < b.open ? "down" : "flat",
          },
          "No aggression classification without a documented threshold.",
          "NEEDS_SPECIFICATION",
        ),
      ]
    : [];
}
export type SessionCalendar = {
  verified: boolean;
  timezone: string;
  instrument_type: "spot" | "cfd" | "futures";
  boundaries: {
    previous_close_time: string;
    next_open_time: string;
    previous_session_id: string;
    next_session_id: string;
  }[];
};
export function detectSessionGaps(frame: Frame, calendar?: SessionCalendar) {
  if (!calendar?.verified)
    return {
      findings: [],
      blocked: "VERIFIED_PROVIDER_SESSION_CALENDAR_REQUIRED",
    };
  try {
    new Intl.DateTimeFormat("en", { timeZone: calendar.timezone }).format(
      new Date(),
    );
  } catch {
    return { findings: [], blocked: "INVALID_TIMEZONE" };
  }
  const findings: Finding[] = [];
  for (const boundary of calendar.boundaries) {
    const a = frame.bars.find((b) => b.end === boundary.previous_close_time),
      b = frame.bars.find((b) => b.time === boundary.next_open_time);
    if (
      !a ||
      !b ||
      b.time < a.end ||
      boundary.previous_session_id === boundary.next_session_id ||
      a.close === b.open
    )
      continue;
    findings.push(
      event(
        frame,
        "SESSION_GAP",
        "SESSION_GAP",
        [a, b],
        {
          ...boundary,
          lower: Math.min(a.close, b.open),
          upper: Math.max(a.close, b.open),
          timezone: calendar.timezone,
          instrument_type: calendar.instrument_type,
        },
        "Gap fill is distinct from FVG; no fill-probability estimate.",
      ),
    );
  }
  return { findings, blocked: null };
}
export function detectOpeningLevels(frame: Frame) {
  if (!["W1", "MN1"].includes(frame.timeframe)) return [];
  return frame.bars.map((b) =>
    event(
      frame,
      frame.timeframe === "W1" ? "WEEKLY_OPEN" : "MONTHLY_OPEN",
      "PERIOD_OPEN",
      [b],
      {
        price: b.open,
        period_start: b.time,
        provider_boundary: true,
        closed_period_only: true,
      },
      "Historical opening fact; provider/session changes require separate series.",
    ),
  );
}
export function pivotLevels(pivots: Pivot[]): KeyLevel[] {
  return pivots.map((p) => ({
    id: p.id,
    kind: "FRACTAL",
    timeframe: p.timeframe,
    side: p.side,
    lower: p.price,
    upper: p.price,
    role: p.polarity === "low" ? "support" : "resistance",
    confirmed_at: p.confirmed_at,
    source_finding: p,
    qualified: true,
  }));
}
