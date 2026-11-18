import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {buildPaEngine,interactionsForEvidence} from '../lib/pa-engine/core';
import {buildPaReport} from '../lib/pa-engine/report';import {validatePaReport} from '../lib/pa-engine/contract';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import type {CandleResponse,Timeframe,PriceSide} from '../lib/candle-data';import type {MarketQuote} from '../lib/quote-normalization';
type Input={data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const manifest=arg('--inputs'),out=arg('--out');
const entries:{symbol:string;input:string}[]=manifest?JSON.parse(fs.readFileSync(manifest,'utf8')):[{symbol:'EURUSD',input:'tests/fixtures/edge-v2/EURUSD.json'},{symbol:'NAS100',input:'tests/fixtures/edge-v2/NAS100.json'},{symbol:'EU50',input:'tests/fixtures/edge-v2/EU50.json'}];
const forbidden=new Set(['narrative','narrative_method','candidate_narrative','confirmed_narrative','scenario','entry','entry_stop','stop_loss','take_profit','rr','verdict','target_selection','quality_score','probability']);
function noForecast(v:unknown){if(Array.isArray(v))v.forEach(noForecast);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){assert.ok(!forbidden.has(k.toLowerCase()),k);noForecast(x);}}
const rows=[];
for(const entry of entries)for(const side of ['bid','ask'] as PriceSide[]){
 const raw=fs.readFileSync(entry.input);const input:Input=JSON.parse(raw.toString('utf8'));
 const core=buildPaEngine(input.data,side),legacy=buildIntelligence(input.data,side,input.quote),kinds=['FRACTAL','FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK','TOUCH','RAID'];
 const before=legacy.frames.flatMap(f=>f.findings).filter(f=>kinds.includes(f.kind)),after=core.evidence.filter(e=>kinds.includes(e.kind));
 assert.deepEqual(after.map(e=>e.id).sort(),before.map(e=>e.id).sort());
 for(const e of after){const old=before.find(f=>f.id===e.id)!;assert.equal(e.confirmed_at,old.confirmed_at);assert.deepEqual(e.candle_evidence,old.candle_evidence);assert.ok(e.candle_evidence.every(c=>c.closed_at<=e.confirmed_at&&c.time<c.closed_at));assert.ok(e.confirmed_at<=core.as_of);}
 noForecast(core);
 const now=new Date(Math.max(...Object.values(input.data).map(d=>Date.parse(d.fetched_at)),...['retrieved_at','fetched_at_utc','provider_timestamp','evaluated_at'].map(k=>Date.parse(input.quote[k as keyof MarketQuote] as string)).filter(Number.isFinite))).toISOString();
 const report=buildPaReport(core,input.data,input.quote,now);validatePaReport(report,entry.symbol);noForecast(report);
 const bytes=Buffer.byteLength(JSON.stringify(report)+'\n');assert.ok(bytes<=65536);assert.equal(report.coverage.findings_included+report.omitted.evidence,core.evidence.length);
 for(const e of core.evidence){if(e.lifecycle?.liquidity_consumed)assert.equal(e.current_role,null);if(e.lifecycle?.fill?.max_observed_fraction===1){assert.ok(['TESTED','INVALIDATED'].includes(e.lifecycle.state));assert.equal(e.remaining_bounds,null);}assert.ok(e.evaluated_through<=core.as_of);}
 const consumption=core.evidence.filter(e=>e.kind==='FRACTAL'&&e.lifecycle?.liquidity_consumed),sample=consumption.at(-1);if(sample){const events=interactionsForEvidence(core,sample.id);assert.ok(events.every(e=>e.confirmed_at<=core.evaluated_through&&e.time>=sample.confirmed_at));}
 // Quote location cannot revive the removed EURUSD target or generate A/B/C.
 if(entry.symbol==='EURUSD'){const above=buildPaReport(core,input.data,{...input.quote,bid:1.2,ask:1.2001,mid:1.20005},now);validatePaReport(above,entry.symbol);noForecast(above);assert.equal(above.snapshot_sha256,report.snapshot_sha256);}
 const row={symbol:entry.symbol,side,input_kind:'ARCHIVED_PROVIDER_SNAPSHOT',input_sha256:createHash('sha256').update(raw).digest('hex'),as_of:core.as_of,baseline:'V5.1_DETECTORS',pa_ids_and_candles_identical:true,confirmed_causal_evidence:core.evidence.length,consumed_fractals:consumption.length,interpretation_fields_present:false,report_bytes:bytes,report_sha256:createHash('sha256').update(JSON.stringify(report)+'\n').digest('hex'),omitted_evidence:report.omitted.evidence,report_status_at_archived_clock:report.status,full_evidence_lookup_count:core.evidence.length,result:'PASS'};
 rows.push(row);console.log(JSON.stringify(row));
}
if(out)fs.writeFileSync(out,JSON.stringify({revision:'pa-only-v6-regression-1',rows},null,2)+'\n');
