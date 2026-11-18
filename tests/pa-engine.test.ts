import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPaEngine,interactionsForEvidence,verifyOhlc} from '../lib/pa-engine/core';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {closedFrame} from '../lib/knowledge/data';
import {detectFractals,TF_ORDER} from '../lib/knowledge/detectors';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

const fixture=(s:string)=>JSON.parse(readFileSync(`tests/fixtures/edge-v2/${s}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};

for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'] as const)test(`V6 ${symbol} ${side}: archived regression preserves PA evidence, disables interpretation`,()=>{
 const input=fixture(symbol),pa=buildPaEngine(input.data,side),legacy=buildIntelligence(input.data,side,input.quote);
 const kinds=['FRACTAL','FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK','TOUCH','RAID'];
 const old=legacy.frames.flatMap(f=>f.findings).filter(f=>kinds.includes(f.kind)),rows=pa.evidence.filter(f=>kinds.includes(f.kind));
 assert.deepEqual(rows.map(f=>f.id).sort(),old.map(f=>f.id).sort());
 for(const e of rows){const expected=old.find(f=>f.id===e.id)!;assert.deepEqual(e.candle_evidence,expected.candle_evidence);assert.equal(e.confirmed_at,expected.confirmed_at);assert.equal(e.current_role,null);assert.ok(e.candle_evidence.every(c=>c.closed_at<=e.confirmed_at));assert.ok(e.confirmed_at<=pa.as_of);}
 assert.equal(pa.mode,'PA_ONLY');assert.equal(pa.trading_enabled,false);
 for(const key of ['narrative','narrative_method','scenario','A','B','C','rr','target_selection','entry','stop_loss','take_profit'])assert.ok(!(key in pa));
 assert.equal(pa.coverage.evidence_total,pa.evidence.length);assert.equal(pa.omitted.evidence,0);
 assert.ok(pa.evidence.filter(e=>e.kind==='FRACTAL').every(e=>e.facts.variant===3&&e.candle_evidence.length===3));
 assert.ok(pa.evidence.filter(e=>e.kind==='SNR_CLOSED_BREAK').every(e=>!JSON.stringify(e.facts).includes('impulse_policy')&&!JSON.stringify(e.facts).includes('relative_strength')));
 assert.equal(pa.definitions.compression_lrl,'NEEDS_SPECIFICATION');assert.equal(pa.definitions.independent_ohlc_price_validation,'NOT_AVAILABLE');
 for(const dr of pa.dealing_ranges){const structure=pa.market_structure[dr.timeframe];
  if(dr.status==='ESTABLISHED'&&dr.current){assert.equal(structure.liquidity_position_context?.high_id,dr.current.high_id);assert.equal(structure.liquidity_position_context?.scope,'CURRENT_ESTABLISHED_DR');for(const p of structure.fractal_sequence)assert.equal(p.range_position,p.price===dr.current.lower||p.price===dr.current.upper?'BOUNDARY':p.price>dr.current.lower&&p.price<dr.current.upper?'INTERNAL':'EXTERNAL');}
  else{assert.equal(structure.liquidity_position_context,null);assert.ok(structure.fractal_sequence.every(p=>p.range_position==='UNVERIFIED'));}
 }
});

test('V6 core dependency graph does not call interpretation engines',()=>{
 const source=readFileSync('lib/pa-engine/core.ts','utf8');assert.doesNotMatch(source,/from ['"][^'"]*(?:narrative|target-selection|intelligence|risk|tda)['"]/);assert.doesNotMatch(source,/buildIntelligence\(|buildNarrativeMethod\(|resolveHierarchy\(/);
});

test('V6 confirmed Fractal 3 remains causal at historical as_of and future candles are excluded',()=>{
 const input=fixture('EURUSD'),f=closedFrame(input.data.H4,'bid'),cut=f.bars.at(-5)!.end,pa=buildPaEngine(input.data,'bid',{as_of:cut});
 assert.equal(pa.as_of,cut);assert.ok(pa.evidence.every(e=>e.confirmed_at<=cut));
 assert.ok(TF_ORDER.every(tf=>pa.frames[tf].ohlc.every(b=>b.end<=cut)));
 const expected=detectFractals(closedFrame(input.data.H4,'bid',cut),3).map(p=>p.id);
 assert.deepEqual(pa.evidence.filter(e=>e.kind==='FRACTAL'&&e.timeframe==='H4').map(e=>e.id),expected);
});

test('V6 complete evidence detail contacts are traceable, never claim role reversal',()=>{
 const pa=buildPaEngine(fixture('NAS100').data,'bid'),e=pa.evidence.find(e=>e.kind==='FRACTAL'&&e.lifecycle?.first_raid)!;
 assert.ok(e);assert.equal(e.lifecycle?.liquidity_consumed,true);assert.equal(e.current_role,null);
 const events=interactionsForEvidence(pa,e.id);assert.ok(events.length);
 for(const x of events){assert.equal(x.evidence_id,e.id);assert.ok(x.time>=e.confirmed_at&&x.confirmed_at<=pa.evaluated_through);assert.equal(x.role_reversal_confirmed,false);assert.ok(pa.frames[x.timeframe].ohlc.some(b=>b.time===x.time&&b.end===x.confirmed_at));}
 assert.deepEqual(interactionsForEvidence(pa,'missing'),[]);
});

test('V6 distinguishes fully filled FVG from invalidation and never treats it as an active remainder',()=>{
 const pa=buildPaEngine(fixture('EURUSD').data,'bid'),filled=pa.evidence.filter(e=>e.kind==='FVG'&&e.lifecycle?.fill?.max_observed_fraction===1);assert.ok(filled.length);
 for(const e of filled){assert.ok(['TESTED','INVALIDATED'].includes(e.lifecycle!.state));assert.equal(e.remaining_bounds,null);assert.equal(e.current_role,null);}
});

test('Independent arithmetic checker detects invalid geometry, premature closure and calendar-month boundaries without inventing verified sessions',()=>{
 const input=fixture('EURUSD'),d=structuredClone(input.data.MN1);d.candles[0].high.bid=0;d.candles[1].time='2020-02-02T00:00:00.000Z';
 const x=verifyOhlc(d,'bid',d.fetched_at);assert.equal(x.status,'LIMITATIONS_FOUND');assert.ok(x.failures.some(f=>f.reason==='INVALID_OHLC_GEOMETRY'));assert.ok(x.failures.some(f=>f.reason==='NON_CALENDAR_MONTH_START'));assert.equal(x.historical_session_calendar,'NOT_INDEPENDENTLY_VERIFIED');assert.equal(x.independent_price_comparison,'NOT_AVAILABLE');
 const h=structuredClone(input.data.H4);h.candles=[{...h.candles.at(-1)!,time:h.fetched_at,is_closed:true}];assert.ok(verifyOhlc(h,'bid',h.fetched_at).failures.some(f=>f.reason==='CLOSED_FLAG_BEFORE_NOMINAL_END'));
});

test('V6 does not stitch PA or swing comparisons across a rejected interval',()=>{
 const input=fixture('EURUSD'),data=structuredClone(input.data),row=data.H4.candles.at(-12)!;
 data.H4.metadata.validation_gaps=[...(data.H4.metadata.validation_gaps??[]),row.time];
 const pa=buildPaEngine(data,'bid'),bars=pa.frames.H4.ohlc;
 for(const e of pa.evidence.filter(e=>e.timeframe==='H4'&&['FRACTAL','FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(e.kind))){const segments=e.candle_evidence.map(c=>bars.find(b=>b.time===c.time)?.segment);assert.equal(new Set(segments).size,1);}
 const seq=pa.market_structure.H4.swing_sequence,seen=new Set<string>();for(const p of seq){const key=p.segment+':'+p.polarity;if(!seen.has(key))assert.equal(p.relation,'FIRST_OBSERVED');seen.add(key);}
 assert.ok(pa.frames.H4.warnings.includes('GAP_BOUNDARY_NO_PATTERN_STITCHING'));
});
