import { ANALYSIS_TIMEFRAMES, type SeriesAnalysis } from './technical-analysis';
import type { Timeframe } from './candle-data';
import type { SNRAudit, SNRZone } from './htf-snr';

export const SNR_COLORS: Record<Timeframe, string> = { MN1: '#c8a5ff', W1: '#66c8ff', D1: '#f1c76b', H4: '#57dab2' };
export type PriorityZone = Pick<SNRZone, 'id' | 'timeframe' | 'lower' | 'upper' | 'role' | 'provisional_role' | 'status' | 'current_state' | 'break_status' | 'retest_status' | 'origin' | 'confirmed_at'> & {
  position: 'above' | 'below' | 'inside' | 'unknown'; distance_atr: number | null; score: number;
  components: { timeframe: number; evidence: number; reaction: number; proximity: number; recency: number; confluence: number; penalty: number };
  tests: number; reactions: number; last_interaction: string; approach: SNRZone['evidence']['tests'][number]['approach'] | null;
  confluences: { source_id: string; timeframe: Timeframe; type: 'FVG' | 'FRACTAL' }[];
  events: SNRZone['evidence']['events']; event_history_total: number; event_history_omitted: number; selection_reasons: string[];
};

/** Ranking is a CURRENT snapshot, not a historical signal. Full evidence never leaves the full catalog. */
export function rankPriorityZones(snr: Partial<Record<Timeframe, SNRAudit>>, analyses: SeriesAnalysis[], reference: number | null, limit = 20) {
  const weights = { MN1: 24, W1: 20, D1: 10, H4: 4 };
  const ranked: PriorityZone[] = [];
  const excluded: { id: string; reason: string; represented_by?: string }[] = [];
  for (const tf of ANALYSIS_TIMEFRAMES) for (const z of snr[tf]?.zones ?? []) {
    const endpointTests = z.evidence.tests.filter(t => t.endpoint_near_zone).length;
    const htfWatch = (tf === 'MN1' || tf === 'W1') && z.reaction_count > 0 && endpointTests > 0;
    if (z.data_reliability.status === 'UNVERIFIED' || (z.status !== 'tested' && !htfWatch)) {
      excluded.push({ id: z.id, reason: z.data_reliability.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'INSUFFICIENT_ENDPOINT_EVIDENCE' }); continue;
    }
    const s = analyses.find(s => s.timeframe === tf), atr = s?.materiality.atr ?? z.origin.atr;
    const distance = reference === null ? null : Math.max(0, z.lower - reference, reference - z.upper);
    const distanceAtr = distance !== null && atr > 0 ? distance / atr : null;
    const last = z.evidence.tests.at(-1);
    const elapsedBars = last ? Math.max(0, (snr[tf]?.history.input ?? 0) - 1 - last.index) : Infinity;
    const confluences: PriorityZone['confluences'] = analyses.flatMap(a => [
      ...a.fvgs.filter(g => g.material && g.remaining_lower !== null && g.remaining_upper !== null && g.remaining_lower <= z.upper && g.remaining_upper >= z.lower)
        .map(g => ({ source_id: g.id, timeframe: a.timeframe, type: 'FVG' as const })),
      ...a.fractals.filter(f => f.liquidity_status !== 'swept' && f.price >= z.lower && f.price <= z.upper)
        .map(f => ({ source_id: f.id, timeframe: a.timeframe, type: 'FRACTAL' as const })),
    ]);
    const strength = Math.max(0, ...z.evidence.tests.map(t => t.reaction_atr ?? 0));
    const components = { timeframe: weights[tf], evidence: Math.min(24, endpointTests * 6), reaction: Math.min(12, z.reaction_count * 3) + Math.min(8, strength * 2),
      proximity: distanceAtr === null ? 0 : 24 / (1 + distanceAtr), recency: 6 / (1 + elapsedBars / 8), confluence: Math.min(6, confluences.length * 2),
      penalty: (z.status === 'watch' ? 18 : 0) + (z.break_status === 'unknown_after_gap' ? 20 : 0) };
    const score = components.timeframe + components.evidence + components.reaction + components.proximity + components.recency + components.confluence - components.penalty;
    ranked.push({ id: z.id, timeframe: tf, lower: z.lower, upper: z.upper, role: z.role, provisional_role: z.provisional_role, status: z.status,
      current_state: z.current_state, break_status: z.break_status, retest_status: z.retest_status, origin: z.origin, confirmed_at: z.confirmed_at,
      position: reference === null ? 'unknown' : reference < z.lower ? 'above' : reference > z.upper ? 'below' : 'inside', distance_atr: distanceAtr,
      score: Number(score.toFixed(4)), components, tests: z.test_count, reactions: z.reaction_count, last_interaction: z.last_interaction,
      approach: last?.approach ?? null, confluences, events: z.evidence.events.slice(-8), event_history_total:z.evidence.events.length,
      event_history_omitted:Math.max(0,z.evidence.events.length-8), selection_reasons: z.status === 'watch' ? ['HTF_WATCH_NOT_CONFIRMED'] : ['INDEPENDENT_SNR_EVIDENCE'] });
  }
  ranked.sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
  const selected: PriorityZone[] = [];
  const accept = (z: PriorityZone, reason: string) => {
    if (selected.some(p => p.id === z.id) || selected.length >= limit) return;
    const duplicate = selected.find(p => p.timeframe === z.timeframe && Math.min(p.upper,z.upper)-Math.max(p.lower,z.lower) >= Math.min(p.upper-p.lower,z.upper-z.lower)*0.75);
    if (duplicate) return;
    selected.push({ ...z, selection_reasons: [...z.selection_reasons, reason] });
  };
  // Explicit HTF representation, then nearest on each side, then scored capacity.
  for (const tf of ['MN1','W1'] as const) {
    const nearest=ranked.filter(z=>z.timeframe===tf).sort((a,b)=>(a.distance_atr??Infinity)-(b.distance_atr??Infinity)||b.score-a.score)[0];
    if(nearest)accept(nearest,'HTF_NEAREST');
    for (const z of ranked.filter(z=>z.timeframe===tf)) {
      if (selected.filter(z=>z.timeframe===tf).length >= 2) break; accept(z,'HTF_REPRESENTATION');
    }
  }
  for (const position of ['above','below','inside'] as const) {
    const nearest = ranked.filter(z=>z.position===position).sort((a,b)=>(a.distance_atr??Infinity)-(b.distance_atr??Infinity)||b.score-a.score)[0];
    if(nearest) accept(nearest,'NEAREST_BY_ATR');
  }
  for(const z of ranked) if(selected.filter(p=>p.timeframe===z.timeframe).length<6) accept(z,'SCORE');
  for(const z of ranked.filter(z=>!selected.some(p=>p.id===z.id))) {
    const representative = selected.find(p=>p.timeframe===z.timeframe && Math.min(p.upper,z.upper)-Math.max(p.lower,z.lower)>=Math.min(p.upper-p.lower,z.upper-z.lower)*0.75);
    excluded.push({id:z.id,reason:representative?'OVERLAPPING_PRIORITY_REPRESENTATIVE':'PRIORITY_CAPACITY_OR_TF_CAP',...(representative?{represented_by:representative.id}:{})});
  }
  selected.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
  return { zones:selected, full_snr_count:Object.values(snr).reduce((n,s)=>n+s.all_zone_count,0), selected_count:selected.length,
    excluded_from_priority:excluded, full_catalog_omitted:0,
    policy:{limit,per_timeframe_cap:6,minimum_available_MN1_W1:2,overlap_representative_ratio:0.75,
      formula:'TF + endpoint evidence + closed reaction + 24/(1+distance/ATR) + recency + capped confluence - uncertainty',
      confluence_required:false, score_is_probability:false, historical_signal:false } };
}
export type PriorityZones = ReturnType<typeof rankPriorityZones>;
