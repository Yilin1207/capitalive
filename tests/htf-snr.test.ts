import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIndependentSNR } from '../lib/htf-snr';
import { prepareHtfBars } from '../lib/htf-data-quality';
import { candle, data, supportHistory } from './htf-test-helpers';

const zone = (input = data(supportHistory())) => detectIndependentSNR(input, 'NAS100', 'bid', 106).zones.find(z => z.origin.price === 100)!;

test('SNR independent episodes require a whole bar away; a continuous stay is one test', () => {
  const z = zone(); assert.equal(z.status, 'tested'); assert.equal(z.test_count, 3);
  assert.deepEqual(z.evidence.tests.map(t => t.time), [0, 4, 8].map(i => candle(i, 1, 1, 1).time));
  const continuous = zone(data(Array.from({ length: 20 }, (_, i) => candle(i, 112, 100, 109))));
  assert.equal(continuous.test_count, 1); assert.equal(continuous.status, 'watch');
});
test('strict wick sweep and equality have distinct semantics and neither establishes a break', () => {
  const base = supportHistory();
  const touch = zone(data([...base, candle(12, 110, 97, 108)]));
  const swept = zone(data([...base, candle(12, 110, 96, 108)]));
  assert.equal(touch.evidence.events.filter(e => e.type === 'liquidity_sweep').length, 0);
  assert.equal(swept.evidence.events.filter(e => e.type === 'liquidity_sweep').length, 1);
  assert.equal(swept.evidence.events.filter(e => e.type === 'close_break').length, 0);
  assert.equal(swept.evidence.events.filter(e => e.type === 'role_reversal').length, 0);
});
test('two closes then a later retest and follow-through are needed for role reversal and failed reclaim', () => {
  const base = [...supportHistory(), candle(12, 99, 90, 94), candle(13, 96, 90, 93)];
  const broken = zone(data(base)); assert.equal(broken.break_status, 'confirmed');
  assert.equal(broken.evidence.events.filter(e => e.type === 'close_break').length, 1);
  assert.equal(broken.evidence.events.filter(e => e.type === 'role_reversal').length, 0);
  const retest = [...base, candle(14, 101, 90, 94)];
  assert.equal(zone(data(retest)).retest_status, 'pending');
  const confirmed = zone(data([...retest, candle(15, 96, 88, 92)]));
  assert.equal(confirmed.role, 'resistance'); assert.equal(confirmed.retest_status, 'confirmed');
  assert.equal(confirmed.evidence.events.filter(e => e.type === 'failed_reclaim').length, 1);
  const flip = confirmed.evidence.events.find(e => e.type === 'role_reversal')!;
  assert.ok(flip.break_time! < flip.retest_time! && flip.retest_time! < flip.time);
  const reclaimed = zone(data([...base, candle(14, 110, 90, 108), candle(15, 101, 90, 94), candle(16, 96, 88, 92)]));
  assert.equal(reclaimed.evidence.events.filter(e => e.type === 'role_reversal').length, 0);
});
test('resistance-to-support is symmetric, and an open bar cannot confirm a flip', () => {
  const original = [...supportHistory(), candle(12, 99, 90, 94), candle(13, 96, 90, 93), candle(14, 101, 90, 94), candle(15, 96, 88, 92)];
  const mirrored = original.map(c => ({ ...c, open: { bid: 220 - c.open.bid!, ask: 220.2 - c.open.bid! },
    high: { bid: 220 - c.low.bid!, ask: 220.2 - c.low.bid! }, low: { bid: 220 - c.high.bid!, ask: 220.2 - c.high.bid! },
    close: { bid: 220 - c.close.bid!, ask: 220.2 - c.close.bid! } }));
  const z = detectIndependentSNR(data(mirrored), 'NAS100', 'bid', 125).zones.find(z => z.origin.price === 120)!;
  assert.equal(z.role, 'support'); assert.ok(z.evidence.events.some(e => e.type === 'role_reversal'));
  const open = original.map((c, i) => i === 15 ? { ...c, is_closed: false } : c);
  assert.equal(zone(data(open)).evidence.events.filter(e => e.type === 'role_reversal').length, 0);
});
test('frozen origin bands and past events do not repaint when later volatility increases', () => {
  const history = [...supportHistory(), candle(12, 99, 90, 94), candle(13, 96, 90, 93), candle(14, 101, 90, 94), candle(15, 96, 88, 92)];
  const before = zone(data(history)), after = zone(data([...history, candle(16, 900, 10, 500)]));
  assert.equal(after.lower, before.lower); assert.equal(after.upper, before.upper); assert.deepEqual(after.origin, before.origin);
  assert.deepEqual(after.evidence.events.filter(e => e.time <= history.at(-1)!.time), before.evidence.events);
  assert.deepEqual(zone(data([...history, candle(16, 9999, 1, 500, false)])), before);
});
test('known invalid rows reset confirmations; unknown invalid timestamp suppresses them all', () => {
  const input = data(supportHistory()); input.metadata.validation_gaps = [candle(10, 1, 1, 1).time];
  assert.equal(zone(input).status, 'watch');
  input.metadata.discarded_reasons.invalid_time = 1;
  assert.equal(zone(input).data_reliability.status, 'UNVERIFIED');
  assert.equal(zone(input).evidence.events.length, 0);
});
test('invalid OHLC, crossed bid/ask, partial monthly aggregate and bad ordering are never accepted facts', () => {
  const bars = supportHistory(); bars[2].high.bid = 50; bars[5].close.ask = bars[5].close.bid! - 1; bars[8].history_completeness = 'partial_validation';
  const prepared = prepareHtfBars(data(bars), 'bid'); assert.equal(prepared.excluded.length, 3);
  assert.ok(prepared.bars.every(b => ![2, 5, 8].includes(b.index)));
  assert.equal(prepareHtfBars(data([...supportHistory()].reverse()), 'bid').confirmationsAllowed, false);
  const falseClosure = data(supportHistory()); falseClosure.fetched_at = falseClosure.candles.at(-1)!.time;
  assert.ok(prepareHtfBars(falseClosure, 'bid').excluded.some(e => e.reason === 'CLOSURE_NOT_ESTABLISHED'));
});
test('all zones are returned and null reference stays null without JSON Infinity', () => {
  const result = detectIndependentSNR(data(supportHistory()), 'NAS100');
  assert.equal(result.zones.length, result.all_zone_count);
  assert.ok(result.zones.every(z => z.distance_to_price === null));
  assert.doesNotMatch(JSON.stringify(result), /Infinity|NaN/);
});
test('trailing rejected observation makes current zone state unknown without erasing historical proof', () => {
  const input = data(supportHistory()); input.metadata.validation_gaps = [candle(12,1,1,1).time];
  const z = zone(input); assert.equal(z.status,'watch'); assert.equal(z.break_status,'unknown_after_gap');
  assert.equal(z.historical_test_count,3); assert.ok(z.quality.downgrade_reasons.includes('TRAILING_DATA_GAP'));
});
test('price traversals without repeated nearby endpoints cannot masquerade as tested SNR', () => {
  const input = data([candle(0,112,100,109), ...Array.from({length:20},(_,i)=> i%4===3 ? candle(i+1,140,70,130) : candle(i+1,145,135,140))]);
  const z = zone(input); assert.ok(z.historical_test_count > 1); assert.equal(z.status,'watch');
  assert.ok(z.quality.downgrade_reasons.includes('FEWER_THAN_TWO_ENDPOINT_BACKED_EPISODES'));
});
test('a rejected still-forming period cannot erase historical closed SNR significance', () => {
  const input = data(supportHistory());
  input.fetched_at = '2025-03-31T12:00:00.000Z'; // origin+12 weeks: new, incomplete weekly period
  input.metadata.validation_gaps = ['2025-03-31T00:00:00.000Z'];
  assert.equal(zone(input).status,'tested');
});
