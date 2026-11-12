import { ANALYSIS_TIMEFRAMES, type AnalysisSymbol, type SeriesAnalysis } from './technical-analysis';
import type { Timeframe } from './candle-data';
import type { SNRAudit } from './htf-snr';
import type { HtfStructure } from './htf-structure';
import type { Reliability } from './htf-data-quality';

export type CatalogEntry = {
  id: string; source_id: string; asset: AnalysisSymbol; timeframe: Timeframe; type: 'SNR' | 'FVG' | 'FORMING_FVG' | 'FRACTAL' | 'FORMING_FRACTAL' | 'RANGE_BOUNDARY' | 'ORDER_BLOCK' | 'BREAKER';
  lower: number; upper: number; role: 'support' | 'resistance' | 'boundary'; status: string; origin: unknown; test_count: number | null;
  last_test: string | null; break_status: string; retest_status: string; quality: unknown; evidence: unknown; invalidation: string;
  data_reliability: Reliability; main_tp_eligible: boolean; significant: boolean; downgrade_reasons: string[]; distance: number | null;
};

export function buildCompleteZoneCatalog(asset: AnalysisSymbol, snr: Record<Timeframe, SNRAudit>, analyses: SeriesAnalysis[], structures: Record<Timeframe, HtfStructure>, price: number | null) {
  const zones: CatalogEntry[] = [];
  const put = (z: Omit<CatalogEntry, 'distance'>) => zones.push({ ...z, distance: price === null ? null : Math.max(0, price - z.upper, z.lower - price) });
  for (const s of analyses) {
    const tf = s.timeframe, reliability = { ...snr[tf].data_reliability, scope: `snr.${tf}.data_reliability` };
    const common = { asset, timeframe: tf, test_count: null, last_test: null, break_status: 'not_applicable', retest_status: 'not_applicable', data_reliability: reliability };
    for (const z of snr[tf].zones) put({ id: z.id, source_id: z.id, asset, timeframe: tf, type: 'SNR', lower: z.lower, upper: z.upper,
      role: z.role, status: z.status, origin: { source:'snr', timeframe:tf, zone_id:z.id }, test_count: z.test_count, last_test: z.last_test,
      break_status: z.break_status, retest_status: z.retest_status, quality: z.quality,
      evidence: { source: 'snr', timeframe: tf, zone_id: z.id, tests: z.historical_test_count, reactions: z.reaction_count,
        events: z.evidence.events.length, note: 'Full evidence returned once in snr[timeframe].zones by zone_id; no evidence omitted' },
      invalidation: 'See source SNR invalidation rule', data_reliability: reliability,
      main_tp_eligible: false, significant: z.status === 'tested', downgrade_reasons: z.quality.downgrade_reasons });
    for (const g of [...s.fvgs, ...s.forming_fvgs]) {
      const active = g.confirmed && g.material && g.remaining_size > 0;
      put({ ...common, id: `${asset}:${g.id}`, source_id: g.id, type: g.confirmed ? 'FVG' : 'FORMING_FVG', lower: g.remaining_lower ?? g.lower, upper: g.remaining_upper ?? g.upper,
        role: g.direction === 'bullish' ? 'support' : 'resistance', status: g.confirmed ? g.status : 'forming', origin: { formed_at: g.formed_at, lower: g.lower, upper: g.upper },
        quality: { material: g.material, threshold_units: g.material_threshold_units }, evidence: { fill_percent: g.fill_percent, remaining_units: g.remaining_units, last_touch_at: g.last_touch_at },
        invalidation: 'Full wick fill removes target eligibility; forming penetration is explicitly observation only', significant: active, main_tp_eligible: tf !== 'H4' && active,
        downgrade_reasons: !g.confirmed ? ['FORMING'] : g.status === 'filled' ? ['FULLY_FILLED_ORIGINAL_BOUNDS_RETAINED'] : !g.material ? ['RESIDUAL_BELOW_MATERIALITY_THRESHOLD'] : [] });
    }
    for (const f of [...s.fractals, ...s.forming_fractals]) {
      const active = f.status === 'confirmed' && f.liquidity_status !== 'swept';
      put({ ...common, id: `${asset}:${f.id}`, source_id: f.id, type: f.status === 'confirmed' ? 'FRACTAL' : 'FORMING_FRACTAL', lower: f.price, upper: f.price,
        role: f.kind === 'high' ? 'resistance' : 'support', status: f.liquidity_status, origin: { time: f.time, confirmed_at: f.confirmed_at },
        quality: { strict_five_closed_bars: f.status === 'confirmed' }, evidence: { touched_at: f.touched_at, swept_at: f.swept_at, swept_by_forming_candle: f.swept_by_forming_candle },
        invalidation: 'Strict wick cross removes liquidity target; equality only touches', significant: active, main_tp_eligible: tf !== 'H4' && active,
        downgrade_reasons: f.status === 'forming' ? ['FORMING'] : f.liquidity_status === 'swept' ? ['LIQUIDITY_ALREADY_SWEPT'] : [] });
    }
    const r = s.ranges.selected;
    if (r.lower !== null && r.upper !== null) for (const [kind, p] of [['lower', r.lower], ['upper', r.upper]] as const)
      put({ ...common, id: `${asset}:${tf}:range:${kind}`, source_id: r.id, type: 'RANGE_BOUNDARY', lower: p, upper: p, role: 'boundary', status: r.status,
        origin: { high_id: r.high?.id, low_id: r.low?.id }, quality: { selection: s.ranges.selection_mode }, evidence: { equilibrium: r.equilibrium },
        invalidation: 'Selected reference range; not an independent target or signal', main_tp_eligible: false, significant: false, downgrade_reasons: ['REFERENCE_ONLY'] });
    for (const b of structures[tf].order_blocks) put({ ...common, id: `${asset}:${b.id}`, source_id: b.id, type: b.type, lower: b.lower, upper: b.upper,
      role: b.direction === 'bullish' ? 'support' : 'resistance', status: b.status, origin: { time: b.origin_time, confirmed_at: b.confirmed_at, structure_break_id: b.structure_break_id },
      quality: { basis: 'explicit_heuristic_not_probability' }, evidence: b.evidence, invalidation: 'Closed close beyond far edge', main_tp_eligible: false,
      significant: b.status === 'active', downgrade_reasons: b.status === 'invalidated' ? ['CLOSED_INVALIDATION'] : b.status === 'unverified_after_gap' ? ['DATA_GAP'] : [], break_status: b.invalidated_at ?? 'unbroken', retest_status: b.retested_at ?? 'none' });
  }
  zones.sort((a, b) => ANALYSIS_TIMEFRAMES.indexOf(a.timeframe) - ANALYSIS_TIMEFRAMES.indexOf(b.timeframe) || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.id.localeCompare(b.id));
  const significant = zones.filter(z => z.significant);
  const conflicts = [] as { a: string; b: string; lower: number; upper: number; reason: string }[];
  for (let i = 0; i < significant.length; i++) for (let j = i + 1; j < significant.length; j++) {
    const a = significant[i], b = significant[j];
    if (a.timeframe !== b.timeframe && a.role !== b.role && a.lower <= b.upper && a.upper >= b.lower)
      conflicts.push({ a: a.id, b: b.id, lower: Math.max(a.lower, b.lower), upper: Math.min(a.upper, b.upper), reason: 'Overlapping observed zones with opposite assigned roles; no automatic cancellation' });
  }
  const nearest = (role: 'support' | 'resistance') => price === null ? [] : significant.filter(z => z.role === role && (role === 'support' ? z.upper <= price : z.lower >= price))
    .sort((a, b) => a.distance! - b.distance! || ANALYSIS_TIMEFRAMES.indexOf(a.timeframe) - ANALYSIS_TIMEFRAMES.indexOf(b.timeframe)).map(z => z.id);
  return { zones, total: zones.length, omitted: 0, selection: 'all_loaded_candidates_including_downgraded_no_silent_topN',
    by_timeframe: Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf => [tf, { total: zones.filter(z => z.timeframe === tf).length, snr: snr[tf].all_zone_count }])),
    nearest: { supports: nearest('support'), resistances: nearest('resistance') },
    potential_interest: significant.map(z => z.id), current_zones: price === null ? [] : significant.filter(z => z.lower <= price && z.upper >= price).map(z => z.id),
    conflicts, structural_conflicts: ANALYSIS_TIMEFRAMES.flatMap((a, i) => ANALYSIS_TIMEFRAMES.slice(i + 1).filter(b => structures[a].bias !== 'undetermined' && structures[b].bias !== 'undetermined' && structures[a].bias !== structures[b].bias).map(b => ({ a, b, a_bias: structures[a].bias, b_bias: structures[b].bias }))),
    htf_priority: ANALYSIS_TIMEFRAMES, note: 'Bands and importance are heuristic; events are observed OHLC facts. SNR/OB never replace principal D1+ fractal/FVG targets.' };
}

export { calculateStructuralRisk } from './htf-risk';
