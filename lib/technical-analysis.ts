import { HISTORY, type Candle, type CandleResponse, type PriceSide, type Timeframe } from "./candle-data";

export const ANALYSIS_SYMBOLS = ["EURUSD", "NAS100", "EU50"] as const;
export type AnalysisSymbol = typeof ANALYSIS_SYMBOLS[number];
export const ANALYSIS_TIMEFRAMES = ["MN1", "W1", "D1", "H4"] as const;
export const INSTRUMENTS = {
  EURUSD: { unit: "pip", unit_size: 0.0001, precision: 5, min_remaining_units: 0.5 },
  NAS100: { unit: "point", unit_size: 1, precision: 2, min_remaining_units: 1 },
  EU50: { unit: "point", unit_size: 1, precision: 2, min_remaining_units: 1 },
} as const;
export type AnalysisSettings = { min_remaining_units: number; atr_fraction: number };
export type RangeSelection = { high_id: string; low_id: string };
export class RangeSelectionError extends Error {
  readonly code = "INVALID_RANGE_SELECTION";
}
export type Fractal = {
  id: string; timeframe: Timeframe; side: PriceSide; kind: "high" | "low"; time: string; price: number;
  status: "confirmed" | "forming"; confirmation_bar_time: string | null; confirmed_at: string | null;
  right_closed_bars: number; liquidity_status: "untouched" | "touched" | "swept" | "unconfirmed";
  touched_at: string | null; touched_by_forming_candle: boolean;
  swept_at: string | null; swept_by_forming_candle: boolean; index: number;
};
export type Gap = {
  id: string; timeframe: Timeframe; side: PriceSide; direction: "bullish" | "bearish";
  lower: number; upper: number; original_size: number; original_units: number;
  remaining_lower: number | null; remaining_upper: number | null; remaining_size: number; remaining_units: number;
  fill_percent: number; formed_at: string; confirmed: boolean; last_touch_at: string | null;
  status: "untouched" | "partial" | "filled"; material: boolean; material_threshold_units: number;
  index: number;
};
export type DealingRange = {
  id: string; status: "confirmed" | "unconfirmed"; high: Fractal | null; low: Fractal | null;
  lower: number | null; upper: number | null; equilibrium: number | null;
  premium: [number, number] | null; discount: [number, number] | null;
  price_position: "above_range" | "below_range" | "premium" | "discount" | "equilibrium" | "unknown";
  boundaries_swept: boolean; boundaries_touched: boolean; selection_reason: string;
};

function usable(c: Candle, side: PriceSide) {
  const o = c.open[side], h = c.high[side], l = c.low[side], v = c.close[side];
  return [o, h, l, v].every(x => typeof x === "number" && Number.isFinite(x))
    && l! <= Math.min(o!, v!) && h! >= Math.max(o!, v!) && c.history_completeness !== "partial_validation";
}
function closeTime(c: Candle, next: Candle | undefined, tf: Timeframe) {
  const nominal = c.end_time ? Date.parse(c.end_time) : tf === "MN1"
    ? Date.UTC(new Date(c.time).getUTCFullYear(), new Date(c.time).getUTCMonth() + 1, 1)
    : Date.parse(c.time) + HISTORY[tf].seconds * 1000;
  return new Date(Math.min(nominal, next ? Date.parse(next.time) : Infinity)).toISOString();
}
function range(high: Fractal | null, low: Fractal | null, price: number | null, reason: string): DealingRange {
  const valid = high !== null && low !== null && high.price > low.price;
  const eq = valid ? (high!.price + low!.price) / 2 : null;
  return {
    id: `${high?.id ?? "missing-high"}/${low?.id ?? "missing-low"}`,
    status: valid && high!.status === "confirmed" && low!.status === "confirmed" ? "confirmed" : "unconfirmed",
    high, low, lower: valid ? low!.price : null, upper: valid ? high!.price : null, equilibrium: eq,
    premium: valid ? [eq!, high!.price] : null, discount: valid ? [low!.price, eq!] : null,
    price_position: !valid || price === null ? "unknown" : price > high!.price ? "above_range" : price < low!.price ? "below_range"
      : price > eq! ? "premium" : price < eq! ? "discount" : "equilibrium",
    boundaries_swept: high?.liquidity_status === "swept" || low?.liquidity_status === "swept",
    boundaries_touched: high?.touched_at != null || low?.touched_at != null, selection_reason: reason,
  };
}

