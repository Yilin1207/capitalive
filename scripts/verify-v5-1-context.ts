import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import {encodeIntelligence,decodeIntelligence} from '../lib/knowledge/wire';
import {closedFrame} from '../lib/knowledge/data';
import {TF_ORDER} from '../lib/knowledge/detectors';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

// Manifest contains local input paths and V5 exports. Raw OHLC never enters this output.
const manifest=process.argv[2],output=process.argv[3];
if(!manifest||!output)throw Error('Usage: node --conditions=react-server --import tsx scripts/verify-v5-1-context.ts <private-input-manifest.json> <safe-summary.json>');
const files=JSON.parse(readFileSync(manifest,'utf8')) as {symbol:string;input:string;baseline_bid:string;baseline_ask:string}[];
const sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rows=[];
for(const file of files)for(const side of ['bid','ask'] as const){
  const raw=readFileSync(file.input),input=JSON.parse(raw.toString()) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
  const baseline=JSON.parse(readFileSync(file[side==='bid'?'baseline_bid':'baseline_ask'],'utf8')) as {result:ReturnType<typeof buildIntelligence>};
  const r=buildIntelligence(input.data,side,input.quote);assert.equal(r.symbol,file.symbol);assert.equal(r.as_of,baseline.result.as_of);
  const findings=r.frames.flatMap(f=>f.findings);assert.equal(sha(findings),sha(baseline.result.frames.flatMap(f=>f.findings)),'Detector output drift');
  assert.equal(sha(r.levels.states),sha(baseline.result.levels.states),'Lifecycle drift');assert.equal(sha(r.narrative),sha(baseline.result.narrative),'Narrative drift');
  assert.equal(r.narrative.confirmed_narrative,null);assert.ok(findings.every(f=>f.confirmed_at<=r.as_of&&f.candle_evidence.every(c=>c.closed_at<=f.confirmed_at)));
  const at=new Date(Math.max(...TF_ORDER.map(tf=>Date.parse(input.data[tf].fetched_at)),Date.parse(input.quote.retrieved_at??input.quote.fetched_at_utc??input.data.H4.fetched_at))).toISOString();
  const report=buildDeskReport(r,input.data,input.quote,at),wire=encodeIntelligence(r);validateReport(report);assert.deepEqual(decodeIntelligence(wire),r);assert.ok(Buffer.byteLength(JSON.stringify(wire))<4250000);
  // Independent arithmetic audit of the named archived FVG. Does not invoke the FVG detector.
  const controls=file.symbol==='NAS100'?r.frames.flatMap(f=>f.findings).filter(f=>f.kind==='FVG'&&
    (f.timeframe==='D1'&&Math.abs(Number(f.facts.lower)-27097.8)<.1||f.timeframe==='MN1'&&Math.abs(Number(f.facts.lower)-27530.4)<.1)).map(f=>{
      const bars=closedFrame(input.data[f.timeframe],side,r.as_of).bars;const a=bars.find(b=>b.time===f.candle_evidence[0].time)!,c=bars.find(b=>b.time===f.candle_evidence[2].time)!;
      const arithmetic={lower:a.high,upper:c.low};assert.equal(arithmetic.lower,f.facts.lower);assert.equal(arithmetic.upper,f.facts.upper);assert.ok(arithmetic.lower<arithmetic.upper);
      const h4=closedFrame(input.data.H4,side,r.as_of).bars.filter(b=>b.time>=f.confirmed_at);
      const hits=h4.filter(b=>b.high>=arithmetic.lower&&b.low<=arithmetic.upper);
      const state=r.levels.states.find(s=>s.id===f.id)!;
      const ownBreak=bars.find(b=>b.time>=f.confirmed_at&&b.close<arithmetic.lower)?.end??null;
      assert.equal(state.invalidated_at,ownBreak);
      return {id:f.id,timeframe:f.timeframe,confirmed_at:f.confirmed_at,arithmetic,h4_closed_observations:h4.length,h4_intersections:hits.length,h4_first_interaction:hits[0]?.end??null,own_tf_break:ownBreak,lifecycle:state.state,fill:state.fill,current_role_v5:state.current_role,current_role_v51:r.research_context.levels.find(l=>l.id===f.id)?.lifecycle_explanation.current_role,independent_arithmetic:'MATCH',fxcm_visual:'INSUFFICIENT_EVIDENCE'};
    }):[];
  const row={symbol:file.symbol,side,input_sha256:createHash('sha256').update(raw).digest('hex'),as_of:r.as_of,environment:r.environment,
    baseline:'V5_FIXED_INPUT_EXPORT',detector_sha256:sha(findings),detectors_unchanged:true,lifecycle_unchanged:true,narrative_unchanged:true,
    findings:findings.length,report_bytes:Buffer.byteLength(JSON.stringify(report))+1,report_sha256:createHash('sha256').update(JSON.stringify(report)+'\n').digest('hex'),wire_bytes:Buffer.byteLength(JSON.stringify(wire)),wire_lossless:true,
    observed:r.research_context.observed_price_behaviour.map(o=>({timeframe:o.timeframe,last_leg:o.last_observed_fractal_leg?.direction??null,close_change:o.last_close_change?.direction??null,significance:o.significance})),
    selected_levels:report.research_context.executive_evidence.items.length,evidence_included:report.coverage.findings_included,budget_tier:report.coverage.budget_tier,
    ranges:report.research_context.dealing_range_reviews.map(f=>({timeframe:f.timeframe,total:f.candidates.total,displayed_suitable:f.candidates.items[0]?.candidate_suitable_for_review??false})),controls,result:'PASS'};
  rows.push(row);console.log(JSON.stringify({symbol:row.symbol,side,result:row.result,bytes:row.report_bytes,controls:row.controls.length}));
}
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({audit:'V5_VS_V5_1_SAME_OHLC_NO_FXCM_OR_EXPERT_ORACLE',rows},null,2)+'\n');
