import { HISTORY, parseCandleTime, type CandleResponse, type Candle, type PriceSide } from './candle-data';

export type Reliability = { status: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED'; reasons: string[]; scope: string };
export type ClosedBar = { time: string; open: number; high: number; low: number; close: number; index: number; segment: number; atr: number };

/** A known rejected bar is a barrier, not permission to stitch evidence across it. */
export function prepareHtfBars(data: CandleResponse, side: PriceSide) {
  const reasons: string[] = [];
  const barriers = [...(data.metadata.validation_gaps ?? data.metadata.diagnostics.missing_filtered_times)].map(Date.parse).filter(Number.isFinite);
  const unknownGap = data.metadata.discarded_reasons.invalid_time > 0 ||
    (!data.metadata.validation_gaps && data.metadata.diagnostics.rejected_rows_omitted > 0);
  if (unknownGap) reasons.push('UNLOCATABLE_VALIDATION_GAP_CONFIRMATIONS_SUPPRESSED');
  if (data.metadata.insufficient_history) reasons.push('REQUESTED_HISTORY_INCOMPLETE');
  if (data.metadata.discarded_rows || data.metadata.discarded_sides) reasons.push('PROVIDER_VALIDATION_LOSS');
  if (data.metadata.duplicate_rows) reasons.push('DUPLICATE_ROWS_NORMALIZED');
  if (data.metadata.diagnostics.provider_gap_slots) reasons.push('NOMINAL_GAPS_SESSION_CALENDAR_UNKNOWN');
  if (data.metadata.diagnostics.current_period.status !== 'present') reasons.push('CURRENT_PERIOD_MISSING');
  if (data.timeframe === 'MN1') reasons.push('MONTHLY_SESSION_COMPLETENESS_UNKNOWN');
  const bars: ClosedBar[] = [];
  const excluded: { time: string; reason: string }[] = [];
  let previousTime = -Infinity, segment = 0, unclosedSeen = false, malformedSequence = false;
  let ranges: number[] = [];
  const fetched = Date.parse(data.fetched_at);
  for (let i = 0; i < data.candles.length; i++) {
    const candle = data.candles[i], t = Date.parse(candle.time);
    if (!parseCandleTime(candle.time) || t <= previousTime || !Number.isFinite(fetched) || t > fetched) {
      excluded.push({ time: candle.time, reason: 'INVALID_TIME_ORDER_OR_FUTURE' }); malformedSequence = true; segment++; ranges = []; continue;
    }
    previousTime = t;
    if (!candle.is_closed) { unclosedSeen = true; continue; }
    if (unclosedSeen) { malformedSequence = true; excluded.push({ time: candle.time, reason: 'CLOSED_AFTER_FORMING' }); }
    const nominalEnd = data.timeframe === 'MN1' ? Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)
      : t + HISTORY[data.timeframe].seconds * 1000;
    const nextTime = Date.parse(data.candles[i + 1]?.time ?? '');
    if (nominalEnd > fetched && !(nextTime > t && nextTime <= fetched)) {
      excluded.push({ time: candle.time, reason: 'CLOSURE_NOT_ESTABLISHED' }); segment++; ranges = []; continue;
    }
    const fields = ['open', 'high', 'low', 'close'] as const;
    const validSide = (s: PriceSide) => fields.every(f => typeof candle[f][s] === 'number' && Number.isFinite(candle[f][s]) && candle[f][s]! > 0)
      && candle.low[s]! <= Math.min(candle.open[s]!, candle.close[s]!) && candle.high[s]! >= Math.max(candle.open[s]!, candle.close[s]!);
    if (barriers.includes(t) || !validSide(side) || candle.history_completeness === 'partial_validation' ||
      (validSide('bid') && validSide('ask') && fields.some(f => candle[f].bid! > candle[f].ask!))) {
      excluded.push({ time: candle.time, reason: 'INVALID_OHLC_OR_PARTIAL_AGGREGATE' }); segment++; ranges = []; continue;
    }
    if (!validSide(side === 'bid' ? 'ask' : 'bid')) reasons.push('OTHER_PRICE_SIDE_UNAVAILABLE');
    const previous = bars.at(-1);
    const missingMonth = previous && data.timeframe === 'MN1' && t !== Date.UTC(new Date(previous.time).getUTCFullYear(), new Date(previous.time).getUTCMonth() + 1, 1);
    if (previous && (barriers.some(b => b > Date.parse(previous.time) && b <= t) || missingMonth)) { segment++; ranges = []; }
    const open = candle.open[side]!, high = candle.high[side]!, low = candle.low[side]!, close = candle.close[side]!;
    const previousClose = previous?.segment === segment ? previous.close : null;
    ranges.push(Math.max(high - low, previousClose === null ? 0 : Math.abs(high - previousClose), previousClose === null ? 0 : Math.abs(low - previousClose)));
    ranges = ranges.slice(-14);
    bars.push({ time: candle.time, open, high, low, close, index: i, segment, atr: ranges.reduce((a, b) => a + b, 0) / ranges.length });
  }
  if (excluded.length || barriers.length) reasons.push('KNOWN_VALIDATION_BARRIERS');
  if (bars.length < 20) reasons.push('SHORT_CLOSED_HISTORY');
  if (malformedSequence) reasons.push('INVALID_SEQUENCE_CONFIRMATIONS_SUPPRESSED');
  const barrierClosed = (t: number) => {
    const end = data.timeframe === 'MN1' ? Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)
      : t + HISTORY[data.timeframe].seconds * 1000;
    return end <= fetched || data.candles.some(c => Date.parse(c.time) > t && Date.parse(c.time) <= fetched);
  };
  // An unavailable forming candle cannot erase evidence from completed periods.
  // It also cannot prove a new break, retest, or role reversal.
  const currentSegmentVerified = bars.length > 0 && bars.at(-1)!.segment === segment &&
    !barriers.some(t => t > Date.parse(bars.at(-1)!.time) && t <= fetched && barrierClosed(t));
  if (!currentSegmentVerified) reasons.push('TRAILING_DATA_GAP_CURRENT_STATE_UNVERIFIED');
  // VERIFIED refers only to explicitly checked observations, never complete exchange sessions.
  reasons.push('SESSION_COVERAGE_NOT_INDEPENDENTLY_VERIFIED');
  const reliability: Reliability = { status: !bars.length || unknownGap || malformedSequence ? 'UNVERIFIED' : 'PARTIAL',
    reasons: [...new Set(reasons)], scope: 'loaded_history_only; provider_closed_bar_semantics; UTC; no_imputed_bars' };
  return { bars, excluded, reliability, confirmationsAllowed: !unknownGap && !malformedSequence, currentSegmentVerified,
    latestSegment: bars.at(-1)?.segment ?? null };
}

export function barCloseTime(candle: Candle, timeframe: CandleResponse['timeframe'], next?: Candle) {
  const t = Date.parse(candle.time);
  const end = timeframe === 'MN1' ? Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)
    : t + HISTORY[timeframe].seconds * 1000;
  return new Date(Math.min(end, next ? Date.parse(next.time) : Infinity)).toISOString();
}