/** All calculations use ONE price side. No averaging of independently timed bid/ask extrema. */
export function analyzeSeries(data: CandleResponse, symbol: AnalysisSymbol, side: PriceSide = "bid", overrides: Partial<AnalysisSettings> = {}, referencePrice?: number | null, selection?: RangeSelection) {
  const candles = data.candles, tf = data.timeframe, instrument = INSTRUMENTS[symbol];
  const settings: AnalysisSettings = { min_remaining_units: instrument.min_remaining_units, atr_fraction: 0.02, ...overrides };
  const rejected = data.metadata.validation_gaps ?? data.metadata.diagnostics.missing_filtered_times;
  const validWindow = (start: number, end: number) => data.metadata.discarded_reasons.invalid_time === 0
    && candles.slice(start, end + 1).every(c => usable(c, side))
    && !rejected.some(time => time > candles[start].time && time < candles[end].time)
    && (tf !== "MN1" || candles.slice(start + 1, end + 1).every((c, index) => {
      const previous = new Date(candles[start + index].time);
      return Date.parse(c.time) === Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 1);
    }));
  const fractals: Fractal[] = [];
  for (let i = 2; i < candles.length; i++) {
    const end = Math.min(candles.length - 1, i + 2);
    if (!validWindow(i - 2, end)) continue;
    for (const kind of ["high", "low"] as const) {
      const price = candles[i][kind][side]!;
      const neighbours = candles.slice(i - 2, end + 1).filter(c => c !== candles[i]);
      // Strict inequalities: ties are never fractals, including a tie on an open right bar.
      if (!neighbours.every(c => kind === "high" ? price > c.high[side]! : price < c.low[side]!)) continue;
      const right = candles.slice(i + 1, i + 3).filter(c => c.is_closed).length;
      const confirmed = end === i + 2 && candles.slice(i - 2, i + 3).every(c => c.is_closed);
      const later = confirmed ? candles.slice(i + 3) : [];
      const touch = later.find(c => c[kind][side] === price);
      const sweep = later.find(c => {
        const p = c[kind][side];
        return p !== null && (kind === "high" ? p > price : p < price);
      });
      fractals.push({ id: `${tf}:${side}:${kind}:${candles[i].time}`, timeframe: tf, side, kind, time: candles[i].time, price,
        status: confirmed ? "confirmed" : "forming", confirmation_bar_time: confirmed ? candles[i + 2].time : null,
        confirmed_at: confirmed ? closeTime(candles[i + 2], candles[i + 3], tf) : null,
        right_closed_bars: right, liquidity_status: !confirmed ? "unconfirmed" : sweep ? "swept" : touch ? "touched" : "untouched",
        touched_at: touch?.time ?? null, touched_by_forming_candle: touch ? !touch.is_closed : false,
        swept_at: sweep?.time ?? null, swept_by_forming_candle: sweep ? !sweep.is_closed : false, index: i });
    }
  }
  const confirmed = fractals.filter(f => f.status === "confirmed");
  const forming = fractals.filter(f => f.status === "forming");
  const current = referencePrice === undefined ? candles.at(-1)?.close[side] ?? null : referencePrice;
  // Candidate pairs are opposite confirmed pivots with no other opposite pivot between them.
  // Keep historical/swept ranges explicit; their existence does not require BOS/CHOCH.
  const candidates: DealingRange[] = [];
  for (let i = confirmed.length - 1; i >= 0; i--) {
    const pivot = confirmed[i];
    const opposite = confirmed.slice(0, i).findLast(f => f.kind !== pivot.kind && f.time !== pivot.time);
    if (!opposite) continue;
    const high = pivot.kind === "high" ? pivot : opposite, low = pivot.kind === "low" ? pivot : opposite;
    if (high.price <= low.price) continue;
    candidates.push(range(high, low, current, "Most recent opposite confirmed pivots in time order; no BOS/CHOCH requirement."));
  }
  const automatic = candidates[0] ?? range(confirmed.findLast(f => f.kind === "high") ?? null,
    confirmed.findLast(f => f.kind === "low") ?? null, current, "A valid opposite confirmed fractal pair is missing; no substitute extrema.");
  let selected = automatic;
  if (selection) {
    if (tf !== "H4") throw new RangeSelectionError("Explicit fractal selection is supported only for H4");
    const high = confirmed.find(f => f.id === selection.high_id && f.kind === "high");
    const low = confirmed.find(f => f.id === selection.low_id && f.kind === "low");
    if (!high || !low) throw new RangeSelectionError("Select confirmed H4 high and low IDs from this symbol, side and loaded history");
    if (high.time === low.time || high.price <= low.price) throw new RangeSelectionError("Range requires distinct fractal candles and high price greater than low price");
    selected = range(high, low, current, "Explicit user-selected confirmed H4 fractals; no automatic substitution or BOS/CHOCH requirement.");
  }
  const potential = forming.map(f => {
    const opposite = confirmed.findLast(p => p.kind !== f.kind && p.time < f.time) ?? null;
    return range(f.kind === "high" ? f : opposite, f.kind === "low" ? f : opposite, current,
      "Provisional pivot awaiting two closed right candles; not a confirmed dealing range.");
  });
  const trueRanges: number[] = [];
  candles.forEach((c, i) => {
    if (!c.is_closed || !usable(c, side)) return;
    const prev = i ? candles[i - 1].close[side] : null;
    trueRanges.push(Math.max(c.high[side]! - c.low[side]!, prev === null ? 0 : Math.abs(c.high[side]! - prev), prev === null ? 0 : Math.abs(c.low[side]! - prev)));
  });
  const sample = trueRanges.slice(-14);
  const atr = sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : null;
  const threshold = Math.max(settings.min_remaining_units, (atr ?? 0) * settings.atr_fraction / instrument.unit_size);
  const gaps: Gap[] = [];
  for (let i = 2; i < candles.length; i++) {
    if (!validWindow(i - 2, i)) continue;
    const a = candles[i - 2], c = candles[i];
    const bullish = c.low[side]! > a.high[side]!, bearish = c.high[side]! < a.low[side]!;
    if (!bullish && !bearish) continue;
    const lower = bullish ? a.high[side]! : c.high[side]!, upper = bullish ? c.low[side]! : a.low[side]!;
    let remainingLower = lower, remainingUpper = upper, touch: string | null = null;
    for (const later of candles.slice(i + 1)) {
      const price = bullish ? later.low[side] : later.high[side];
      if (price === null) continue;
      if ((bullish && price <= upper) || (!bullish && price >= lower)) {
        touch = later.time;
        if (bullish) remainingUpper = Math.max(lower, Math.min(remainingUpper, price));
        else remainingLower = Math.min(upper, Math.max(remainingLower, price));
      }
      // Once completely filled, later visits cannot change the original gap's lifecycle.
      if (remainingUpper <= remainingLower) break;
    }
    const size = upper - lower, remaining = Math.max(0, remainingUpper - remainingLower);
    const confirmedGap = candles.slice(i - 2, i + 1).every(bar => bar.is_closed);
    gaps.push({ id: `${tf}:${side}:fvg:${c.time}`, timeframe: tf, side, direction: bullish ? "bullish" : "bearish",
      lower, upper, original_size: size, original_units: size / instrument.unit_size,
      remaining_lower: remaining > 0 ? remainingLower : null, remaining_upper: remaining > 0 ? remainingUpper : null,
      remaining_size: remaining, remaining_units: remaining / instrument.unit_size,
      fill_percent: Math.max(0, Math.min(100, (1 - remaining / size) * 100)), formed_at: c.time,
      confirmed: confirmedGap, last_touch_at: touch, status: remaining === 0 ? "filled" : remaining < size ? "partial" : "untouched",
      material: confirmedGap && remaining > 0 && remaining / instrument.unit_size + 1e-9 >= threshold,
      material_threshold_units: threshold, index: i });
  }
  const warnings: string[] = [];
  if (candles.length < 5) warnings.push("INSUFFICIENT_BARS_FOR_FRACTALS");
  if (data.metadata.insufficient_history) warnings.push("REQUESTED_HISTORY_INCOMPLETE");
  if (data.metadata.discarded_rows || data.metadata.discarded_sides || candles.some(c => !usable(c, side))) warnings.push("VALIDATION_GAPS_OR_INCOMPLETE_PRICE_SIDE");
  if (data.metadata.discarded_reasons.invalid_time) warnings.push("UNLOCATABLE_REJECTED_ROWS_CONFIRMATIONS_SUPPRESSED");
  if (data.metadata.diagnostics.current_period.status !== "present") warnings.push("CURRENT_PERIOD_MISSING");
  if (data.metadata.diagnostics.provider_gap_slots) warnings.push("NOMINAL_GAPS_SESSION_CALENDAR_NOT_VERIFIED");
  if (tf === "MN1") warnings.push("MONTHLY_SESSION_COMPLETENESS_NOT_VERIFIED");
  if (data.metadata.diagnostics.rejected_rows_omitted && !data.metadata.validation_gaps) warnings.push("VALIDATION_GAP_DETAILS_TRUNCATED");
  return {
    timeframe: tf, side, fetched_at: data.fetched_at, reference_price: current,
    reference_basis: referencePrice === undefined ? "last_candle_close_not_live_tick" : "quote",
    fractals: confirmed, touched_fractals: confirmed.filter(f => f.liquidity_status === "touched"), swept_fractals: confirmed.filter(f => f.liquidity_status === "swept"), forming_fractals: forming,
    ranges: { selected, selection_mode: selection ? "explicit_fractals" : "automatic", ...(selection ? { automatic } : {}),
      alternatives: candidates.filter(r => r.id !== selected.id).slice(0, 12),
      alternatives_omitted: Math.max(0, candidates.filter(r => r.id !== selected.id).length - 12), potential, reaction_strength: null },
    fvgs: gaps.filter(g => g.confirmed), forming_fvgs: gaps.filter(g => !g.confirmed),
    materiality: { ...settings, unit: instrument.unit, unit_size: instrument.unit_size, atr, atr_period: 14, atr_samples: sample.length, atr_method: "simple_mean_true_range_closed_bars", threshold_units: threshold },
    warnings,
    rules: { fractal: "strict_5_bar_two_closed_right", ties: "reject", touch: "exact_equality_of_later_extreme_including_forming_bar",
      sweep: "strict_cross_beyond_level_including_forming_bar_no_close_back_required",
      fvg: "strict_three_bar_wick_gap_closed_bars", fill: "maximum_wick_penetration_after_third_bar_including_forming_bar",
      coverage: "observed_history_only_missing_sessions_may_hide_sweeps_or_fills", range: "confirmed_fractal_high_to_confirmed_fractal_low" },
  };
}
export type SeriesAnalysis = ReturnType<typeof analyzeSeries>;

