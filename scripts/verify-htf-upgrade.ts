import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyzeSeries, ANALYSIS_SYMBOLS, ANALYSIS_TIMEFRAMES } from '../lib/technical-analysis';
import { buildHtfAudit } from '../lib/htf-audit';
import type { CandleResponse, Timeframe } from '../lib/candle-data';

const output = 'verification/capitalive-v2-1';
mkdirSync(output, { recursive: true });
const summary = [];
for (const asset of ANALYSIS_SYMBOLS) {
  const bytes = readFileSync(`${output}/baseline-${asset}-audit.json`);
  const baseline = JSON.parse(bytes.toString());
  const data = Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf => [tf, {
    ok: true, symbol: asset, epic: asset === 'NAS100' ? 'US100' : asset === 'EU50' ? 'EU50' : 'EURUSD', timeframe: tf,
    provider: baseline.provider, environment: baseline.environment, price_side: 'bid_ask', fetched_at: baseline.structure[tf].fetched_at,
    candles: baseline.structure[tf].candles, metadata: baseline.structure[tf].metadata,
  }])) as Record<Timeframe, CandleResponse>;
  const fixture = { provenance: { url: `https://capitalive.vercel.app/api/market-audit?symbol=${asset}&include_candles=1`,
    captured_at: baseline.generated_at, source_sha256: createHash('sha256').update(bytes).digest('hex'), environment: baseline.environment }, quote: baseline.quote, data };
  if (process.argv.includes('--write-fixtures')) writeFileSync(`tests/fixtures/htf-${asset}.json`, JSON.stringify(fixture));
  const analysis = ANALYSIS_TIMEFRAMES.map(tf => analyzeSeries(data[tf], asset, 'bid', {}, baseline.quote.bid));
  const start = performance.now();
  const result = buildHtfAudit(asset, 'bid', data, analysis, baseline.quote);
  const serialized = JSON.stringify(result);
  writeFileSync(`${output}/htf-${asset}.json`, serialized);
  const candidate = asset === 'NAS100' ? result.snr.W1.zones.filter(z => z.origin.price >= 28090 && z.origin.price <= 28220) : [];
  const report = { asset, environment: baseline.environment, captured_at: baseline.generated_at,
    elapsed_ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(serialized), reliability: result.data_reliability,
    frames: Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf => [tf, { bars: result.snr[tf].history.accepted_closed,
      candidates: result.snr[tf].all_zone_count, tested: result.snr[tf].zones.filter(z => z.status === 'tested').length,
      reversals: result.snr[tf].zones.flatMap(z => z.evidence.events).filter(e => e.type === 'role_reversal').length,
      structure_breaks: result.structure[tf].breaks.length, order_blocks: result.structure[tf].order_blocks.length }])),
    total_zones: result.catalog.total, conflicts: result.catalog.conflicts.length, nas100_weekly_requested_area: candidate };
  summary.push(report);
  console.log(JSON.stringify({ asset, elapsed_ms: report.elapsed_ms, bytes: report.bytes, frames: report.frames,
    candidates: candidate.map(z => ({ lower: z.lower, upper: z.upper, tests: z.test_count, status: z.status, break_status: z.break_status, events: z.evidence.events })) }));
}
writeFileSync(`${output}/htf-summary.json`, JSON.stringify(summary, null, 2));
