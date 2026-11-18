// Run before changing the V1 implementation. Stores projections, never provider credentials.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {closedFrame} from '../lib/knowledge/data';
import {detectFractals,detectFvg,pivotLevels,TF_ORDER} from '../lib/knowledge/detectors';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='1d9234110e9b689c94e71431821f79d2d6630688')throw new Error('Capture requires original V1 commit');
execFileSync('git',['diff','--exit-code','HEAD','--','lib/knowledge']);
mkdirSync('tests/fixtures/edge-v2',{recursive:true});
mkdirSync('verification/the-edge-v2/before',{recursive:true});
for(const symbol of ['EURUSD','NAS100','EU50']){
 const raw=readFileSync(`verification/the-edge-v2/source-${symbol}.json`,'utf8'),audit=JSON.parse(raw);
 const fixture={provenance:{capture_kind:'NEW_CONTROL_SAMPLE_NOT_ORIGINAL_122545_AUDIT',source_url:`https://capitalive-iu2pc1rr8-yilin1207s-projects.vercel.app/api/market-audit?symbol=${symbol}&include_candles=1&view=priority`,captured_at:audit.generated_at,source_sha256:createHash('sha256').update(raw).digest('hex')},quote:audit.quote as MarketQuote,data:Object.fromEntries(TF_ORDER.map(tf=>{const s=audit.structure[tf];return [tf,{ok:true,symbol,epic:audit.quote.epic,timeframe:tf,provider:'Capital.com',environment:audit.environment,price_side:'bid_ask',fetched_at:s.fetched_at,candles:s.candles,metadata:s.metadata}];})) as Record<Timeframe,CandleResponse>};
 writeFileSync(`tests/fixtures/edge-v2/${symbol}.json`,JSON.stringify(fixture)+'\n');
 for(const set of ['control','archive'])for(const side of ['bid','ask'] as const){
  const input=set==='control'?fixture:JSON.parse(readFileSync(`tests/fixtures/htf-${symbol}.json`,'utf8'));
  const result=buildIntelligence(input.data,side,input.quote),asOf=result.as_of;
  const levels=TF_ORDER.flatMap(tf=>{const frame=closedFrame(input.data[tf],side,asOf);return [...pivotLevels(detectFractals(frame)),...detectFvg(frame).levels].map(l=>{const b=frame.bars.find(b=>b.end===l.confirmed_at);return {id:l.id,kind:l.kind,timeframe:tf,role:l.role,lower:l.lower,upper:l.upper,confirmed_at:l.confirmed_at,invalidated_at:l.invalidated_at??null,active:b?.segment===frame.bars.at(-1)?.segment&&(!l.invalidated_at||l.invalidated_at>asOf)};});});
  const projection={baseline_commit:'1d9234110e9b689c94e71431821f79d2d6630688',symbol,side,set,as_of:asOf,input_sha256:createHash('sha256').update(JSON.stringify(input.data)).digest('hex'),levels,narrative:result.narrative,execution:result.execution,data_quality:result.data_quality,frame_quality:result.frames.map(f=>({tf:f.timeframe,closed:f.closed_candles,warnings:f.warnings})),verdict:result.verdict};
  writeFileSync(`verification/the-edge-v2/before/${set}-${symbol}-${side}.json`,JSON.stringify(projection,null,2)+'\n');
 }
}
