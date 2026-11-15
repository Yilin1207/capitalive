// Controls already exposed in V2. Never loads the blinded evaluation package.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('Use before or after');
const dir=`verification/capitalive-v3/${phase}`;mkdirSync(dir,{recursive:true});const summary=[];
for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'] as const){
 const raw=readFileSync(`tests/fixtures/edge-v2/${symbol}.json`,'utf8'),input=JSON.parse(raw) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
 const r=buildIntelligence(input.data,side,input.quote);assert.equal(r.execution.order,null);assert.equal(r.verdict.action,'WAIT');
 assert.equal(JSON.stringify(r),JSON.stringify(buildIntelligence(input.data,side,input.quote)));
 for(const f of r.frames)for(const finding of f.findings){assert.ok(finding.confirmed_at<=r.as_of);assert.ok(finding.candle_evidence.every(b=>b.closed_at<=finding.confirmed_at));}
 const record={fixture_sha256:createHash('sha256').update(raw).digest('hex'),phase,symbol,side,response:r};
 if(phase==='after'){const before=JSON.parse(readFileSync(`verification/capitalive-v3/before/${symbol}-${side}.json`,'utf8'));assert.equal(record.fixture_sha256,before.fixture_sha256);assert.equal(r.as_of,before.response.as_of);}
 writeFileSync(`${dir}/${symbol}-${side}.json`,JSON.stringify(record)+'\n');summary.push({symbol,side,input_sha256:record.fixture_sha256,as_of:r.as_of,data_quality:r.data_quality,narrative:{bias:r.narrative.bias,candidate:r.narrative.candidate_bias,status:r.narrative.status},target:r.target_selection.status,target_candidates:r.target_selection.target_candidates.length,execution:r.execution.models.map(m=>({model:m.model,available:m.available})),false_positives:null,metrics_status:'NO_REFERENCE_LABELS',evidence_confidence:r.assessment.evidence_confidence,closed:r.frames.map(f=>({tf:f.timeframe,count:f.closed_candles}))});
}
writeFileSync(`${dir}/summary.json`,JSON.stringify({phase,controls:'Previously exposed V2 controls; NOT blind evaluation or original lost audit snapshot',summary},null,2)+'\n');console.log(JSON.stringify({phase,controls:summary.length,determinism:'PASS',causality:'PASS'}));
