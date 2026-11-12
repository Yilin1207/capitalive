import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const output=process.env.CAPITALIVE_REVIEW_OUTPUT??'verification/capitalive-v2-1/rc2';mkdirSync(output,{recursive:true});
const env={...process.env,CAPITALIVE_RC_TEST:'1',CAPITALIVE_RC_FRESHNESS_SIMULATION:'1',CAPITAL_API_KEY:'synthetic-rc-key',CAPITAL_IDENTIFIER:'synthetic-rc-identifier',CAPITAL_API_PASSWORD:'synthetic-rc-password',CAPITAL_API_BASE_URL:'https://demo-api-capital.backend-capital.com',NEXT_TELEMETRY_DISABLED:'1'};
delete env.NODE_OPTIONS;delete env.VERCEL;delete env.DATABASE_URL;
const instances=[];let proxy;
async function start(port){
  const child=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/rc-upstream-preload.mjs')).href,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  const instance={child,port,log:''};instances.push(instance);child.stdout.on('data',b=>instance.log+=b);child.stderr.on('data',b=>instance.log+=b);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Local Next process exited');try{await fetch(`http://127.0.0.1:${port}`);return instance;}catch{await new Promise(r=>setTimeout(r,100));}}
  throw new Error('Server startup timeout');
}
async function stop(instance){if(instance.child.exitCode===null){instance.child.kill();await new Promise(r=>{instance.child.once('exit',r);setTimeout(r,5000);});}}
async function json(port,path,status){const r=await fetch(`http://127.0.0.1:${port}${path}`);assert.equal(r.status,status,path);return r.json();}
try{
  const a=await start(3103);await start(3104);
  const full=await json(3103,'/api/htf-zones?symbol=NAS100',200);
  const expectedContacts=full.catalog.zones.filter(z=>z.type==='SNR'&&z.significant&&z.status==='tested'&&z.data_reliability.status!=='UNVERIFIED'&&z.break_status!=='unknown_after_gap'&&z.lower<=full.reference_price&&z.upper>=full.reference_price).map(z=>z.id).sort();
  assert.equal(full.contact.eligible,true);assert.ok(expectedContacts.length>0);assert.deepEqual(full.contact.contact_hits.map(z=>z.id).sort(),expectedContacts);
  const path='/api/htf-zones?symbol=NAS100&view=snapshot';
  const manifest=(await json(3103,path,200)).pagination;
  assert.equal(manifest.availability.cross_instance_guarantee,false);
  const first=await json(3103,manifest.first_page,200);assert.equal(first.snapshot_id,manifest.snapshot_id);
  const other=await json(3104,manifest.first_page,410);assert.equal(other.error.code,'SNAPSHOT_EXPIRED_OR_UNAVAILABLE');
  const priority=await json(3104,'/api/htf-zones?symbol=NAS100&view=priority',200);assert.equal(priority.ok,true);
  // Simulate load balancing: manifest + first page reach A, the second page reaches B.
  let requests=0;
  proxy=createServer(async(req,res)=>{try{requests++;const port=requests<=2?3103:3104;
    const response=await fetch(`http://127.0.0.1:${port}${req.url}`);res.writeHead(response.status,{'content-type':'application/json'});res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(502);res.end('{}');}});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const proxyPort=proxy.address().port;
  const temp=mkdtempSync(join(tmpdir(),'capitalive-snapshot-client-')),destination=join(temp,'audit.json'),sentinel='previous verified document';writeFileSync(destination,sentinel);
  const client=spawn(process.execPath,['scripts/download-audit-snapshot.mjs',`http://127.0.0.1:${proxyPort}${path}`,destination],{stdio:['ignore','pipe','pipe'],windowsHide:true});let clientLog='';client.stdout.on('data',b=>clientLog+=b);client.stderr.on('data',b=>clientLog+=b);
  const exit=await new Promise(r=>client.on('exit',r));writeFileSync(`${output}/snapshot-client-410.txt`,clientLog);
  assert.equal(exit,3);assert.match(clientLog,/SNAPSHOT_UNAVAILABLE/);assert.match(clientLog,/view=priority/);assert.equal(readFileSync(destination,'utf8'),sentinel);assert.equal(requests,3);
  await stop(a);await start(3103);
  const restarted=await json(3103,manifest.first_page,410);assert.equal(restarted.error.code,'SNAPSHOT_EXPIRED_OR_UNAVAILABLE');
  await json(3103,'/api/htf-zones?symbol=NAS100&view=priority',200);
  const result={checked_at:new Date().toISOString(),runtime:'Actual local Next production build; two OS processes then cold process restart; recorded upstream fixture transport with controlled synthetic quote freshness',
    contact:{simulation_only:true,expected_from_full_catalog:expectedContacts.length,returned_hits:full.contact.hit_count,ids:expectedContacts,not_a_current_live_contact:true},
    target_vercel_runtime_verified:false,mode:manifest.availability,same_instance:200,other_instance:410,restarted_instance:410,
    priority_on_other_and_restarted_instance:200,client:{partial_pages_received:1,second_page_status:410,exit_code:exit,output_preserved:true,priority_fallback_reported:true},
    conclusion:'Process-local snapshots demonstrably lack cross-instance persistence. Best-effort transport only, not distributed availability. No deployment performed.'};
  writeFileSync(`${output}/multiprocess-contracts.json`,JSON.stringify(result,null,2));writeFileSync(`${output}/snapshot-client-410.txt`,clientLog);console.log(JSON.stringify(result));
}finally{if(proxy)await new Promise(r=>proxy.close(r));for(const instance of instances)await stop(instance);writeFileSync(`${output}/multiprocess-server.txt`,instances.map((s,i)=>`instance ${i+1} port ${s.port}\n${s.log}`).join('\n'));}
