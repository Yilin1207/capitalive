import type { CandleResponse, PriceSide, Timeframe } from './candle-data';
import { prepareHtfBars, barCloseTime, type ClosedBar, type Reliability } from './htf-data-quality';
import { INSTRUMENTS, type AnalysisSymbol } from './technical-analysis';

export type SNRRole = 'support' | 'resistance';
export type ZoneInteraction = {
  time: string; index: number; segment: number; kind: 'origin' | 'wick_touch' | 'close_in_zone' | 'traverse';
  role: SNRRole; reaction: 'up' | 'down' | 'not_proven'; reaction_at: string | null; reaction_distance: number | null;
  endpoint_near_zone: boolean;
  reaction_atr: number | null; approach: { bars: number; net_move_atr: number | null; directional_efficiency: number | null };
};
export type SNRState = 'CLOSE_BREAK' | 'BREAK_PENDING' | 'CONFIRMED_BREAK' | 'RETEST' | 'FAILED_RECLAIM' | 'CONFIRMED_ROLE_REVERSAL' | 'SWEEP' | 'BREAK_INVALIDATED';
export type ZoneEvent = { type: 'close_break' | 'break_pending' | 'confirmed_break' | 'retest' | 'role_reversal' | 'failed_reclaim' | 'liquidity_sweep' | 'break_invalidated';
  state: SNRState; confidence: 'OBSERVED' | 'PROVISIONAL' | 'RULE_CONFIRMED'; facts: { close: number };
  time: string; confirmed_at: string; index: number; role: SNRRole; break_time?: string; retest_time?: string; evidence: string };
export type SNRZone = {
  id: string; asset: AnalysisSymbol; timeframe: Timeframe; side: PriceSide; type: 'SNR'; lower: number; upper: number;
  role: SNRRole; status: 'tested' | 'watch'; origin: { method: string; time: string; endpoint: 'high' | 'low'; price: number; atr: number; half_width: number; bounds: 'heuristic_frozen_at_origin' };
  test_count: number; historical_test_count: number; reaction_count: number; last_test: string; last_interaction: string;
  break_status: 'unbroken' | 'pending' | 'confirmed' | 'reclaimed' | 'unknown_after_gap'; retest_status: 'none' | 'pending' | 'confirmed';
  current_state: SNRState | null; provisional_role: SNRRole | null;
  quality: { score: number; basis: 'heuristic_not_probability'; downgrade_reasons: string[] };
  evidence: { tests: ZoneInteraction[]; events: ZoneEvent[]; clustered_endpoints: { time: string; kind: 'high' | 'low'; price: number }[] };
  invalidation: string; data_reliability: Reliability; distance_to_price: number | null; confirmed_at: string | null;
};
export type SNRConfig = { widthAtrFraction?: number; minTouchSeparation?: number; closeBreakBars?: number };
const priority = { MN1: 18, W1: 15, D1: 8, H4: 2 };
const round = (n: number) => Number(n.toPrecision(12));
const intersects = (b: ClosedBar, z: { lower: number; upper: number }) => b.high >= z.lower && b.low <= z.upper;
const sameSide = (b: ClosedBar, z: { lower: number; upper: number }, role: SNRRole) => role === 'support' ? b.close > z.upper : b.close < z.lower;

