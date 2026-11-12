import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createAuditSnapshot,readAuditSnapshot} from '../lib/audit-snapshots';
import {marketAudit} from '../lib/market-audit';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('oversized unicode snapshot reassembles byte-for-byte after newer snapshot; bound parameters and explicit expiry',async()=>{
  const body={schema_version:'2.1',zones:Array.from({length:15000},(_,id)=>({id,evidence:'Доказательства – 测试 '.repeat(15)}))};
  const url=new URL('https://local/api/market-audit?symbol=NAS100&side=ask&view=snapshot');const now=Date.now();
  const m=createAuditSnapshot(body,url,now);assert.ok(m.bytes>4_250_000);
  assert.throws(()=>createAuditSnapshot(body,new URL(url.href+'&symbol=EURUSD'),now),/unambiguous/);
  createAuditSnapshot({...body,additional_zone:1},url,now+1);
  const chunks:Buffer[]=[];let next:string|null=m.first_page;
  while(next){const r:Response=readAuditSnapshot(new URL(next,'https://local'),now+2)!;assert.equal(r.status,200);const p=await r.json();
    const bytes=Buffer.from(p.data,'base64');assert.equal(digest(bytes),p.chunk_sha256);assert.equal(p.snapshot_id,m.snapshot_id);assert.equal(p.offset_bytes,Buffer.concat(chunks).length);chunks.push(bytes);next=p.next;}
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,m.bytes);assert.equal(digest(bytes),m.sha256);assert.deepEqual(JSON.parse(bytes.toString()),body);
  assert.equal(digest(Buffer.concat([Buffer.from(JSON.stringify({path:m.source_path,parameters:m.parameters})+'\n'),bytes])),m.snapshot_id);
  const wrong=new URL(m.first_page,'https://local');wrong.searchParams.set('side','bid');assert.throws(()=>readAuditSnapshot(wrong,now+3),/exact parameters/);
  const page=new URL(m.first_page,'https://local');page.searchParams.set('page','999999');assert.throws(()=>readAuditSnapshot(page,now+3),/outside snapshot/);
  assert.throws(()=>readAuditSnapshot(new URL(m.first_page,'https://local'),now+600001),/Exact snapshot unavailable/);
});
test('too-large full HTTP response offers complete snapshot; priority still succeeds and subsequent pages never refetch',async()=>{
  const input=JSON.parse(readFileSync('tests/fixtures/capital-NAS100-h4.json','utf8')) as CandleResponse;
  const quote=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')).quote as MarketQuote;
  const deps={getCandles:async(_s:string,tf:Timeframe)=>({...input,timeframe:tf}),getAnalysisQuote:async()=>({...quote,cache_hit:false,evaluated_at:input.fetched_at})};
  const response=await marketAudit(new Request('https://local/api/market-audit?symbol=NAS100'),deps);
  assert.equal(response.status,503);const body=await response.json();assert.ok(body.pagination.bytes>4_250_000);
  assert.equal((await marketAudit(new Request('https://local/api/market-audit?symbol=NAS100&view=priority'),deps)).status,200);
  const noFetch={getCandles:async()=>{throw new Error('Must not refetch')},getAnalysisQuote:async()=>{throw new Error('Must not refetch')}};
  const page=await marketAudit(new Request(new URL(body.pagination.first_page,'https://local')),noFetch);assert.equal(page.status,200);
  assert.equal((await page.json()).snapshot_id,body.pagination.snapshot_id);
  assert.equal((await marketAudit(new Request('https://local/api/market-audit?view=snapshot&page=1'),noFetch)).status,400);
  assert.equal((await marketAudit(new Request(`https://local/api/market-audit?view=snapshot&snapshot_id=${'0'.repeat(64)}`),noFetch)).status,410);
});
