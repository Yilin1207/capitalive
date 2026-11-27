// Publishes Capitalive batch briefs as static JSON for clients that can only reach raw.githubusercontent.com.
// Runs in the public snapshot repository (GitHub Actions). Market data only: no keys, account or balance.
// Usage: node publish.mjs [outDir]   env: CAPITALIVE_BASE (default https://capitalive.vercel.app), BRIEF_LATEST (default 12)
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const SYMBOLS=['NAS100','EU50','EURUSD'];
export const PER_ASSET_MAX_BYTES=200_000;
const FORBIDDEN=new Set(['narrative','scenario','scenarios','entry','entrystop','stoploss','takeprofit','rr','verdict','targetselection','qualityscore','probability','direction','bias','score','account','accountid','balance','equity','password','apikey','token','secret']);
const SECRET_PATTERNS=[/github_pat_/i,/\bghp_[A-Za-z0-9]/,/\bgho_[A-Za-z0-9]/,/Bearer\s+[A-Za-z0-9._-]+/i,/X-CAP-API-KEY/i,/CAPITAL_API_(KEY|PASSWORD)/i];
const norm=k=>k.replace(/[^a-z0-9]/gi,'').toLowerCase();

/** Throws unless the batch is a technical-only Capitalive brief batch that is safe to publish. */
export function checkBatch(batch,raw=JSON.stringify(batch)){
 if(!batch||batch.schema_version!=='pa-brief-batch-v1'||batch.mode!=='PA_ONLY'||batch.trading_enabled!==false)throw Error('NOT_A_PA_BRIEF_BATCH');
 if(SECRET_PATTERNS.some(r=>r.test(raw)))throw Error('SECRET_PATTERN_IN_PAYLOAD');
 const walk=(v,path)=>{if(Array.isArray(v))v.forEach((x,i)=>walk(x,path+'['+i+']'));else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(FORBIDDEN.has(norm(k)))throw Error('FORBIDDEN_KEY '+path+'.'+k);walk(x,path+'.'+k);}};
 walk(batch,'$');
 if(!Array.isArray(batch.symbols)||batch.symbols.length!==SYMBOLS.length||!SYMBOLS.every(s=>batch.symbols.includes(s)))throw Error('INCOMPLETE_SYMBOL_SET');
 for(const s of batch.symbols){
  const b=batch.briefs?.[s];if(!b)throw Error('MISSING_BRIEF '+s);
  if(b.trading_enabled!==false)throw Error('TRADING_ENABLED '+s);
  if(Buffer.byteLength(JSON.stringify(b))>PER_ASSET_MAX_BYTES)throw Error('ASSET_TOO_LARGE '+s);
 }
}

/** Files to write. latest.json = the latest attempt as served (errors stay visible); <SYMBOL>.json only for symbols that succeeded. */
export function filesFor(batch,publishedAt,requestedAt=publishedAt){
 const files={'brief/latest.json':batch};
 for(const s of batch.symbols)if(batch.results?.[s]?.snapshot_sha256)files[`brief/${s}.json`]={published_at:publishedAt,requested_at:requestedAt,source:batch.links?.self??null,brief:batch.briefs[s]};
 files['brief/status.json']={published_at:publishedAt,requested_at:requestedAt,ok:true,status:batch.status,generated_at:batch.generated_at,results:batch.results,grid:batch.grid,engine:batch.engine};
 return files;
}

export function checkHourlyBatch(batch){
 checkBatch(batch);
 for(const s of SYMBOLS){
  const b=batch.briefs[s],result=batch.results?.[s];
  if(!result)throw Error('MISSING_RESULT '+s);
  if(result.http_status!==200||!result.snapshot_sha256)continue;
  if(!Object.hasOwn(b,'h1_execution'))throw Error('H1_MISSING '+s);
  const h=b.h1_execution;
  if(!b.observations_available){if(h!==null)throw Error('H1_WITHHELD '+s);continue;}
  if(!h||h.as_of!==b.as_of||!['PARTIAL','STALE','UNAVAILABLE'].includes(h.status))throw Error('H1_STATUS '+s);
  if(h.status!=='PARTIAL')continue;
  if(h.symbol!==s||h.price_side!==b.price_side||h.timeframe!=='H1'||!Array.isArray(h.last_closed_candles)||
   !h.last_closed_candles.length||h.last_closed_candles.length>12||h.last_closed_candles.at(-1).closed_at!==h.last_closed_at||
   !Array.isArray(h.fractals)||!Array.isArray(h.fvg)||!h.new_fvg_count||!Object.hasOwn(h,'approach')||
   !Array.isArray(h.idm_in_h4?.items)||!Object.hasOwn(h,'h4_range'))throw Error('H1_FIELDS '+s);
  if(h.last_closed_candles.some(c=>Date.parse(c.closed_at)-Date.parse(c.time)!==3600000||c.closed_at>b.as_of))throw Error('H1_TIME '+s);
  const {snapshot_sha256,...facts}=h;
  if(createHash('sha256').update(JSON.stringify(facts)).digest('hex')!==snapshot_sha256)throw Error('H1_HASH '+s);
 }
}
async function main(){
 const out=process.argv[2]??'.',base=(process.env.CAPITALIVE_BASE??'https://capitalive.vercel.app').replace(/\/$/,''),latest=process.env.BRIEF_LATEST??'12';
 const url=`${base}/api/brief?symbols=${SYMBOLS.join(',')}&latest=${latest}&include_h1=1`,requestedAt=new Date().toISOString();
 await mkdir(join(out,'brief'),{recursive:true});
 let files;
 try{
  const res=await fetch(url,{headers:{accept:'application/json','user-agent':'capitalive-brief-publisher'}});
  const raw=await res.text(),batch=JSON.parse(raw);
  checkBatch(batch,raw);
  checkHourlyBatch(batch);
  // published_at is taken after the response, so it is never earlier than the batch generated_at.
  files=filesFor(batch,new Date().toISOString(),requestedAt);
  const status=files['brief/status.json'];
  status.h1_by_symbol=Object.fromEntries(SYMBOLS.map(s=>[s,batch.briefs[s]?.h1_execution?.status??batch.results[s]?.status??'UNAVAILABLE']));
  status.ok=SYMBOLS.every(s=>batch.results[s]?.http_status===200&&batch.briefs[s]?.observations_available&&status.h1_by_symbol[s]==='PARTIAL');
  if(!status.ok)process.exitCode=1;
 }catch(error){
  // Never replace an error with an older success: record the failed attempt; earlier files keep their own timestamps.
  files={'brief/status.json':{published_at:new Date().toISOString(),requested_at:requestedAt,ok:false,error:String(error?.message??error).slice(0,300),source:url}};
  process.exitCode=1;
 }
 for(const [path,value] of Object.entries(files))await writeFile(join(out,path),JSON.stringify(value,null,1)+'\n');
 console.log(JSON.stringify({url,files:Object.keys(files),ok:!process.exitCode}));
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/').split('/').pop()))main().catch(e=>{console.error(e);process.exitCode=1;});
