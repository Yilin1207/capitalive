/** Read-only audit of operator-supplied PRIVATE historical Bridge captures.
 * Output contains requested control levels, IDs, timestamps and hashes, no OHLC. */
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {buildIntelligence} from '../lib/knowledge/intelligence';import type {CandleResponse,Timeframe} from '../lib/candle-data';import type {MarketQuote} from '../lib/quote-normalization';
const dir=process.env.PA_V4_INPUT_DIR;if(!dir)throw Error('PA_V4_INPUT_DIR required; never fetch or publish private history automatically');
const controls:[string,string,string,number,number][]=[['EURUSD','MN1','FVG',1.09544,1.10653],['EURUSD','W1','FRACTAL',1.10653,1.10653],['EURUSD','D1','FVG',1.10726,1.10817],['NAS100','MN1','FVG',27530.4,28184.7],['NAS100','W1','SNR_CLOSED_BREAK',28487.5,28488.7],['NAS100','H4','FVG',27962,28151.1],['NAS100','W1','FRACTAL',26255.2,26255.2],['EU50','W1','FRACTAL',6405.4,6405.4],['EU50','D1','FRACTAL',6430.5,6430.5],['EU50','D1','FVG',6346.5,6351.4]];
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');const rows=[];
for(const directory of readdirSync(dir).filter(x=>/^bridge-[a-f0-9]{40}$/.test(x)))for(const symbol of ['EURUSD','NAS100','EU50']){
 const bytes:Buffer=readFileSync(`${dir}/${directory}/${symbol}.json`),old=JSON.parse(bytes.toString()),manifest=JSON.parse(readFileSync(`${dir}/${directory}/manifest.json`,'utf8'));
 const entry=manifest.reports.find((r:{symbol:string})=>r.symbol===symbol);assert.equal(entry.bytes,bytes.length);assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));
 const input=JSON.parse(readFileSync(`${dir}/input-${symbol}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
 const r=buildIntelligence(input.data,'bid',input.quote,{as_of:old.as_of}),findings=r.frames.flatMap(f=>f.findings);
 const checks=controls.filter(c=>c[0]===symbol).map(([,tf,kind,lower,upper])=>{
  const historical=(Object.values(old.evidence) as {id:string;timeframe:string;kind:string;lower:number;upper:number;confirmed_at:string;candle_evidence_sha256:string;lifecycle:unknown}[]).find(e=>e.timeframe===tf&&e.kind===kind&&e.lower===lower&&e.upper===upper);
  const matching=r.levels.detected_levels.filter(l=>l.timeframe===tf&&l.kind===(kind==='SNR_CLOSED_BREAK'?'SNR':kind)&&l.lower===lower&&l.upper===upper);
  const f=historical?findings.find(f=>f.id===historical.id):matching.length?findings.find(f=>f.id===matching[0].id):null;
  const state=f?r.levels.states.find(s=>s.id===f.id):null;
  const same=historical&&f?historical.candle_evidence_sha256===hash(f.candle_evidence):false;
  let indexShift:number|null=null;
  if(historical&&f&&!same)for(let shift=-1000;shift<=1000;shift++){
   if(f.candle_evidence.every(b=>b.index+shift>=0)&&hash(f.candle_evidence.map(b=>({...b,index:b.index+shift})))===historical.candle_evidence_sha256){indexShift=shift;break;}
  }
  // Index is included in the published hash. A shifted rolling window may change
  // indices without changing OHLC; do not silently downgrade exact SHA comparison.
  return {timeframe:tf,kind,lower,upper,old:historical?{id:historical.id,confirmed_at:historical.confirmed_at,candle_evidence_sha256:historical.candle_evidence_sha256,lifecycle:historical.lifecycle}:null,
   new:f?{id:f.id,confirmed_at:f.confirmed_at,candle_evidence_sha256:hash(f.candle_evidence),state:state?.state,current_role:state?.current_role,invalidated_at:state?.invalidated_at,role_proofs:state?.role_evidence.map(e=>({kind:e.kind,timeframe:e.timeframe,confirmed_at:e.confirmed_at})),coverage:state?.coverage}:null,
   formation_comparison:!historical?'NOT_IN_COMPACT_REPORT':!f?'NOT_REPRODUCED_FROM_NEW_CAPTURE':same?'EXACT_FORMATION_HASH_MATCH':indexShift!==null?'EXACT_OHLC_MATCH_AFTER_ROLLING_INDEX_SHIFT':'FORMATION_HASH_MISMATCH',index_shift:indexShift,
   lifecycle_input_equivalence:'NOT_ESTABLISHED_NEW_CAPTURE_IS_NOT_ORIGINAL_FULL_HISTORY'};
 });
 rows.push({commit:directory.slice(7),symbol,as_of:old.as_of,manifest_sha256_verified:true,structure:old.frames.map((f:{timeframe:string;structure:{bias:string;swing_bias:string}})=>({timeframe:f.timeframe,...f.structure,events:undefined,swing_evidence:undefined})),checks});
}
const output=process.env.PA_V4_HISTORY_OUTPUT??'.vercel/v4/history-audit.json';
// Lifecycle contains only window references in compact reports, never candle OHLC.
writeFileSync(output,JSON.stringify({scope:'REQUESTED_HISTORICAL_CONTROLS_NOT_GOLDEN_GROUND_TRUTH',rows},null,2));
console.log(JSON.stringify({reports:rows.length,checks:rows.flatMap(r=>r.checks).reduce((a,c)=>{a[c.formation_comparison]=(a[c.formation_comparison]??0)+1;return a;},{} as Record<string,number>),output}));
