/** Operator-supplied private input only. Never writes raw OHLC to tracked paths. */
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';import {closedFrame,type Frame} from '../lib/knowledge/data';import * as pa from '../lib/knowledge/detectors';
import {buildDeskReport} from '../lib/research-bridge/report';import {validateReport} from '../lib/research-bridge/contract';import {encodeIntelligence} from '../lib/knowledge/wire';
import type {CandleResponse,Timeframe} from '../lib/candle-data';import type {MarketQuote} from '../lib/quote-normalization';
const path=process.env.JP225_INPUT;if(!path)throw Error('JP225_INPUT must name a private captured CandleResponse/quote bundle');
const raw=readFileSync(path),input=JSON.parse(raw.toString()) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
assert.ok(Object.values(input.data).every(d=>d.symbol==='JP225'&&d.epic==='J225'&&d.provider==='Capital.com'));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const events=(f:Frame,context:pa.KeyLevel[])=>{const p=pa.detectFractals(f),g=pa.detectFvg(f),raids=pa.detectRaids(f,p),rb=pa.detectRejectionBlocks(f,context),snr=pa.detectSnr(f,context);return [...p,...pa.detectFractals(f,5),...g.findings,...pa.detectInversions(f,g.levels),...raids,...rb,...snr,...pa.detectIdm(f,p,context),...pa.detectStrong(f,p,raids,[...rb,...snr]),...pa.detectStructure(f,p).findings];};
const results=[];for(const side of ['bid','ask'] as const){
 const r=buildIntelligence(input.data,side,input.quote),now=new Date(Math.max(...Object.values(input.data).map(d=>Date.parse(d.fetched_at)),...['retrieved_at','fetched_at_utc','provider_timestamp'].map(k=>Date.parse(String((input.quote as unknown as Record<string,unknown>)[k]))).filter(Number.isFinite))).toISOString();
 const report=buildDeskReport(r,input.data,input.quote,now),text=JSON.stringify(report)+'\n';validateReport(report,'JP225',Date.parse(now));
 assert.equal(report.scenario.confirmed_narrative,null);assert.equal(report.scenario.action,'NOT_EVALUATED');assert.ok(Buffer.byteLength(text)<=65536);
 const frames=pa.TF_ORDER.map(tf=>closedFrame(input.data[tf],side,r.as_of)),context=frames.flatMap(f=>[...pa.pivotLevels(pa.detectFractals(f)),...pa.detectFvg(f).levels]);let prefixes=0;
 for(const f of frames){const all=events(f,context);for(let n=1;n<=f.bars.length;n++){const p={...f,bars:f.bars.slice(0,n),as_of:f.bars[n-1].end};assert.equal(hash(events(p,context)),hash(all.filter(e=>e.confirmed_at<=p.as_of)),`${side}/${f.timeframe}/${n}`);prefixes++;}}
 for(const f of r.frames)assert.ok(f.findings.every(e=>e.confirmed_at<=r.as_of&&e.candle_evidence.every(b=>b.closed_at<=e.confirmed_at)));
 assert.ok(r.levels.states.every(s=>!['INVALIDATED','CONSUMED','UNVERIFIED'].includes(s.state)||s.current_role===null));
 const counts=r.frames.flatMap(f=>f.findings).reduce((a,f)=>{const kind=f.kind==='FRACTAL'?`FRACTAL_${f.facts.variant}`:f.kind;a[kind]=(a[kind]??0)+1;return a;},{} as Record<string,number>);
 const wireBytes=Buffer.byteLength(JSON.stringify(encodeIntelligence(r)));assert.ok(wireBytes<=4_250_000);
 results.push({side,as_of:r.as_of,closed_prefixes:prefixes,detectors:counts,frames:r.frames.map(f=>({tf:f.timeframe,closed:f.closed_candles,status:f.data_status,range_candidates:f.range_candidates.candidates.length})),report_status:report.status,report_bytes:Buffer.byteLength(text),report_sha256:createHash('sha256').update(text).digest('hex'),wire_bytes:wireBytes,findings_total:report.coverage.findings_total,findings_omitted:report.coverage.findings_omitted,selected_evidence_complete:report.coverage.selected_evidence_complete,result:'PASS'});
}
const result={input_sha256:createHash('sha256').update(raw).digest('hex'),scope:'JP225_PRIVATE_CAPTURE_REPLAY_NOT_INDEPENDENT_ACCURACY_VALIDATION',results};
writeFileSync(process.env.JP225_REPLAY_OUTPUT??'.vercel/jp225/replay-summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
