import { readFileSync } from 'node:fs';
import type { Candle, CandleResponse } from '../lib/candle-data';
export const candle = (i: number, high: number, low: number, close: number, closed = true, open = close): Candle => ({
  time: new Date(Date.UTC(2025, 0, 6 + 7 * i)).toISOString(),
  open: { bid: open, ask: open + 0.2 }, high: { bid: high, ask: high + 0.2 }, low: { bid: low, ask: low + 0.2 }, close: { bid: close, ask: close + 0.2 }, is_closed: closed,
});
export function data(candles: Candle[]): CandleResponse {
  const template = JSON.parse(readFileSync('tests/fixtures/capital-NAS100-h4.json', 'utf8')) as CandleResponse;
  return { ...template, timeframe: 'W1', candles, fetched_at: '2026-11-12T00:00:00.000Z', metadata: { ...template.metadata,
    requested: candles.length, returned: candles.length, available: candles.length, discarded_rows: 0, discarded_sides: 0, duplicate_rows: 0, insufficient_history: false,
    discarded_reasons: { invalid_time: 0, future_time: 0, crossed_sides: 0, no_valid_side: 0 }, validation_gaps: [],
    diagnostics: { ...template.metadata.diagnostics, missing_filtered_times: [], rejected_rows: [], rejected_rows_omitted: 0, provider_gap_slots: 0,
      current_period: { ...template.metadata.diagnostics.current_period, status: 'present' } } } };
}
export const supportHistory = () => Array.from({ length: 12 }, (_, i) => i % 4 === 0 ? candle(i, 112, 100, 109) : candle(i, 120, 110, 116));
