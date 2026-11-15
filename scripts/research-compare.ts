// Only invoked AFTER the user exports frozen labels. Never precomputes blind predictions.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {verifyFrozen,scoreEvents,type BenchmarkEvent} from '../lib/research/benchmark';
import type {BlindCase} from '../lib/research/blind';
async function main(){
const file=process.argv[2];if(!file)throw Error('Pass a user-exported FROZEN labels JSON; drafts are rejected before importing the engine.');
const pack=JSON.parse(readFileSync('knowledge/research/blind-pack.json','utf8')) as {pack_id:string;cases:BlindCase[]};
const frozen=verifyFrozen(JSON.parse(readFileSync(file,'utf8')),pack);
const root=`verification/capitalive-v3/evaluation/${frozen.sha256}`;mkdirSync(`${root}/labels`,{recursive:true});mkdirSync(`${root}/predictions`,{recursive:true});
const saved=`${root}/labels/frozen.json`;if(!existsSync(saved))writeFileSync(saved,JSON.stringify(frozen,null,2)+'\n',{flag:'wx'});else verifyFrozen(JSON.parse(readFileSync(saved,'utf8')),pack);
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// Dynamic import deliberately occurs only after the freeze/checksum gate and separate label archive.
const {buildIntelligence}=await import('../lib/knowledge/intelligence');const {unavailable}=await import('../lib/quote-normalization');
const rows=[];
for(const label of [...frozen.labels].sort((a,b)=>pack.cases.find(c=>c.id===a.case_id)!.as_of.localeCompare(pack.cases.find(c=>c.id===b.case_id)!.as_of))){
 const c=pack.cases.find(c=>c.id===label.case_id)!,r=buildIntelligence(c.data,c.price_side,unavailable(c.symbol,c.data.H4.epic),{as_of:c.as_of});const prediction=JSON.stringify(r);writeFileSync(`${root}/predictions/${c.id}.json`,prediction+'\n');
 const map:Record<string,string>={FVG:'FVG',FVG_CLOSED_BREACH:'IFVG',RB_TWO_CANDLE:'RB',SNR_CLOSED_BREAK:'SNR',RAID:'RAID',BOS:'BOS',CHOCH:'CHOCH',IDM_INSIDE_POI:'IDM',STRONG_PIVOT_CANDIDATE:'STRONG_HIGH_LOW',DEALING_RANGE:'DR',INTERNAL_LIQUIDITY:'IRL'};
 const events:BenchmarkEvent[]=r.frames.flatMap(f=>f.findings.flatMap(v=>{const kind=v.kind==='FRACTAL'?`FRACTAL_${v.facts.variant}`:map[v.kind];if(!kind)return [];const lower=typeof v.facts.lower==='number'?v.facts.lower:typeof v.facts.price==='number'?v.facts.price:null,upper=typeof v.facts.upper==='number'?v.facts.upper:typeof v.facts.price==='number'?v.facts.price:null;return [{id:v.id,timeframe:v.timeframe,kind,origin:v.origin,confirmed_at:v.confirmed_at,lower,upper}];}));
 const referenceB=label.annotations.find(a=>a.id===label.B),actualB=r.narrative.B?r.frames.flatMap(f=>f.findings).find(f=>f.id===r.narrative.B!.id):undefined;
 rows.push({case_id:c.id,as_of:c.as_of,symbol:c.symbol,prediction_sha256:createHash('sha256').update(prediction).digest('hex'),pa:scoreEvents(label,events),narrative:{reference:label.narrative,predicted:r.narrative.confirmed_narrative??'REVIEW_REQUIRED',agreement:label.narrative==='Uncertain'?null:label.narrative===(r.narrative.confirmed_narrative??'REVIEW_REQUIRED')},target:{status:r.target_selection.status,reference_B:referenceB??null,exact_origin_agreement:referenceB?!!actualB&&actualB.timeframe===referenceB.timeframe&&actualB.origin===new Date(referenceB.origin).toISOString():null},wait:r.verdict.action==='WAIT'});
}
const evaluated=rows.filter(r=>r.narrative.agreement!==null),summary={label_sha256:frozen.sha256,engine_commit:commit,evaluated_at:new Date().toISOString(),independence:frozen.independence,walk_forward:'Chronological replay without fitting; overlapping histories and user review do NOT establish independent OOS performance',rows,metrics:{tp:rows.reduce((n,r)=>n+r.pa.tp,0),fp:rows.reduce((n,r)=>n+r.pa.fp,0),fn:rows.reduce((n,r)=>n+r.pa.fn,0),narrative_agreement:evaluated.length?evaluated.filter(r=>r.narrative.agreement).length/evaluated.length:null,wait_fraction:rows.length?rows.filter(r=>r.wait).length/rows.length:null},limitations:['Exact-event mismatch requires manual adjudication; timing conventions are not semantic truth.','DR/IRL requiring explicit selections are unselected in default inference; misses are reported, never fitted to reference labels.','Compression and displacement thresholds remain unspecified, not invented.','Target origin agreement is not target profitability or full eligibility adjudication.']};
writeFileSync(`${root}/comparison.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({file:`${root}/comparison.json`,labeled:rows.length,independence:summary.independence}));
}
void main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