export function targetMap(series: SeriesAnalysis[], price: number | null) {
  type Level = { source_id: string; timeframe: Timeframe; kind: "fractal_high" | "fractal_low" | "fvg_boundary"; price: number; eligible_d1_plus: boolean; liquidity_status?: Fractal["liquidity_status"] };
  const levels: Level[] = [];
  for (const s of series) {
    for (const f of s.fractals.filter(f => f.liquidity_status !== "swept")) levels.push({ source_id: f.id, timeframe: s.timeframe,
      kind: f.kind === "high" ? "fractal_high" : "fractal_low", price: f.price, eligible_d1_plus: s.timeframe !== "H4", liquidity_status: f.liquidity_status });
    for (const g of s.fvgs.filter(g => g.material && g.status !== "filled")) {
      for (const boundary of [g.remaining_lower!, g.remaining_upper!]) levels.push({ source_id: g.id, timeframe: s.timeframe, kind: "fvg_boundary", price: boundary, eligible_d1_plus: s.timeframe !== "H4" });
    }
  }
  const direction = (above: boolean) => {
    if (price === null) return { nearest: null, alternatives: [], intermediate_obstacles: [] };
    const sorted = levels.filter(l => above ? l.price > price && l.kind !== "fractal_low" : l.price < price && l.kind !== "fractal_high")
      .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price) || a.source_id.localeCompare(b.source_id));
    const eligible = sorted.filter(l => l.eligible_d1_plus);
    const nearest = eligible[0] ?? null;
    return { nearest, alternatives: eligible.slice(1), intermediate_obstacles: nearest ? sorted.filter(l => Math.abs(l.price - price) < Math.abs(nearest.price - price)) : sorted.filter(l => !l.eligible_d1_plus) };
  };
  const currentZones = price === null ? [] : series.flatMap(s => s.fvgs.filter(g => g.material && g.remaining_lower! <= price && g.remaining_upper! >= price)
    .map(g => ({ source_id: g.id, timeframe: s.timeframe, lower: g.remaining_lower, upper: g.remaining_upper, eligible_d1_plus: s.timeframe !== "H4" })));
  return { reference_price: price, above: direction(true), below: direction(false), current_zones: currentZones,
    facts: "Observed levels only; nearest eligible D1/W1/MN1 level per direction. H4 is an intermediate obstacle only.",
    hypotheses: [], probability: null, coverage: "loaded_history_only_not_exhaustive" };
}