/** Causal endpoint clustering: frozen bands use ATR available at origin, never the last ATR. */
export function detectIndependentSNR(data: CandleResponse, asset: AnalysisSymbol, side: PriceSide = 'bid', reference: number | null = null, config: SNRConfig = {}) {
  const prepared = prepareHtfBars(data, side), { bars, reliability, confirmationsAllowed } = prepared;
  const widthFraction = config.widthAtrFraction ?? 0.05, separation = config.minTouchSeparation ?? 3, closeBars = config.closeBreakBars ?? 2;
  if (!Number.isFinite(widthFraction) || widthFraction <= 0 || widthFraction > 0.5 || !Number.isInteger(separation) || separation < 2 ||
    !Number.isInteger(closeBars) || closeBars < 1 || closeBars > 5) throw new Error('Invalid SNR configuration');
  if (reference !== null && (!Number.isFinite(reference) || reference <= 0)) reference = null;
  const unit = INSTRUMENTS[asset].unit_size;
  const zones: SNRZone[] = [];
  for (const b of bars) {
    for (const endpoint of ['high', 'low'] as const) {
      const value = b[endpoint];
      const match = zones.filter(z => value >= z.lower && value <= z.upper)
        .sort((a, z) => Math.abs(a.origin.price - value) - Math.abs(z.origin.price - value) || a.id.localeCompare(z.id))[0];
      if (match) { match.evidence.clustered_endpoints.push({ time: b.time, kind: endpoint, price: value }); continue; }
      const width = Math.max(unit * 3, b.atr * widthFraction);
      zones.push({ id: `${asset}:${data.timeframe}:${side}:snr:${b.time}:${endpoint}`, asset, timeframe: data.timeframe, side, type: 'SNR',
        lower: round(Math.max(unit * 0.01, value - width)), upper: round(value + width), role: endpoint === 'low' ? 'support' : 'resistance', status: 'watch',
        origin: { method: 'historical_OHLC_endpoint_cluster', time: b.time, endpoint, price: value, atr: b.atr, half_width: width, bounds: 'heuristic_frozen_at_origin' },
        test_count: 0, historical_test_count: 0, reaction_count: 0, last_test: b.time, last_interaction: b.time,
        break_status: 'unbroken', retest_status: 'none', current_state: null, provisional_role: null, quality: { score: 0, basis: 'heuristic_not_probability', downgrade_reasons: [] },
        evidence: { tests: [], events: [], clustered_endpoints: [{ time: b.time, kind: endpoint, price: value }] },
        invalidation: 'See parameters.role_reversal_rule',
        data_reliability: { ...reliability, scope:'frame_data_reliability' }, distance_to_price: reference === null ? null : round(Math.max(0, reference - (value + width), (value - width) - reference)), confirmed_at: null });
    }
  }
  for (const z of zones) {
    const start = bars.findIndex(b => b.time === z.origin.time);
    let role = z.role, segment = bars[start].segment, away = true, lastTest = -Infinity, consecutive = 0;
    let pendingBreak: { time: string; index: number; to: SNRRole; retest: ClosedBar | null; confirmed: boolean; consecutive: number } | null = null;
    let proofReset = start, testedAt: string | null = null;
    const states: Record<ZoneEvent['type'], SNRState> = { close_break: 'CLOSE_BREAK', break_pending: 'BREAK_PENDING', confirmed_break: 'CONFIRMED_BREAK',
      retest: 'RETEST', failed_reclaim: 'FAILED_RECLAIM', role_reversal: 'CONFIRMED_ROLE_REVERSAL', liquidity_sweep: 'SWEEP', break_invalidated: 'BREAK_INVALIDATED' };
    const add = (type: ZoneEvent['type'], b: ClosedBar, criterion: string) => {
      z.evidence.events.push({ type, time: b.time, confirmed_at: barCloseTime(data.candles[b.index], data.timeframe, data.candles[b.index + 1]),
        state: states[type], confidence: type === 'break_pending' ? 'PROVISIONAL' : type === 'confirmed_break' || type === 'role_reversal' ? 'RULE_CONFIRMED' : 'OBSERVED',
        facts: { close: b.close }, index: b.index, role, ...(pendingBreak ? { break_time: pendingBreak.time } : {}),
        ...(pendingBreak?.retest ? { retest_time: pendingBreak.retest.time } : {}), evidence: criterion });
      z.current_state = states[type];
      z.last_interaction = b.time;
    };
    for (let i = start; i < bars.length; i++) {
      const b = bars[i];
      if (b.segment !== segment) {
        segment = b.segment; away = true; lastTest = -Infinity; consecutive = 0; pendingBreak = null; proofReset = i; testedAt = null;
        z.break_status = 'unknown_after_gap'; z.retest_status = 'none';
        z.current_state = null; z.provisional_role = null;
        role = b.close > z.upper ? 'support' : b.close < z.lower ? 'resistance' : role;
      }
      const touch = intersects(b, z);
      if (touch) z.last_interaction = b.time;
      if (touch && away && i - lastTest >= separation) {
        const prev = bars.slice(Math.max(proofReset, i - 3), i);
        const path = prev.length ? [...prev.map(p => p.close), b.close] : [];
        const total = path.slice(1).reduce((sum, p, j) => sum + Math.abs(p - path[j]), 0);
        z.evidence.tests.push({ time: b.time, index: b.index, segment, kind: i === start ? 'origin' : b.close >= z.lower && b.close <= z.upper ? 'close_in_zone' : b.low < z.lower && b.high > z.upper ? 'traverse' : 'wick_touch',
          role, reaction: 'not_proven', reaction_at: null, reaction_distance: null, reaction_atr: null,
          endpoint_near_zone: (b.low >= z.lower && b.low <= z.upper) || (b.high >= z.lower && b.high <= z.upper),
          approach: { bars: prev.length, net_move_atr: path.length && b.atr ? round((b.close - path[0]) / b.atr) : null,
            directional_efficiency: total > 0 ? round(Math.abs(b.close - path[0]) / total) : null } });
        lastTest = i;
      }
      // A contiguous stay in the band is ONE episode. New tests require a whole bar away.
      away = !touch;
      for (const test of z.evidence.tests) {
        if (test.segment !== segment || test.reaction !== 'not_proven' || b.index - test.index > 3 || b.index < test.index) continue;
        const move = test.role === 'support' ? b.close - z.upper : z.lower - b.close;
        const originBar = bars.find(p => p.index === test.index)!;
        if (move >= originBar.atr * 0.3 && move > 0) {
          test.reaction = test.role === 'support' ? 'up' : 'down'; test.reaction_at = b.time;
          test.reaction_distance = round(move); test.reaction_atr = originBar.atr > 0 ? round(move / originBar.atr) : null;
        }
      }
      const currentTests = z.evidence.tests.filter(t => t.segment === segment && t.index >= bars[proofReset].index);
      if (currentTests.filter(t => t.endpoint_near_zone).length >= 2 && currentTests.some(t => t.endpoint_near_zone && t.reaction !== 'not_proven') && testedAt === null && confirmationsAllowed) testedAt = b.time;
      if (i === start || !confirmationsAllowed) continue;
      let cancelled = false;
      if (pendingBreak) {
        if (sameSide(b, z, role)) {
          add('break_invalidated', b, 'closed_reclaim_of_old_side');
          pendingBreak = null; z.retest_status = 'none'; z.break_status = 'reclaimed'; z.provisional_role = null; consecutive = 0; cancelled = true;
        } else {
          pendingBreak.consecutive = sameSide(b, z, pendingBreak.to) ? pendingBreak.consecutive + 1 : 0;
          if (!pendingBreak.confirmed && pendingBreak.consecutive >= closeBars) {
            pendingBreak.confirmed = true; z.break_status = 'confirmed'; add('confirmed_break', b, 'consecutive_closed_closes_outside');
          }
          if (pendingBreak.retest && b.index > pendingBreak.retest.index && pendingBreak.confirmed && sameSide(b, z, pendingBreak.to)) {
            add('role_reversal', b, 'confirmed_break_then_failed_reclaim_then_later_closed_hold');
            role = pendingBreak.to; pendingBreak = null; z.provisional_role = null; z.retest_status = 'confirmed'; consecutive = 0;
          } else if (b.index > pendingBreak.index && touch) {
            // Every visit is an observed retest, even before a rejection/confirmation.
            if (!z.evidence.events.some(e => e.type === 'retest' && e.break_time === pendingBreak!.time)) add('retest', b, 'post_close_break_overlap');
            z.retest_status = 'pending';
            if (sameSide(b, z, pendingBreak.to) && !pendingBreak.retest) {
              pendingBreak.retest = b; add('failed_reclaim', b, 'post_break_overlap_closes_on_broken_side');
            }
          }
        }
      }
      if (!pendingBreak && !cancelled) {
        const beyond = role === 'support' ? b.close < z.lower : b.close > z.upper;
        consecutive = beyond ? consecutive + 1 : 0;
        if (beyond && testedAt !== null && testedAt < b.time) {
          pendingBreak = { time: b.time, index: b.index, to: role === 'support' ? 'resistance' : 'support', retest: null, confirmed: false, consecutive: 1 };
          z.provisional_role = pendingBreak.to; z.break_status = 'pending';
          add('close_break', b, 'one_strict_closed_close_beyond_far_edge'); add('break_pending', b, 'await_additional_evidence');
          const priorAtr = bars[i - 1]?.segment === segment ? bars[i - 1].atr : 0;
          const distance = role === 'support' ? z.lower - b.close : b.close - z.upper;
          const body = role === 'support' ? b.open - b.close : b.close - b.open;
          const edge = role === 'support' ? b.close - b.low : b.high - b.close;
          const strong = priorAtr > 0 && distance >= priorAtr * 0.5 && body >= priorAtr * 0.8 && b.high > b.low && edge / (b.high - b.low) <= 0.25;
          if (strong || closeBars === 1) {
            pendingBreak.confirmed = true; z.break_status = 'confirmed';
            add('confirmed_break', b, strong ? 'displacement_ge_0.5_prior_ATR_body_ge_0.8_prior_ATR_close_in_outer_quarter' : 'configured_single_close');
          }
        } else if (consecutive >= closeBars) {
          // Unproven seed: positional role only, not a confirmed SNR reversal.
          role = role === 'support' ? 'resistance' : 'support'; consecutive = 0;
        }
      }
      if (!pendingBreak && !cancelled && (role === 'support' ? b.low < z.lower && b.close > z.upper : b.high > z.upper && b.close < z.lower))
        add('liquidity_sweep', b, 'strict_wick_cross_and_closed_return_no_close_break');
    }
    const currentTests = z.evidence.tests.filter(t => t.segment === segment && t.index >= bars[proofReset].index);
    z.role = role; z.test_count = currentTests.length; z.historical_test_count = z.evidence.tests.length;
    z.reaction_count = currentTests.filter(t => t.reaction !== 'not_proven').length;
    z.last_test = z.evidence.tests.at(-1)?.time ?? z.origin.time;
    const confirmationBar = testedAt ? bars.find(b => b.time === testedAt) : undefined;
    z.confirmed_at = confirmationBar ? barCloseTime(data.candles[confirmationBar.index], data.timeframe, data.candles[confirmationBar.index + 1]) : null;
    z.status = testedAt !== null ? 'tested' : 'watch';
    if (!prepared.currentSegmentVerified) { z.status = 'watch'; z.break_status = 'unknown_after_gap'; z.confirmed_at = null; }
    z.quality.downgrade_reasons = [
      ...(z.test_count < 2 ? ['FEWER_THAN_TWO_SEPARATE_EPISODES'] : []),
      ...(currentTests.filter(t => t.endpoint_near_zone).length < 2 ? ['FEWER_THAN_TWO_ENDPOINT_BACKED_EPISODES'] : []),
      ...(!z.reaction_count ? ['NO_CLOSED_DIRECTIONAL_REACTION'] : []),
      ...(!confirmationsAllowed ? ['UNVERIFIED_INPUT'] : []),
      ...(proofReset !== start ? ['PROOF_RESET_AFTER_DATA_BARRIER'] : []),
      ...(!prepared.currentSegmentVerified ? ['TRAILING_DATA_GAP'] : []),
      ...(z.last_interaction < (bars.at(-12)?.time ?? '') ? ['NO_RECENT_INTERACTION_LAST_12_CLOSED_BARS'] : []),
    ];
    z.quality.score = priority[data.timeframe] + Math.min(24, z.test_count * 4) + Math.min(20, z.reaction_count * 4)
      + (z.evidence.events.some(e => e.type === 'role_reversal') ? 10 : 0) - (z.status === 'watch' ? 15 : 0);
  }
  zones.sort((a, b) => b.quality.score - a.quality.score || (a.distance_to_price ?? Infinity) - (b.distance_to_price ?? Infinity) || a.id.localeCompare(b.id));
  return { timeframe: data.timeframe, asset, side, reference_price: reference, data_reliability: reliability,
    history: { input: data.candles.length, accepted_closed: bars.length, first: bars[0]?.time ?? null, last: bars.at(-1)?.time ?? null, excluded: prepared.excluded },
    parameters: { width_atr_fraction: widthFraction, min_width_units: 3, minimum_test_separation_bars: separation, close_break_bars: closeBars,
      early_break: 'one_close_plus_0.5_prior_ATR_displacement_0.8_prior_ATR_directional_body_close_outer_quarter',
      role_reversal_rule:'rule_confirmed_break_then_later_failed_reclaim_then_subsequent_closed_hold; closed_reclaim_old_side_cancels_cycle',
      confidence: 'categorical_evidence_only_not_success_probability; RULE_CONFIRMED_is_a_heuristic_rule',
      reaction_min_atr: 0.3, reaction_window_bars: 3, independent_test: 'whole_bar_away_then_new_overlap', atr: 'causal_simple_mean_TR_up_to_14_closed_bars' },
    zones, all_zone_count: zones.length, selection: 'all_candidates_no_topN_truncation',
    facts_scope: 'closed_OHLC_observations', time_semantics: 'time_and_reaction_at_are_bar_start_UTC; confirmed_at_is_close_time',
    heuristic_scope: 'clustering_width_reaction_threshold_score_not_probability' };
}
export type SNRAudit = ReturnType<typeof detectIndependentSNR>;
