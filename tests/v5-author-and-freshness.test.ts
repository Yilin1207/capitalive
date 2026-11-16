import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectFractals,detectStructure} from '../lib/knowledge/detectors';
import {closedFrame,type Frame} from '../lib/knowledge/data';
import {intervalCoverage} from '../lib/knowledge/level-state';
import {closedRegularInterval} from '../lib/research/calendars';
import {ClosedAnalysisCache} from '../lib/research-bridge/analysis-cache';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import {freshnessPolicy,deliveryHealth} from '../lib/research-bridge/freshness';
import {analyzeSeries} from '../lib/technical-analysis';
import {detectIndependentSNR} from '../lib/htf-snr';
import {analyzeHtfStructure} from '../lib/htf-structure';
import {data,candle} from './htf-test-helpers';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
const input=()=>JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
test('V5: one closed right neighbour confirms both APIs; future suffix cannot change formation',()=>{
 const d=data([[7,10,6,8],[8,12,7,10],[10,11,6,8]].map(([o,h,l,c],i)=>candle(i,h,l,c,true,o)));
 const f=closedFrame(d,'bid'),p=detectFractals(f).find(p=>p.polarity==='high')!;
 assert.equal(p.variant,3);assert.equal(p.candle_evidence.length,3);assert.equal(p.confirmed_at,f.bars[2].end);
 const legacy=analyzeSeries(d,'NAS100');assert.equal(legacy.fractals.find(p=>p.kind==='high')?.confirmed_at,p.confirmed_at);
 assert.equal(detectFractals({...f,bars:f.bars.slice(0,2)}).length,0);
 const tie=structuredClone(f);tie.bars[2].high=12;assert.equal(detectFractals(tie).length,0);
 const gap=structuredClone(f);gap.bars[2].segment=1;assert.equal(detectFractals(gap).length,0);
 assert.deepEqual(detectStructure(f,[p]).findings,[]);
});
test('V5: documented closed weekend can cover lifecycle; trading-hour and unknown JP gaps cannot',()=>{
 const from='2026-11-14T00:00:00.000Z',to='2026-11-15T00:00:00.000Z';
 const frame={symbol:'NAS100',bars:[],as_of:to} as unknown as Frame;
 assert.equal(closedRegularInterval('NAS100',Date.parse(from),Date.parse(to)),true);
 const covered=intervalCoverage([frame],from,to);assert.equal(covered.complete,true);assert.equal(covered.scheduled_closures.length,1);
 assert.equal(intervalCoverage([{...frame,symbol:'JP225'}],from,to).complete,false);
 assert.equal(intervalCoverage([frame],'2026-11-13T12:00:00.000Z','2026-11-13T16:00:00.000Z').complete,false);
 assert.equal(intervalCoverage([frame],'2026-11-13T20:00:00.000Z',to).complete,false);
});
test('V5: quote refresh reuses identical closed PA; revised closed OHLC invalidates cache',()=>{
 const i=input(),cache=new ClosedAnalysisCache();let builds=0;
 const build:typeof buildIntelligence=(...args)=>{builds++;return buildIntelligence(...args);};
 const a=cache.get(i.data,'bid',i.quote,{},build),b=cache.get(i.data,'bid',{...i.quote,bid:123}, {},build);
 assert.equal(a.hit,false);assert.equal(b.hit,true);assert.equal(builds,1);assert.equal(b.result.as_of,a.result.as_of);
 i.data.H4.candles[1].high.bid!+=1;
 assert.equal(cache.get(i.data,'bid',i.quote,{},build).hit,false);assert.equal(builds,2);
 assert.equal(cache.get(i.data,'ask',i.quote,{},build).hit,false);
});
test('V5: missed scheduler is stale, explicit new generation recovers; future publication never freshens quote',()=>{
 const now=Date.parse('2026-11-16T17:00:00Z');
 assert.equal(deliveryHealth('2026-11-16T08:36:55.920Z',now).reason,'DELIVERY_DELAY_REFRESH_REQUIRED');
 assert.equal(deliveryHealth(new Date(now).toISOString(),now).status,'FRESH');
 assert.equal(freshnessPolicy({BRIDGE_QUOTE_MAX_SECONDS:'99999'}).quote_seconds,120);
 const i=input(),r=buildIntelligence(i.data,'bid',i.quote),report=buildDeskReport(r,i.data,i.quote,new Date(now).toISOString());
 assert.equal(report.status,'STALE');assert.equal(report.quote.fresh,false);assert.equal(report.freshness.quote_status,'STALE');
 assert.equal(report.published_at,null);validateReport(report);
 assert.equal(report.scenario.confirmed_narrative,null);
 for(const f of report.frames)assert.deepEqual(f.fractals.map(p=>p.variant),[3,3]);
 assert.ok(!Object.values(report.evidence).some(e=>(e as {variant:number}).variant===5));
 const wrong=structuredClone(report);(Object.values(wrong.evidence)[0] as {variant:number}).variant=5;assert.throws(()=>validateReport(wrong));
});
test('V5: old ATR SNR/OB/breaker/structure rules cannot emit trade evidence',()=>{
 const i=input();for(const tf of ['MN1','W1','D1','H4'] as const){const series=analyzeSeries(i.data[tf],'NAS100');
 assert.equal(detectIndependentSNR(i.data[tf],'NAS100').zones.length,0);
 const structure=analyzeHtfStructure(i.data[tf],series,'bid');assert.equal(structure.bias,'undetermined');assert.equal(structure.breaks.length,0);assert.equal(structure.order_blocks.length,0);
 assert.equal(series.rules.fractal,'strict_3_bar_one_closed_right');assert.equal(series.materiality.threshold_units,0);
 assert.equal(series.ranges.selected.status,'unconfirmed');}
});
