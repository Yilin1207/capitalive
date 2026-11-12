import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const output='verification/capitalive-v2-1/rc';mkdirSync(output,{recursive:true});
const origin='http://127.0.0.1:3102';
const env={...process.env,CAPITALIVE_RC_TEST:'1',CAPITAL_API_KEY:'synthetic-rc-key',CAPITAL_IDENTIFIER:'synthetic-rc-identifier',CAPITAL_API_PASSWORD:'synthetic-rc-password',CAPITAL_API_BASE_URL:'https://demo-api-capital.backend-capital.com',NEXT_TELEMETRY_DISABLED:'1'};
delete env.NODE_OPTIONS;delete env.VERCEL;delete env.DATABASE_URL;
const server=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/rc-upstream-preload.mjs')).href,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3102'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const results=[];
async function get(path,status=200){const response=await fetch(origin+path);const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,status,`${path}: ${bytes.toString().slice(0,250)}`);results.push({path,status:response.status,content_type:response.headers.get('content-type'),bytes:bytes.length});return {bytes,json:()=>JSON.parse(bytes.toString())};}
try{
  let ready=false;
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error('Local Next exited');try{await fetch(origin);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready,'Local server startup');
  for(const asset of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask']){
    const body=(await get(`/api/market-audit?symbol=${asset}&side=${side}&view=priority`)).json();
    assert.equal(body.schema_version,'2.1');assert.equal(body.ok,true);assert.ok(body.htf.risk.long.obstacle_policy);
    assert.equal(body.htf.contact.alerts_emitted,false);
    for(const direction of ['long','short'])for(const o of body.htf.risk[direction].obstacles_before_tp)assert.equal(o.directional_role.replace('provisional_',''),direction==='long'?'resistance':'support');
  }
  const full=(await get('/api/market-audit?symbol=EURUSD&include_candles=1')).json();assert.ok(full.htf.catalog.total>0);
  assert.equal(full.structure.H4.candles[0].close.bid,JSON.parse(readFileSync('tests/fixtures/htf-EURUSD.json','utf8')).data.H4.candles[0].close.bid);
  assert.ok((await get('/api/structure?symbol=EURUSD')).json().H4.length);
  assert.ok((await get('/api/quotes')).json());
  const htf=(await get('/api/htf-zones?symbol=NAS100&view=priority')).json();assert.equal(htf.ok,true);
  for(const query of ['symbol=EURUSD&timeframe=H4','symbol=NAS100&timeframe=W1&snr_w1=1&snr_events=1']){
    const p=await get(`/api/chart?${query}`);assert.equal(results.at(-1).content_type,'image/png');const meta=await sharp(p.bytes).metadata();assert.equal(meta.width,1400);assert.ok([1000,1280].includes(meta.height));
    writeFileSync(`${output}/${query.startsWith('symbol=EURUSD')?'http-EURUSD-H4':'http-NAS100-W1'}.png`,p.bytes);
  }
  const manifest=(await get('/api/htf-zones?symbol=NAS100&side=ask&include_candles=1&view=snapshot')).json().pagination;
  let next=manifest.first_page;const chunks=[];
  while(next){const p=(await get(next)).json();assert.equal(p.snapshot_id,manifest.snapshot_id);const b=Buffer.from(p.data,'base64');assert.equal(createHash('sha256').update(b).digest('hex'),p.chunk_sha256);chunks.push(b);next=p.next;}
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,manifest.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);assert.ok(JSON.parse(bytes).htf.catalog.total);
  await get('/api/chart?symbol=EURUSD&timeframe=BAD',400);
  await get('/api/market-audit?symbol=EURUSD&view=invalid',400);
  await get(`/api/market-audit?view=snapshot&snapshot_id=${'0'.repeat(64)}`,410);
  writeFileSync(`${output}/http-contracts.json`,JSON.stringify({checked_at:new Date().toISOString(),server:'Actual local Next production build, loopback HTTP',upstream:'Recorded real candle/quote fixture transport; monthly aggregation has only available recorded D1 history. No live provider/production verification.',snapshot:{id:manifest.snapshot_id,bytes:manifest.bytes,pages:manifest.page_count,sha256:manifest.sha256,verified:true},results},null,2));
  console.log(JSON.stringify({ok:true,http_checks:results.length,snapshot_pages:manifest.page_count,png_decoded:2}));
}finally{server.kill();await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(resolve,5000);}});writeFileSync(`${output}/http-server.txt`,log);}
