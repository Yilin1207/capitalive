import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';import {encodeIntelligence} from '../lib/knowledge/wire';import {buildDeskReport} from '../lib/research-bridge/report';import {validateReport} from '../lib/research-bridge/contract';
import {closedFrame,type Frame} from '../lib/knowledge/data';import * as pa from '../lib/knowledge/detectors';import type {CandleResponse,Timeframe} from '../lib/candle-data';import type {MarketQuote} from '../lib/quote-normalization';
const out=process.env.PA_V4_OUTPUT??'.vercel/v4/replay';mkdirSync(out,{recursive:true});
const baselineDir=process.env.PA_V4_BASELINE_DIR,privateDir=process.env.PA_V4_INPUT_DIR;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function stableEvents(f:Frame,context:pa.KeyLevel[]){const pivots=pa.detectFractals(f),gaps=pa.detectFvg(f),raids=pa.detectRaids(f,pivots),rb=pa.detectRejectionBlocks(f,context),snr=pa.detectSnr(f,context);return [...pivots,...gaps.findings,...pa.detectInversions(f,gaps.levels),...raids,...rb,...snr,...pa.detectIdm(f,pivots,context),...pa.detectStrong(f,pivots,raids,[...rb,...snr]),...pa.detectStructure(f,pivots).findings];}
const rows=[];
for(const set of ['archive','control',...(privateDir?['current']:[])])for(const symbol of ['EURUSD','NAS100','EU50']){
 const path=set==='current'?`${privateDir}/input-${symbol}.json`:set==='control'?`tests/fixtures/edge-v2/${symbol}.json`:`tests/fixtures/htf-${symbol}.json`;
 const raw=readFileSync(path),input=JSON.parse(raw.toString()) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
 for(const side of ['bid','ask'] as const){
  const started=performance.now(),r=buildIntelligence(input.data,side,input.quote),findings=r.frames.flatMap(f=>f.findings);
  const reportTime=new Date(Math.max(...Object.values(input.data).map(d=>Date.parse(d.fetched_at)),...['retrieved_at','fetched_at_utc','provider_timestamp','evaluated_at'].map(k=>Date.parse(String((input.quote as unknown as Record<string,unknown>)[k]))).filter(Number.isFinite))).toISOString();
  const report=buildDeskReport(r,input.data,input.quote,reportTime);validateReport(report,symbol,Date.parse(reportTime));
  assert.equal(report.scenario.action,'NOT_EVALUATED');assert.equal(report.scenario.confirmed_narrative,null);
  assert.equal(new Set(findings.map(f=>f.id)).size,findings.length);assert.ok(findings.every(f=>f.confirmed_at<=r.as_of&&f.candle_evidence.every(b=>b.closed_at<=f.confirmed_at)));
  assert.ok(r.levels.states.every(s=>s.state!=='INVALIDATED'||s.current_role===null));
  const bytes=Buffer.byteLength(JSON.stringify(encodeIntelligence(r)));assert.ok(bytes<=4_250_000,`full response budget ${symbol}/${side}: ${bytes}`);
  // Replay every closed prefix of each TF. Context is filtered by knownLevel's
  // timestamp/continuity rules, never by the position of the current live quote.
  const frames=pa.TF_ORDER.map(tf=>closedFrame(input.data[tf],side,r.as_of));
  const context=frames.flatMap(f=>[...pa.pivotLevels(pa.detectFractals(f)),...pa.detectFvg(f).levels]);
  let prefixes=0;
  for(const f of frames){const full=stableEvents(f,context);
   for(let n=1;n<=f.bars.length;n++){const prefix={...f,bars:f.bars.slice(0,n),as_of:f.bars[n-1].end},observed=stableEvents(prefix,context),expected=full.filter(e=>e.confirmed_at<=prefix.as_of);
    assert.equal(digest(observed),digest(expected),`${set}/${symbol}/${side}/${f.timeframe} prefix ${n}`);prefixes++;
   }
  }
  const differential:{status:string;removed:Record<string,number>;added:Record<string,number>;changed_findings:number;changed_states:Record<string,number>;unexplained:number}={status:'BASELINE_NOT_SUPPLIED',removed:{},added:{},changed_findings:0,changed_states:{},unexplained:0};
  const baselinePath=baselineDir?`${baselineDir}/${set}-${symbol}-${side}.json`:'';
  if(baselinePath&&existsSync(baselinePath)){
   const base=JSON.parse(readFileSync(baselinePath,'utf8')) as {input_sha256:string;result:ReturnType<typeof buildIntelligence>};assert.equal(base.input_sha256,createHash('sha256').update(raw).digest('hex'));
   const oldFindings=new Map(base.result.frames.flatMap(f=>f.findings).map(f=>[f.id,f])),newFindings=new Map(findings.map(f=>[f.id,f]));
   const rejectedSnr=new Set([...oldFindings].filter(([id,f])=>f.kind==='SNR_CLOSED_BREAK'&&!newFindings.has(id)).map(([id,f])=>{
    const frame=frames.find(x=>x.timeframe===f.timeframe)!,[,junction,delivery]=f.candle_evidence;
    const first=frame.bars.find(b=>b.index>junction.index&&b.segment===frame.bars.find(b=>b.index===junction.index)?.segment&&(f.facts.old_role==='resistance'?b.close>Number(f.facts.upper):b.close<Number(f.facts.lower)));
    assert.ok(first&&first.index<delivery.index,'removed SNR must have a closed breakout before KL delivery');return id;
   }));
   const relinked=(f:pa.Finding)=>f.kind==='STRONG_PIVOT_CANDIDATE'&&!!newFindings.get(String(f.facts.vc_id))&&[...oldFindings.values()].some(old=>old.kind===f.kind&&old.facts.pivot_id===f.facts.pivot_id&&old.facts.raid_id===f.facts.raid_id&&rejectedSnr.has(String(old.facts.vc_id)));
   for(const [id,old]of oldFindings){const current=newFindings.get(id);if(!current){differential.removed[old.kind]=(differential.removed[old.kind]??0)+1;if(!rejectedSnr.has(id)&&!(old.kind==='STRONG_PIVOT_CANDIDATE'&&rejectedSnr.has(String(old.facts.vc_id))))differential.unexplained++;}else if(digest(current)!==digest(old)){differential.changed_findings++;if(!relinked(current))differential.unexplained++;}}
   for(const [id,f]of newFindings)if(!oldFindings.has(id)){differential.added[f.kind]=(differential.added[f.kind]??0)+1;if(!relinked(f))differential.unexplained++;}
   const oldStates=new Map(base.result.levels.states.map(s=>[s.id,s]));const unexplained=[];
   for(const s of r.levels.states){const previous=oldStates.get(s.id);if(!previous)continue;const keys=['state','current_role','role_status','reaction','role_evidence'] as const;
    if(keys.every(k=>digest(s[k])===digest(previous[k])))continue;
    const withdrawn=previous.state===s.state&&['CONSUMED','UNVERIFIED'].includes(s.state)&&s.current_role===null&&s.role_status==='UNVERIFIED'&&digest(s.reaction)===digest(previous.reaction)&&digest(s.role_evidence)===digest(previous.role_evidence);
    const reason=s.kind==='FVG'&&s.state==='INVALIDATED'?'FVG_TERMINAL_ROLE_AND_REACTION':s.counterarguments.includes('RETESTED_ROLE_BROKEN_REVIEW_REQUIRED')?'RETESTED_ROLE_NEWER_BREACH':s.counterarguments.includes('ROLE_SEQUENCE_GAP')?'ROLE_SEQUENCE_GAP':withdrawn?'UNPROVEN_CURRENT_ROLE_WITHDRAWN':'UNEXPLAINED';
    differential.changed_states[reason]=(differential.changed_states[reason]??0)+1;if(reason==='UNEXPLAINED'){differential.unexplained++;unexplained.push({id:s.id,old:previous,current:s});}
   }
   if(unexplained.length)writeFileSync(`${out}/unexplained-${set}-${symbol}-${side}.json`,JSON.stringify(unexplained));
   assert.equal(differential.unexplained,0,JSON.stringify(differential));differential.status='EXPLAINED';
  }
  // Full inputs and detailed engine outputs are ignored local artifacts, never CI uploads.
  writeFileSync(`${out}/${set}-${symbol}-${side}.json`,JSON.stringify({result:r,report}));
  const row={set,symbol,side,input_sha256:createHash('sha256').update(raw).digest('hex'),as_of:r.as_of,closed_prefixes:prefixes,findings:findings.length,report_bytes:Buffer.byteLength(JSON.stringify(report)+'\n'),report_sha256:createHash('sha256').update(JSON.stringify(report)+'\n').digest('hex'),budget_tier:report.coverage.budget_tier,wire_bytes:bytes,range_candidates:r.frames.map(f=>({tf:f.timeframe,total:f.range_candidates.candidates.length})),differential,result:'PASS',duration_ms:Math.round(performance.now()-started)};rows.push(row);console.log(JSON.stringify(row));
 }
}
writeFileSync(`${out}/summary.json`,JSON.stringify({schema_version:'pa-v4-validation-1',baseline_commit:'b26cdbc5d73a575a147bcf4379951e673b09f31e',expert_review:'PENDING',accuracy_metrics:null,rows},null,2));
