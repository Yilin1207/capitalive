import { createHash } from 'node:crypto';
import { HistoryError } from './candles';
import { historyJson } from './history-http';

const TTL=10*60*1000, CHUNK_BYTES=512*1024, MAX_BYTES=64*1024*1024, MAX_TOTAL=96*1024*1024;
type Snapshot={bytes:Buffer;id:string;created:string;expires:number;parameters:Record<string,string>;path:string};
const root=globalThis as typeof globalThis & {capitaliveAuditSnapshots?:Map<string,Snapshot>};
const snapshots=root.capitaliveAuditSnapshots??=new Map<string,Snapshot>();
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function parameters(url:URL){
  for(const key of url.searchParams.keys())if(url.searchParams.getAll(key).length!==1)throw new HistoryError('DUPLICATE_PARAMETER','Snapshot parameters must be unambiguous',400);
  return Object.fromEntries([...url.searchParams].filter(([k])=>!['view','snapshot_id','page'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
}
function clean(now:number){for(const [id,s] of snapshots)if(s.expires<=now)snapshots.delete(id);}
function pageUrl(s:Snapshot,page:number){const p=new URLSearchParams({...s.parameters,view:'snapshot',snapshot_id:s.id,page:String(page)});return `${s.path}?${p}`;}
function manifest(s:Snapshot){return {snapshot_id:s.id,snapshot_at:s.created,expires_at:new Date(s.expires).toISOString(),parameters:s.parameters,source_path:s.path,
  document:'market-audit full JSON, including requested candles and complete HTF evidence',encoding:'base64_chunks_of_utf8_json',
  sha256:hash(s.bytes),snapshot_id_scheme:'sha256(JSON.stringify({path:source_path,parameters}) + newline + UTF8 document bytes)',bytes:s.bytes.length,page_count:Math.ceil(s.bytes.length/CHUNK_BYTES),chunk_bytes:CHUNK_BYTES,first_page:pageUrl(s,0),
  storage:'bounded_process_memory; immutable while available; expiry/eviction/restart/other instance returns 410, never a newer snapshot',
  availability:{mode:'best_effort_process_local',cross_instance_guarantee:false,
    on_410:'Discard in-memory partial pages; keep existing output untouched. Use view=priority, or explicitly start a new full snapshot. Never merge snapshot IDs.'},
  reconstruction:'Fetch every page in order, base64 decode then concatenate bytes; verify bytes and SHA-256 before UTF-8 decoding/JSON.parse. No records omitted.'};}
export function createAuditSnapshot(body:unknown,url:URL,now=Date.now()){
  const bytes=Buffer.from(JSON.stringify(body));
  if(bytes.length>MAX_BYTES)throw new HistoryError('SNAPSHOT_CAPACITY_EXCEEDED','Snapshot exceeds 64 MiB; request a narrower analysis. No truncated snapshot created.',503);
  clean(now);
  const id=hash(Buffer.concat([Buffer.from(JSON.stringify({path:url.pathname,parameters:parameters(url)})+'\n'),bytes]));
  let s=snapshots.get(id);
  if(!s){
    let total=[...snapshots.values()].reduce((n,s)=>n+s.bytes.length,0);
    while(total+bytes.length>MAX_TOTAL && snapshots.size){const [oldest,old]=snapshots.entries().next().value!;snapshots.delete(oldest);total-=old.bytes.length;}
    s={bytes,id,created:new Date(now).toISOString(),expires:now+TTL,parameters:parameters(url),path:url.pathname};snapshots.set(id,s);
  }
  return manifest(s);
}
export function readAuditSnapshot(url:URL,now=Date.now()){
  const id=url.searchParams.get('snapshot_id');
  if(!id)return null;
  if(url.searchParams.get('view')!=='snapshot'||!/^[a-f0-9]{64}$/.test(id))throw new HistoryError('INVALID_SNAPSHOT_REQUEST','Use view=snapshot and a SHA-256 snapshot_id',400);
  clean(now);const s=snapshots.get(id);
  if(!s)throw new HistoryError('SNAPSHOT_EXPIRED_OR_UNAVAILABLE','Exact snapshot unavailable in this process; create a new snapshot and restart pagination. Never mix pages.',410);
  if(s.path!==url.pathname||JSON.stringify(parameters(url))!==JSON.stringify(s.parameters))throw new HistoryError('SNAPSHOT_PARAMETERS_MISMATCH','Use the exact parameters and route from first_page',409);
  const raw=url.searchParams.get('page');
  if(raw===null)return historyJson({ok:true,schema_version:'2.1',pagination:manifest(s)});
  if(!/^(0|[1-9]\d*)$/.test(raw))throw new HistoryError('INVALID_PAGE','page must be a zero-based integer',400);
  const page=Number(raw),count=Math.ceil(s.bytes.length/CHUNK_BYTES);
  if(!Number.isSafeInteger(page)||page>=count)throw new HistoryError('INVALID_PAGE','page outside snapshot',400);
  const chunk=s.bytes.subarray(page*CHUNK_BYTES,(page+1)*CHUNK_BYTES);
  return historyJson({ok:true,schema_version:'2.1',snapshot_id:s.id,snapshot_at:s.created,parameters:s.parameters,page,page_count:count,
    offset_bytes:page*CHUNK_BYTES,chunk_bytes:chunk.length,chunk_sha256:hash(chunk),encoding:'base64',data:chunk.toString('base64'),next:page+1<count?pageUrl(s,page+1):null});
}
