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
export type ZoneEvent = { type: 'close_break' | 'retest' | 'role_reversal' | 'failed_reclaim' | 'liquidity_sweep';
  time: string; confirmed_at: string; index: number; role: SNRRole; break_time: string | null; retest_time: string | null; evidence: string };
export type SNRZone = {
  id: string; asset: AnalysisSymbol; timeframe: Timeframe; side: PriceSide; type: 'SNR'; lower: number; upper: number;
  role: SNRRole; status: 'tested' | 'watch'; origin: { method: string; time: string; endpoint: 'high' | 'low'; price: number; atr: number; half_width: number; bounds: 'heuristic_frozen_at_origin' };
  test_count: number; historical_test_count: number; reaction_count: number; last_test: string; last_interaction: string;
  break_status: 'unbroken' | 'pending' | 'confirmed' | 'unknown_after_gap'; retest_status: 'none' | 'pending' | 'confirmed';
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
        break_status: 'unbroken', retest_status: 'none', quality: { score: 0, basis: 'heuristic_not_probability', downgrade_reasons: [] },
        evidence: { tests: [], events: [], clustered_endpoints: [{ time: b.time, kind: endpoint, price: value }] },
        invalidation: `Role changes after ${closeBars} consecutive closed closes beyond the far edge plus a later retest and closed follow-through. Historical zone retained.`,
        data_reliability: reliability, distance_to_price: reference === null ? null : round(Math.max(0, reference - (value + width), (value - width) - reference)), confirmed_at: null });
    }
  }
  for (const z of zones) {
    const start = bars.findIndex(b => b.time === z.origin.time);
    let role = z.role, segment = bars[start].segment, away = true, lastTest = -Infinity, consecutive = 0;
    let pendingBreak: { time: string; index: number; to: SNRRole; retest: ClosedBar | null } | null = null;
    let proofReset = start, testedAt: string | null = null;
    const add = (type: ZoneEvent['type'], b: ClosedBar, evidence: string) => {
      z.evidence.events.push({ type, time: b.time, confirmed_at: barCloseTime(data.candles[b.index], data.timeframe, data.candles[b.index + 1]),
        index: b.index, role, break_time: pendingBreak?.time ?? null, retest_time: pendingBreak?.retest?.time ?? null, evidence });
      z.last_interaction = b.time;
    };
    for (let i = start; i < bars.length; i++) {
      const b = bars[i];
      if (b.segment !== segment) {
        segment = b.segment; away = true; lastTest = -Infinity; consecutive = 0; pendingBreak = null; proofReset = i; testedAt = null;
        z.break_status = 'unknown_after_gap'; z.retest_status = 'none';
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
      if (pendingBreak) {
        if (sameSide(b, z, role)) {
          // Reclaim of the old side cancels this retest cycle; never search across it.
          pendingBreak = null; z.retest_status = 'none'; consecutive = 0;
        } else if (pendingBreak.retest && b.index > pendingBreak.retest.index && sameSide(b, z, pendingBreak.to)) {
          add('role_reversal', b, 'Closed break, later retest rejecting old role, subsequent closed follow-through');
          role = pendingBreak.to; pendingBreak = null; z.retest_status = 'confirmed'; consecutive = 0;
        } else if (b.index > pendingBreak.index && touch && sameSide(b, z, pendingBreak.to) && !pendingBreak.retest) {
          pendingBreak.retest = b; add('retest', b, 'Post-break zone overlap, close on the broken side');
          add('failed_reclaim', b, 'Attempt to enter the old zone rejected at the closed candle; not proof of future direction');
          z.retest_status = 'pending';
        }
      }
      if (!pendingBreak) {
        const beyond = role === 'support' ? b.close < z.lower : b.close > z.upper;
        consecutive = beyond ? consecutive + 1 : 0;
        if (consecutive > 0) z.break_status = 'pending';
        else if (z.break_status === 'pending') z.break_status = z.evidence.events.some(e => e.type === 'close_break') ? 'confirmed' : 'unbroken';
        if (consecutive === closeBars) {
          pendingBreak = { time: b.time, index: b.index, to: role === 'support' ? 'resistance' : 'support', retest: null };
          // A previously untested seed may have a price cross, but cannot prove a meaningful broken SNR.
          if (testedAt !== null && testedAt < b.time) { add('close_break', b, `${closeBars} consecutive closed closes beyond frozen zone; prior independent endpoint tests`); z.break_status = 'confirmed'; }
          else { pendingBreak = null; role = role === 'support' ? 'resistance' : 'support'; z.break_status = 'unbroken'; }
        }
      }
      if (!pendingBreak && (role === 'support' ? b.low < z.lower && b.close > z.upper : b.high > z.upper && b.close < z.lower))
        add('liquidity_sweep', b, 'Wick crossed far edge, closed back outside original edge; no close-confirmed break');
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
      reaction_min_atr: 0.3, reaction_window_bars: 3, independent_test: 'whole_bar_away_then_new_overlap', atr: 'causal_simple_mean_TR_up_to_14_closed_bars' },
    zones, all_zone_count: zones.length, selection: 'all_candidates_no_topN_truncation',
    facts_scope: 'closed_OHLC_observations', time_semantics: 'time_and_reaction_at_are_bar_start_UTC; confirmed_at_is_close_time',
    heuristic_scope: 'clustering_width_reaction_threshold_score_not_probability' };
}
export type SNRAudit = ReturnType<typeof detectIndependentSNR>;
