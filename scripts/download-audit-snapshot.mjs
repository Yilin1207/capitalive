import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [url,output]=process.argv.slice(2);
if(!url||!output)throw new Error('Usage: node scripts/download-audit-snapshot.mjs <view=snapshot URL> <output.json>');
const initial=await fetch(url);const payload=await initial.json();const m=payload.pagination;
if(!m)throw new Error(`No snapshot manifest: HTTP ${initial.status}`);
const chunks=[];let next=m.first_page,index=0,total=0,unavailable=false;
while(next){const response=await fetch(new URL(next,url));
  if(response.status===410){const priority=new URL(url);for(const key of ['snapshot_id','page'])priority.searchParams.delete(key);priority.searchParams.set('view','priority');
    await response.arrayBuffer();chunks.length=0;unavailable=true;process.exitCode=3;
    console.error(`SNAPSHOT_UNAVAILABLE (410): discarded partial pages; output file unchanged. Best-effort process-local storage cannot guarantee cross-instance access. Use ${priority.href} or explicitly start a new snapshot; never mix IDs.`);break;}
  if(response.status===429){const delay=Number(response.headers.get('retry-after')??60);await response.arrayBuffer();if(Date.now()+delay*1000>=Date.parse(m.expires_at))throw new Error('Rate limit would exceed snapshot expiry; create a new snapshot later');await new Promise(r=>setTimeout(r,Math.max(1,delay)*1000));continue;}
  if(!response.ok)throw new Error(`Page unavailable: HTTP ${response.status}; restart from a new snapshot, never mix snapshots`);
  const p=await response.json(),b=Buffer.from(p.data,'base64');
  if(p.snapshot_id!==m.snapshot_id||p.page!==index++||p.offset_bytes!==total||p.chunk_bytes!==b.length||createHash('sha256').update(b).digest('hex')!==p.chunk_sha256)throw new Error('Page integrity mismatch');
  chunks.push(b);total+=b.length;next=p.next;
}
if(!unavailable){
const bytes=Buffer.concat(chunks);if(index!==m.page_count||bytes.length!==m.bytes||createHash('sha256').update(bytes).digest('hex')!==m.sha256)throw new Error('Document integrity mismatch');
const id=createHash('sha256').update(JSON.stringify({path:m.source_path,parameters:m.parameters})+'\n').update(bytes).digest('hex');if(id!==m.snapshot_id)throw new Error('Snapshot identity mismatch');
JSON.parse(bytes.toString());writeFileSync(output,bytes);console.log(JSON.stringify({snapshot_id:m.snapshot_id,bytes:bytes.length,sha256:m.sha256}));
}
