import type { CandleResponse, PriceSide } from './candle-data';
import { prepareHtfBars, barCloseTime, type Reliability } from './htf-data-quality';
import type { SeriesAnalysis, Fractal } from './technical-analysis';

export type StructureBreak = { id: string; type: 'BOS' | 'CHOCH'; direction: 'bullish' | 'bearish'; time: string;
  confirmed_at: string; price: number; source_id: string; pivot_time: string; previous_bias: string; index: number };
export type OrderBlock = { id: string; type: 'ORDER_BLOCK' | 'BREAKER'; lower: number; upper: number; direction: 'bullish' | 'bearish';
  origin_time: string; confirmed_at: string; structure_break_id: string; status: 'active' | 'invalidated' | 'unverified_after_gap'; invalidated_at: string | null;
  retested_at: string | null; evidence: string[]; data_reliability: Reliability };

/** Chronological confirmed pivots and close breaks; current liquidity flags never rewrite historical BOS. */
export function analyzeHtfStructure(data: CandleResponse, series: SeriesAnalysis, side: PriceSide) {
  const prepared = prepareHtfBars(data, side), { bars } = prepared;
  const labels: { source_id: string; time: string; confirmed_at: string; kind: 'HH' | 'HL' | 'LH' | 'LL' | 'EH' | 'EL' | 'initial'; price: number }[] = [];
  const breaks: StructureBreak[] = [], blocks: OrderBlock[] = [];
  let high: Fractal | null = null, low: Fractal | null = null, highKind = '', lowKind = '', segment = -1;
  let bias: 'bullish' | 'bearish' | 'undetermined' = 'undetermined';
  const consumed = new Set<string>();
  if (prepared.confirmationsAllowed) for (const b of bars) {
    if (segment !== b.segment) { high = null; low = null; highKind = ''; lowKind = ''; bias = 'undetermined'; segment = b.segment; }
    for (const pivot of series.fractals.filter(f => f.index + 2 === b.index && f.confirmed_at && bars.some(p => p.index === f.index - 2 && p.segment === segment))) {
      const previous = pivot.kind === 'high' ? high : low;
      const kind = !previous ? 'initial' : pivot.price === previous.price ? pivot.kind === 'high' ? 'EH' : 'EL'
        : pivot.kind === 'high' ? pivot.price > previous.price ? 'HH' : 'LH' : pivot.price > previous.price ? 'HL' : 'LL';
      labels.push({ source_id: pivot.id, time: pivot.time, confirmed_at: pivot.confirmed_at!, kind, price: pivot.price });
      if (pivot.kind === 'high') { high = pivot; highKind = kind; } else { low = pivot; lowKind = kind; }
      if (highKind === 'HH' && lowKind === 'HL') bias = 'bullish';
      if (highKind === 'LH' && lowKind === 'LL') bias = 'bearish';
    }
    for (const pivot of [high, low]) {
      if (!pivot || b.index <= pivot.index + 2 || consumed.has(pivot.id)) continue;
      const up = pivot.kind === 'high';
      if (!(up ? b.close > pivot.price : b.close < pivot.price)) continue;
      consumed.add(pivot.id);
      const direction = up ? 'bullish' : 'bearish';
      const event: StructureBreak = { id: `${data.timeframe}:${side}:break:${b.time}:${direction}`, type: bias !== 'undetermined' && bias !== direction ? 'CHOCH' : 'BOS',
        direction, time: b.time, confirmed_at: barCloseTime(data.candles[b.index], data.timeframe, data.candles[b.index + 1]),
        price: pivot.price, source_id: pivot.id, pivot_time: pivot.time, previous_bias: bias, index: b.index };
      breaks.push(event); bias = direction;
      const prior = bars.filter(p => p.segment === b.segment && p.index < b.index && p.index >= Math.max(pivot.index, b.index - 10));
      const last = prior.at(-1);
      const origin = prior.findLast(p => up ? p.close < p.open : p.close > p.open);
      // Explicit, deliberately restrictive OB hypothesis: directional displaced close-break >= 0.8 prior ATR.
      if (origin && last && Math.abs(b.close - b.open) >= last.atr * 0.8 && (up ? b.close > b.open : b.close < b.open))
        blocks.push({ id: `${event.id}:ob`, type: 'ORDER_BLOCK', lower: Math.min(origin.open, origin.close), upper: Math.max(origin.open, origin.close), direction,
          origin_time: origin.time, confirmed_at: event.confirmed_at, structure_break_id: event.id, status: 'active', invalidated_at: null, retested_at: null,
          evidence: ['Last opposite candle body within 10 bars before a closed structure break', 'Break body >= 0.8 preceding ATR; deterministic heuristic, not institutional order evidence'], data_reliability: prepared.reliability });
    }
  }
  for (const block of [...blocks]) {
    const event = breaks.find(e => e.id === block.structure_break_id)!;
    const base = bars.find(b => b.index === event.index)!;
    const later = bars.filter(b => b.index > event.index && b.segment === base.segment);
    const invalid = later.find(b => block.direction === 'bullish' ? b.close < block.lower : b.close > block.upper);
    if (!invalid) {
      if (base.segment !== prepared.latestSegment || !prepared.currentSegmentVerified) block.status = 'unverified_after_gap';
      continue;
    }
    block.status = 'invalidated'; block.invalidated_at = barCloseTime(data.candles[invalid.index], data.timeframe, data.candles[invalid.index + 1]);
    for (let i = 0; i < later.length - 1; i++) {
      const b = later[i], next = later[i + 1];
      if (b.index <= invalid.index) continue;
      const hold = (close: number) => block.direction === 'bullish' ? close < block.lower : close > block.upper;
      const reclaimed = block.direction === 'bullish' ? b.close > block.upper : b.close < block.lower;
      if (reclaimed) break;
      if (b.high >= block.lower && b.low <= block.upper && hold(b.close) && hold(next.close)) {
        const direction = block.direction === 'bullish' ? 'bearish' : 'bullish';
        const breaker: OrderBlock = { ...block, id: `${block.id}:breaker`, type: 'BREAKER', direction, status: 'active', invalidated_at: null,
          confirmed_at: barCloseTime(data.candles[next.index], data.timeframe, data.candles[next.index + 1]), retested_at: b.time,
          evidence: [...block.evidence, `OB invalidated at ${block.invalidated_at}; later retest and closed follow-through on opposite side`] };
        const failed = later.find(p => p.index > next.index && (direction === 'bullish' ? p.close < breaker.lower : p.close > breaker.upper));
        if (failed) { breaker.status = 'invalidated'; breaker.invalidated_at = barCloseTime(data.candles[failed.index], data.timeframe, data.candles[failed.index + 1]); }
        if (!failed && (base.segment !== prepared.latestSegment || !prepared.currentSegmentVerified)) breaker.status = 'unverified_after_gap';
        blocks.push(breaker); break;
      }
    }
  }
  if (!prepared.currentSegmentVerified) bias = 'undetermined';
  return { bias, swing_labels: labels, breaks, order_blocks: blocks, data_reliability: prepared.reliability,
    rules: { structure: 'strict_confirmed_5_bar_pivots; latest_known_pivot; first_strict_closed_break_once_per_pivot',
      choch: 'closed_break_against_prior_swing_or_break_bias', order_blocks: 'explicit_heuristic_body_zone_not_a_claim_about_actual_orders',
      barriers: 'reset_structure_at_known_validation_gap; no_forming_confirmation' } };
}
export type HtfStructure = ReturnType<typeof analyzeHtfStructure>;
