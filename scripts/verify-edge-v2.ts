import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {encodeIntelligence} from '../lib/knowledge/wire';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const baseline='verification/the-edge-v2';
const output=process.env.CAPITALIVE_REPLAY_OUTPUT??baseline;mkdirSync(`${output}/after`,{recursive:true});
const comparisons=[];
for(const set of ['control','archive'])for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'] as const){
 const path=set==='control'?`tests/fixtures/edge-v2/${symbol}.json`:`tests/fixtures/htf-${symbol}.json`,raw=readFileSync(path,'utf8');
 const input=JSON.parse(raw) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote;provenance:unknown};
 const before=JSON.parse(readFileSync(`${baseline}/before/${set}-${symbol}-${side}.json`,'utf8'));
 assert.equal(hash(JSON.stringify(input.data)),before.input_sha256,'BEFORE/AFTER must use identical OHLC');
 const start=performance.now(),r=buildIntelligence(input.data,side,input.quote),serialized=JSON.stringify(r);
 if(set==='control')writeFileSync(`${output}/control-response-${symbol}-${side}.json`,serialized+'\n');
 const wireBytes=Buffer.byteLength(JSON.stringify(encodeIntelligence(r)));
 assert.equal(r.as_of,before.as_of);assert.ok(wireBytes<4_250_000,'Encoded HTTP response budget');
 assert.equal(r.data_quality.status,before.data_quality.status,'No data quality promotion');
 assert.equal(r.verdict.action,'WAIT');assert.equal(r.execution.order,null);
 for(const s of r.levels.states){
  assert.ok(s.confirmed_at<=r.as_of);assert.ok(!s.invalidated_at||s.invalidated_at<=s.evaluated_through);
  for(const e of [s.first_raid,s.last_test,s.reaction,s.lower_tf_breach,...s.role_evidence].filter(e=>e!==null)){
   assert.ok(e.time>=s.confirmed_at);assert.ok(e.confirmed_at<=s.evaluated_through);assert.ok(e.confirmed_at<=r.as_of);
  }
 }
 const projection={symbol,side,set,as_of:r.as_of,input_sha256:before.input_sha256,levels:r.levels,target_selection:r.target_selection,narrative:r.narrative,execution:r.execution,data_quality:r.data_quality,frame_quality:r.frames.map(f=>({tf:f.timeframe,closed:f.closed_candles,warnings:f.warnings,diagnostics:f.diagnostics})),verdict:r.verdict};
 writeFileSync(`${output}/after/${set}-${symbol}-${side}.json`,JSON.stringify(projection,null,2)+'\n');
 const counts=(states:typeof r.levels.states)=>Object.fromEntries([...new Set(states.map(s=>s.state))].map(k=>[k,states.filter(s=>s.state===k).length]));
 comparisons.push({set,symbol,side,fixture:path,fixture_sha256:hash(raw),input_sha256:before.input_sha256,as_of:r.as_of,provenance:input.provenance,reference:r.data_quality.reference_price,
  before:{detected:before.levels.length,active:before.levels.filter((l:{active:boolean})=>l.active).length,bias:before.narrative.bias,target:before.narrative.B?.price??null},
  after:{detected:r.levels.detected_levels.length,active:r.levels.active_level_ids.length,states:counts(r.levels.states),bias:r.narrative.bias,candidate_bias:r.narrative.candidate_bias,status:r.narrative.status,target:r.narrative.B?.price??null,target_status:r.target_selection.status,blockers:r.narrative.blockers},
  prior_target_reassessment:before.narrative.B?r.levels.states.find(s=>s.id===before.narrative.B.id)??null:null,
  frame_quality:projection.frame_quality,
  data_status:r.data_quality.status,verdict:r.verdict.status,action:r.verdict.action,result:'PASS',bytes:Buffer.byteLength(serialized),wire_bytes:wireBytes,duration_ms:Math.round(performance.now()-start)});
}
const report={checked_at:new Date().toISOString(),baseline_commit:'1d9234110e9b689c94e71431821f79d2d6630688',original_audit_reproducible:false,control:'New Nov 15 snapshots, NOT the original 12:25:45 audit',archive:'Nov 12 recorded provider data; overlapping histories, NOT independent out-of-sample performance validation',profitability_validated:false,comparisons};
writeFileSync(`${output}/comparison.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
