import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import {encodeIntelligence,decodeIntelligence} from '../lib/knowledge/wire';
import type {snrFormationContext} from '../lib/knowledge/snr-context';
const [inputs,baseline,output]=process.argv.slice(2);
if(!inputs||!baseline||!output)throw Error('Usage: private-inputs.json safe-baseline.json safe-output.json');
const files=JSON.parse(fs.readFileSync(inputs,'utf8')),before=JSON.parse(fs.readFileSync(baseline,'utf8'));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),rows=[];
for(const f of files)for(const side of ['bid','ask'] as const){
 const raw=fs.readFileSync(f.input,'utf8'),i=JSON.parse(raw),r=buildIntelligence(i.data,side,i.quote),all=r.frames.flatMap(f=>f.findings),previous=before.find((x:{symbol:string;side:string})=>x.symbol===f.symbol&&x.side===side);
 assert.equal(hash(JSON.stringify(all.filter(x=>!['SNR_CLOSED_BREAK','STRONG_PIVOT_CANDIDATE'].includes(x.kind)))),previous.unrelated,'Unrelated detector/RB drift');assert.equal(hash(JSON.stringify(r.frames.map(f=>f.dr_detection))),previous.dr,'DR drift');
 const snr=all.filter(x=>x.kind==='SNR_CLOSED_BREAK');for(const x of snr){const s=x.facts.formation as ReturnType<typeof snrFormationContext>;assert.equal(x.facts.lower,x.candle_evidence[0].close);assert.equal(x.facts.upper,x.candle_evidence[0].close);assert.equal(x.confirmed_at,s.breakout_at);assert.ok(s.breakout_at<=r.as_of);assert.ok(s.failed_tests.every(t=>t.closed_at<=x.candle_evidence[3].time));assert.equal(s.failed_tests.length,s.failed_test_bars);if(s.relative_strength==='VERY_STRONG_FORMATION_CANDIDATE')assert.ok(s.failed_test_episodes>=2&&s.impulse_detected&&!s.opposing_kl_id);}
 const now=new Date(Math.max(...Object.values(i.data as Record<string,{fetched_at:string}>).map(d=>Date.parse(d.fetched_at)),...['retrieved_at','fetched_at_utc','provider_timestamp','evaluated_at'].map(k=>Date.parse(i.quote[k])).filter(Number.isFinite))).toISOString();
 const report=buildDeskReport(r,i.data,i.quote,now),text=JSON.stringify(report)+'\n',wire=encodeIntelligence(r);validateReport(report);assert.deepEqual(decodeIntelligence(wire),r);assert.ok(Buffer.byteLength(text)<=65536);assert.ok(Buffer.byteLength(JSON.stringify(wire))<4250000);assert.equal(report.scenario.confirmed_narrative,null);assert.equal(report.trading_enabled,false);
 rows.push({symbol:f.symbol,side,input_sha256:hash(raw),as_of:r.as_of,result:'PASS',unrelated_detectors_and_rb_unchanged:true,dr_unchanged:true,snr_before:previous.snr,snr_after:snr.length,strong_before:previous.strong,strong_after:all.filter(x=>x.kind==='STRONG_PIVOT_CANDIDATE').length,very_strong_without_fvg:snr.filter(x=>{const s=x.facts.formation as ReturnType<typeof snrFormationContext>;return s.relative_strength==='VERY_STRONG_FORMATION_CANDIDATE'&&!s.x1_fvg_id;}).length,report_bytes:Buffer.byteLength(text),report_sha256:hash(text),wire_bytes:Buffer.byteLength(JSON.stringify(wire)),wire_lossless:true});
}
fs.mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});fs.writeFileSync(output,JSON.stringify({revision:'snr-formation-context-2',baseline_commit:'2e7a44289b50ea08abddbdf4315f917f4bc52d36',note:'Fixed technical regressions; not independent expert validation or original FOREXCOM screenshot data.',rows},null,2)+'\n');console.log(JSON.stringify(rows));
