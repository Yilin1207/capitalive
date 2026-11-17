import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport,MAX_REPORT_BYTES} from '../lib/research-bridge/contract';
import {encodeIntelligence,decodeIntelligence} from '../lib/knowledge/wire';
import {TF_ORDER,type Finding} from '../lib/knowledge/detectors';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
const [manifest,output]=process.argv.slice(2);
if(!manifest||!output)throw Error('Usage: verify-rb-v2.ts private-input-manifest.json safe-output.json');
const files=JSON.parse(readFileSync(manifest,'utf8')) as {symbol:string;input:string;baseline_bid:string;baseline_ask:string}[];
const drBaseline=JSON.parse(readFileSync('verification/dr-sequence/replay.json','utf8'));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const unchanged=(fs:Finding[])=>fs.filter(f=>!['RB_TWO_CANDLE','STRONG_PIVOT_CANDIDATE'].includes(f.kind));
const rows=[];
for(const file of files)for(const side of ['bid','ask'] as const){
 const raw=readFileSync(file.input),input=JSON.parse(raw.toString()) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
 const baseline=JSON.parse(readFileSync(file[side==='bid'?'baseline_bid':'baseline_ask'],'utf8')).result as ReturnType<typeof buildIntelligence>;
 const r=buildIntelligence(input.data,side,input.quote),findings=r.frames.flatMap(f=>f.findings),old=baseline.frames.flatMap(f=>f.findings);
 assert.equal(hash(unchanged(findings)),hash(unchanged(old)),'Unrelated detector drift');
 const rb=findings.filter(f=>f.kind==='RB_TWO_CANDLE'),all=new Map(findings.map(f=>[f.id,f]));
 for(const f of rb){const[a,b]=f.candle_evidence;assert.equal(f.facts.level_price,a.close);assert.equal(f.confirmed_at,b.closed_at);assert.equal(f.rule_id,'EDGE.RB.v2');assert.equal(f.candle_evidence.length,2);assert.equal(a.closed_at,b.time);assert.ok(b.closed_at<=r.as_of);assert.ok(f.facts.direction==='bullish'?a.close<a.open&&b.close>b.open:a.close>a.open&&b.close<b.open);for(const k of ['kl_id','rb_liquidity_id','rb_fvg_id'])if(f.facts[k])assert.ok(all.get(String(f.facts[k]))!.confirmed_at<=a.time);}
 const previous=drBaseline.rows.find((x:{symbol:string;side:string})=>x.symbol===file.symbol&&x.side===side);
 for(const f of r.frames){const d=f.dr_detection,expected=previous.ranges.find((x:{timeframe:string})=>x.timeframe===f.timeframe).detection;assert.equal(d.status,expected.status);for(const k of ['lower','upper','direction','start_at','end_at','confirmed_at'] as const)assert.equal(d.current?.[k]??null,expected[k]);}
 const now=new Date(Math.max(...TF_ORDER.map(tf=>Date.parse(input.data[tf].fetched_at)),Date.parse(input.quote.retrieved_at??input.quote.fetched_at_utc??input.data.H4.fetched_at))).toISOString();
 const report=buildDeskReport(r,input.data,input.quote,now),wire=encodeIntelligence(r);validateReport(report);assert.deepEqual(decodeIntelligence(wire),r);assert.ok(Buffer.byteLength(JSON.stringify(report)+'\n')<=MAX_REPORT_BYTES);assert.ok(Buffer.byteLength(JSON.stringify(wire))<4250000);assert.equal(r.narrative.confirmed_narrative,null);assert.equal(report.trading_enabled,false);
 const row={symbol:file.symbol,side,input_sha256:createHash('sha256').update(raw).digest('hex'),as_of:r.as_of,result:'PASS',unrelated_detectors_unchanged:true,dr_unchanged:true,rb_before:old.filter(f=>f.kind==='RB_TWO_CANDLE').length,rb_after:rb.length,raid_backed:rb.filter(f=>f.facts.relative_quality==='RAID_BACKED').length,fvg_only_weaker:rb.filter(f=>f.facts.relative_quality==='WEAKER_FVG_ONLY').length,combined:rb.filter(f=>f.facts.basis==='FVG_AND_LIQUIDITY_RAID').length,strong_before:old.filter(f=>f.kind==='STRONG_PIVOT_CANDIDATE').length,strong_after:findings.filter(f=>f.kind==='STRONG_PIVOT_CANDIDATE').length,report_bytes:Buffer.byteLength(JSON.stringify(report)+'\n'),report_sha256:hash(report),wire_lossless:true,confirmed_narrative:null};rows.push(row);console.log(JSON.stringify(row));
}
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({revision:'rb-first-close-2',baseline:'V5_FIXED_INPUT_EXPORT_WITH_SEPARATE_DR_SEQUENCE_REFERENCE',note:'RB and dependent Strong observations may change. No profitability or independent expert accuracy claim.',rows},null,2)+'\n');
