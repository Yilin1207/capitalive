import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSeries, ANALYSIS_TIMEFRAMES, ANALYSIS_SYMBOLS, targetMap } from '../lib/technical-analysis';
import { buildHtfAudit } from '../lib/htf-audit';
import { calculateStructuralRisk } from '../lib/htf-zone-catalog';
import { marketAudit } from '../lib/market-audit';
import { htfZones } from '../lib/htf-http';
import { GET as htfRoute, OPTIONS } from '../app/api/htf-zones/route';
import type { CandleResponse, Timeframe } from '../lib/candle-data';
import type { MarketQuote } from '../lib/quote-normalization';

function fixture(asset: string) { return JSON.parse(readFileSync(`tests/fixtures/htf-${asset}.json`,'utf8')) as { data: Record<Timeframe,CandleResponse>; quote: MarketQuote }; }

for (const asset of ANALYSIS_SYMBOLS) test(`${asset}: all four real HTF candidate sets retained, correct bid/ask, no JSON size surprise`, async () => {
  const f = fixture(asset);
  for (const side of ['bid','ask'] as const) {
    const analyses = ANALYSIS_TIMEFRAMES.map(tf => analyzeSeries(f.data[tf],asset,side,{},f.quote[side]));
    const htf = buildHtfAudit(asset,side,f.data,analyses,f.quote);
    for (const tf of ANALYSIS_TIMEFRAMES) {
      assert.equal(htf.catalog.zones.filter(z => z.type === 'SNR' && z.timeframe === tf).length,htf.snr[tf].all_zone_count);
      assert.ok(htf.snr[tf].zones.every(z => z.origin.price === f.data[tf].candles.find(c => c.time === z.origin.time)![z.origin.endpoint][side]));
      for (const z of htf.snr[tf].zones) for (const e of z.evidence.events) assert.equal(f.data[tf].candles[e.index].is_closed,true);
    }
    assert.equal(htf.catalog.omitted,0);
    for (const z of htf.catalog.zones.filter(z => z.main_tp_eligible)) assert.ok(z.timeframe !== 'H4' && ['FRACTAL','FVG'].includes(z.type));
    const response = await marketAudit(new Request(`https://local/api/market-audit?symbol=${asset}&side=${side}&include_candles=1`), {
      getCandles: async (_symbol,tf) => f.data[tf], getAnalysisQuote: async () => ({ ...f.quote, cache_hit:false, evaluated_at:f.data.H4.fetched_at }),
    });
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(response.status,200);
    assert.ok(bytes.length < 4_250_000, `response is ${bytes.length} bytes`);
    const body = JSON.parse(bytes.toString()); assert.equal(body.schema_version,'2.1');
    const oldTargets = targetMap(analyses,f.quote[side]);
    assert.deepEqual(body.targets.above,oldTargets.above); assert.deepEqual(body.targets.below,oldTargets.below);
  }
});
test('NAS100 Weekly region independently has closed June/July tests; November one close and open week do not confirm reversal', () => {
  const f = fixture('NAS100'); const analyses = ANALYSIS_TIMEFRAMES.map(tf => analyzeSeries(f.data[tf],'NAS100','bid',{},f.quote.bid));
  const result = buildHtfAudit('NAS100','bid',f.data,analyses,f.quote);
  const zone = result.snr.W1.zones.find(z => z.origin.price === 28184.7)!;
  assert.ok(zone && zone.lower < 28220 && zone.upper > 28090); assert.equal(zone.status,'tested');
  const evidence = zone.evidence.tests.filter(t => t.endpoint_near_zone);
  assert.deepEqual(evidence.map(t => t.time), ['2026-06-08T00:00:00.000Z','2026-07-13T00:00:00.000Z']);
  assert.equal(zone.break_status,'confirmed'); assert.equal(zone.retest_status,'none');
  assert.equal(zone.evidence.events.filter(e => e.type === 'role_reversal').length,0);
  assert.equal(zone.evidence.events.filter(e => e.type === 'close_break').length,1);
  assert.ok(zone.evidence.events.some(e=>e.state==='CONFIRMED_BREAK'&&e.time==='2026-11-02T00:00:00.000Z'&&e.evidence.startsWith('displacement')));
  assert.ok(zone.evidence.events.some(e => e.type === 'liquidity_sweep' && e.time === '2026-10-26T00:00:00.000Z'));
  assert.ok(result.catalog.zones.some(z => z.id === zone.id && z.significant));
  assert.ok(zone.evidence.tests.every(t => t.time < '2026-11-09T00:00:00.000Z'));
});
test('risk returns null without a confirmed structural stop and preserves touched unswept D1 targets', () => {
  const f = fixture('NAS100'); const analyses = ANALYSIS_TIMEFRAMES.map(tf => analyzeSeries(f.data[tf],'NAS100'));
  const pivot = analyses.find(s => s.timeframe === 'D1')!.fractals[0];
  const h4 = analyses.find(s => s.timeframe === 'H4')!;
  const chosen = { ...pivot, price:100, kind:'high' as const, liquidity_status:'touched' as const };
  for (const s of analyses) { s.fractals = s.timeframe === 'D1' ? [chosen] : []; s.fvgs = []; }
  const result = buildHtfAudit('NAS100','bid',f.data,analyses,{ ...f.quote,bid:90,ask:90.2 },90);
  assert.equal(result.catalog.zones.find(z => z.source_id === chosen.id)!.main_tp_eligible,true);
  assert.equal(targetMap(analyses,90).above.nearest!.price,100);
  assert.equal(result.risk.long.structural_sl,null); assert.equal(result.risk.long.rr_to_tp,null);
  h4.fractals = [{ ...pivot,id:'synthetic-h4-low',timeframe:'H4',kind:'low',price:85,liquidity_status:'untouched' }];
  const risk = calculateStructuralRisk(analyses,result.catalog,90);
  assert.equal(risk.long.distance_to_sl,null); assert.equal(risk.long.rr_to_tp,null); // A standalone fractal is no longer a structural setup.
  assert.equal(calculateStructuralRisk(analyses,result.catalog,null).long.structural_sl,null);
});
test('htf-zones uses one shared four-frame snapshot and preserves request validation/CORS', async () => {
  const f = fixture('EURUSD'), calls: string[] = [];
  const response = await htfZones(new Request('https://local/api/htf-zones?symbol=EURUSD&timeframe=H4&entry=1.2'), {
    getCandles:async (_symbol,tf) => { calls.push(tf); return f.data[tf]; },
    getAnalysisQuote:async () => ({...f.quote,cache_hit:false,evaluated_at:f.data.H4.fetched_at}),
  });
  const body = await response.json(); assert.equal(response.status,200);
  assert.deepEqual(calls,ANALYSIS_TIMEFRAMES); assert.deepEqual(Object.keys(body.snr),ANALYSIS_TIMEFRAMES);
  assert.equal(body.risk.hypothetical_entry,1.2); assert.equal(body.risk.reference_fresh,false);
  assert.equal(response.headers.get('access-control-allow-origin'),'*'); assert.equal(OPTIONS().status,204);
  for (const query of ['symbol=XAUUSD','side=mid','entry=0','entry=NaN','entry=Infinity','entry=-2','timeframe=M1'])
    assert.equal((await htfRoute(new Request(`https://local/api/htf-zones?${query}`))).status,400);
  assert.equal((await htfRoute(new Request('https://local/api/htf-zones?htf=0'))).status,400);
  const legacy = await marketAudit(new Request('https://local/api/market-audit?symbol=EURUSD&htf=0'), {
    getCandles: async (_symbol, tf) => f.data[tf], getAnalysisQuote: async () => ({ ...f.quote, cache_hit:false, evaluated_at:f.data.H4.fetched_at }),
  });
  const legacyBody = await legacy.json(); assert.equal(legacy.status,200); assert.equal(legacyBody.htf,undefined);
  assert.equal(legacyBody.response_scope.htf_requested,false); assert.ok(legacyBody.structure.MN1);
});
test('over-budget evidence yields explicit error with counts rather than a truncated successful catalog', async () => {
  const input = JSON.parse(readFileSync('tests/fixtures/capital-NAS100-h4.json','utf8')) as CandleResponse;
  // Deliberately oversized provider stub: 240 bars for EVERY frame, exceeding MN1/W1 requested limits.
  const quote = fixture('NAS100').quote;
  const response = await marketAudit(new Request('https://local/api/market-audit?symbol=NAS100'), {
    getCandles: async (_symbol, tf) => ({ ...input, timeframe:tf }),
    getAnalysisQuote: async () => ({ ...quote, cache_hit:false, evaluated_at:input.fetched_at }),
  });
  const body = await response.json(); assert.equal(response.status,503);
  assert.equal(body.error.code,'ANALYSIS_RESPONSE_TOO_LARGE'); assert.ok(body.metadata.zone_count > 0); assert.equal(body.htf,undefined);
});
