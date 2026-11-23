// Publishes Capitalive batch briefs as static JSON for clients that can only reach raw.githubusercontent.com.
// Runs in the public snapshot repository (GitHub Actions). Market data only: no keys, account or balance.
// Usage: node publish.mjs [outDir]   env: CAPITALIVE_BASE (default https://capitalive.vercel.app), BRIEF_LATEST (default 12)
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
 for(const s of batch.symbols??[]){
  const b=batch.briefs?.[s];if(!b)throw Error('MISSING_BRIEF '+s);
  if(b.trading_enabled!==false)throw Error('TRADING_ENABLED '+s);
  if(Buffer.byteLength(JSON.stringify(b))>PER_ASSET_MAX_BYTES)throw Error('ASSET_TOO_LARGE '+s);
 }
}

/** Files to write. latest.json = the latest attempt as served (errors stay visible); <SYMBOL>.json only for symbols that succeeded. */
export function filesFor(batch,fetchedAt){
 const files={'brief/latest.json':batch};
 for(const s of batch.symbols)if(batch.results?.[s]?.snapshot_sha256)files[`brief/${s}.json`]={published_at:fetchedAt,source:batch.links?.self??null,brief:batch.briefs[s]};
 files['brief/status.json']={published_at:fetchedAt,ok:true,status:batch.status,generated_at:batch.generated_at,results:batch.results,grid:batch.grid,engine:batch.engine};
 return files;
}

async function main(){
 const out=process.argv[2]??'.',base=(process.env.CAPITALIVE_BASE??'https://capitalive.vercel.app').replace(/\/$/,''),latest=process.env.BRIEF_LATEST??'12';
 const url=`${base}/api/brief?symbols=${SYMBOLS.join(',')}&latest=${latest}`,fetchedAt=new Date().toISOString();
 await mkdir(join(out,'brief'),{recursive:true});
 let files;
 try{
  const res=await fetch(url,{headers:{accept:'application/json','user-agent':'capitalive-brief-publisher'}});
  const raw=await res.text(),batch=JSON.parse(raw);
  checkBatch(batch,raw);
  files=filesFor(batch,fetchedAt);
 }catch(error){
  // Never replace an error with an older success: record the failed attempt; earlier files keep their own timestamps.
  files={'brief/status.json':{published_at:fetchedAt,ok:false,error:String(error?.message??error).slice(0,300),source:url}};
  process.exitCode=1;
 }
 for(const [path,value] of Object.entries(files))await writeFile(join(out,path),JSON.stringify(value,null,1)+'\n');
 console.log(JSON.stringify({url,files:Object.keys(files),ok:!process.exitCode}));
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/').split('/').pop()))main().catch(e=>{console.error(e);process.exitCode=1;});
