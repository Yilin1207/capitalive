import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSeries } from '../lib/technical-analysis';
import { analyzeHtfStructure } from '../lib/htf-structure';
import { candle, data } from './htf-test-helpers';

const sequence = () => [
  [108,99,103], [110,100,105], [120,101,110], [112,100,106], [111,98,104],
  [109,90,100], [113,99,105], [115,100,108], [125,102,117], [119,101,110],
  [115,100,108], [112,95,102], [117,101,108], [119,102,110,116], [132,108,130,110],
  [131,90,92,125], [113,90,100], [108,88,92], [124,96,122],
].map(([h,l,c,o], i) => candle(i,h,l,c,true,o ?? c));
const run = (bars = sequence()) => { const input = data(bars); return analyzeHtfStructure(input, analyzeSeries(input, 'NAS100'), 'bid'); };

test('HH/HL, BOS and CHOCH use confirmed pivots and strict closed closes chronologically', () => {
  const result = run();
  assert.ok(result.swing_labels.some(s => s.kind === 'HH'));
  assert.ok(result.swing_labels.some(s => s.kind === 'HL'));
  const bullish = result.breaks.find(b => b.index === 14)!;
  assert.equal(bullish.type, 'BOS'); assert.equal(bullish.direction, 'bullish'); assert.equal(bullish.price, 125);
  const bearish = result.breaks.find(b => b.index === 15)!;
  assert.equal(bearish.type, 'CHOCH'); assert.equal(bearish.direction, 'bearish'); assert.equal(bearish.price, 95);
  assert.ok(result.breaks.every(b => b.confirmed_at > b.time));
  assert.equal(new Set(result.breaks.map(b => b.source_id)).size, result.breaks.length);
});
test('wick-only and unclosed break bars never confirm BOS/CHOCH or order blocks', () => {
  const bars = sequence().slice(0,15); bars[14] = { ...bars[14], is_closed: false };
  assert.equal(run(bars).breaks.filter(b => b.index === 14).length, 0);
  bars[14] = candle(14,132,108,120);
  assert.equal(run(bars).breaks.filter(b => b.index === 14).length, 0);
});
test('OB requires displaced closed break; breaker requires later closed invalidation, retest and follow-through', () => {
  const result = run();
  const ob = result.order_blocks.find(b => b.type === 'ORDER_BLOCK' && b.direction === 'bullish')!;
  assert.ok(ob); assert.equal(ob.lower,110); assert.equal(ob.upper,116); assert.equal(ob.status,'invalidated');
  const breaker = result.order_blocks.find(b => b.type === 'BREAKER' && b.id.startsWith(ob.id))!;
  assert.ok(breaker); assert.equal(breaker.retested_at,sequence()[16].time); assert.equal(breaker.direction,'bearish');
  assert.equal(breaker.status,'invalidated');
  assert.equal(run(sequence().slice(0,17)).order_blocks.filter(b => b.type === 'BREAKER').length,0);
});
test('known gap blocks structure confirmation and unknown timestamps suppress structure', () => {
  const input = data(sequence()); input.metadata.validation_gaps = [input.candles[13].time];
  const result = analyzeHtfStructure(input,analyzeSeries(input,'NAS100'),'bid');
  assert.equal(result.breaks.filter(b => b.index === 14).length,0);
  input.metadata.discarded_reasons.invalid_time = 1;
  assert.equal(analyzeHtfStructure(input,analyzeSeries(input,'NAS100'),'bid').breaks.length,0);
});
