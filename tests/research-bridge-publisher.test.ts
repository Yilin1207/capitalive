import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectReports,publishReports,verifyPublication,transportError,boundedJson,TARGET_REPOSITORY} from '../scripts/publish-research-bridge.ts';
import {MAX_REPORT_BYTES,CONTRACT_REVISION,validateReport,type BridgeDiagnostic} from '../lib/research-bridge/contract.ts';
import {syntheticDeskReport,syntheticContextReport} from './fixtures/desk-report-synthetic.ts';
const now=Date.parse('2026-11-15T14:00:00Z'),iso=new Date(now).toISOString();
const reports=()=>Object.fromEntries(['EURUSD','NAS100','JP225'].map(s=>[s,transportError(s,iso)]));

test('V5.1 portable publisher accepts context and rejects false trend or mismatched inspection snapshot',async()=>{
 const report=syntheticContextReport();validateReport(report);
 const future=structuredClone(report);future.research_context.observed_price_behaviour[0].trend_confirmed=true;assert.throws(()=>validateReport(future));
 const mismatch=structuredClone(report);mismatch.research_context.full_inspection.snapshot_sha256='1'.repeat(64);assert.throws(()=>validateReport(mismatch),/CONTEXT_SNAPSHOT_MISMATCH/);
 const output=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','test-bypass',async(url)=>Response.json(syntheticContextReport(new URL(String(url)).searchParams.get('symbol')!),{headers:{'x-desk-contract':CONTRACT_REVISION}}),()=>now);
 for(const [symbol,r]of Object.entries(output)){validateReport(r,symbol,now);assert.equal(r.status,'PARTIAL');}
});

test('V5 rejects missing clocks, fake freshness, extended expiry and unsupported rule outputs',()=>{
 const r=syntheticDeskReport();validateReport(r);
 const missing=structuredClone(r);delete (missing as Partial<typeof r>).freshness;assert.throws(()=>validateReport(missing),/MISSING_FRESHNESS/);
 const stale=structuredClone(r);stale.quote.provider_timestamp='2026-11-15T08:36:00.000Z';stale.quote.provider_age_seconds=19440;assert.throws(()=>validateReport(stale),/FALSE_FRESHNESS/);
 const expiry=structuredClone(r);expiry.expires_at='2026-11-16T00:00:00.000Z';assert.throws(()=>validateReport(expiry),/INVALID_EXPIRY/);
 const future=structuredClone(r);future.published_at='2026-11-15T13:59:00.000Z';assert.throws(()=>validateReport(future),/INVALID_REPORT_TIME/);
 const unsupported=structuredClone(r);unsupported.evidence.e0.kind='BOS';assert.throws(()=>validateReport(unsupported),/UNSUPPORTED_AUTHOR_RULE/);
});

test('V4 publisher accepts technical reports and rejects decision/snapshot contradictions',async()=>{
 const report=Object.assign(syntheticDeskReport(),{technical_only:true,details:{path:'/api/intelligence',snapshot_sha256:'0'.repeat(64)}});report.scenario.action='NOT_EVALUATED';
 validateReport(report);report.scenario.action='WAIT';assert.throws(()=>validateReport(report),/TECHNICAL_RESPONSIBILITY/);report.scenario.action='NOT_EVALUATED';
 report.details.snapshot_sha256='1'.repeat(64);assert.throws(()=>validateReport(report),/SNAPSHOT_HASH_MISMATCH/);report.details.snapshot_sha256='0'.repeat(64);
 const output=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','test-bypass',async(url)=>{
  const symbol=new URL(String(url)).searchParams.get('symbol')!;
  return Response.json({...report,symbol,evidence:Object.fromEntries(Object.entries(report.evidence).map(([key,e])=>[key,{...e,id:e.id.replace('EURUSD',symbol)}]))},{headers:{'x-desk-contract':CONTRACT_REVISION}});
 },()=>now);
 assert.ok(Object.values(output).every(r=>r.status==='PARTIAL'));
});

test('V5 migration rejects old sources before publishing incompatible evidence',async()=>{
 const fetcher=async(url:unknown)=>{
  const symbol=new URL(String(url)).searchParams.get('symbol')!;
  const legacy=symbol==='JP225'?{...transportError(symbol,iso,'UPSTREAM_UNAVAILABLE'),diagnostic:{stage:'provider',code:'CAPITAL_INVALID_RESPONSE',http_status:503,response_bytes:null,media_type:'json',contract_revision:'desk-report-v1.1'}}:syntheticDeskReport(symbol);
  return Response.json(legacy,{status:symbol==='JP225'?503:200,headers:{'x-desk-contract':'desk-report-v1.1'}});
 };
 const diagnostics:BridgeDiagnostic[]=[];
 const output=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','test-bypass',fetcher as typeof fetch,()=>now,[],d=>diagnostics.push(d));
 assert.ok(Object.values(output).every(r=>r.status==='ERROR'));
 assert.equal(diagnostics[0].stage,'schema');assert.equal(diagnostics[0].code,'CONTRACT_REVISION_MISMATCH');assert.equal(diagnostics[0].contract_revision,CONTRACT_REVISION);
});
test('Publisher replaces inaccessible/HTML/oversize upstream results with independent sanitized ERROR reports',async()=>{
  const fetcher=async(url:unknown)=>String(url).includes('EURUSD')?new Response('private-password-html',{status:302,headers:{'content-type':'text/html'}}):String(url).includes('NAS100')?Response.json({padding:'x'.repeat(MAX_REPORT_BYTES)}):Response.json(transportError('JP225',iso,'UPSTREAM_UNAVAILABLE'),{status:503});
  const result=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','private-bypass-canary',fetcher as typeof fetch,()=>now);
  assert.deepEqual(Object.keys(result),['EURUSD','NAS100','JP225']);assert.ok(Object.values(result).every(r=>r.status==='ERROR'));assert.ok(!JSON.stringify(result).includes('private-password'));
  await assert.rejects(()=>collectReports('https://evil.test','secret',fetcher as typeof fetch),/CONFIGURATION/);
  await assert.rejects(()=>boundedJson(new Response('x'.repeat(MAX_REPORT_BYTES+1),{headers:{'content-type':'application/json'}})),/REPORT_TOO_LARGE/);
});
test('Publisher accepts range_candidate through the exact portable contract without promoting it',async()=>{
  const fetcher=async(url:unknown)=>Response.json(syntheticDeskReport(new URL(String(url)).searchParams.get('symbol')!),{headers:{'x-desk-contract':CONTRACT_REVISION}});
  const output=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','test-bypass',fetcher as typeof fetch,()=>now);
  for(const [symbol,r]of Object.entries(output)){validateReport(r,symbol,now);assert.equal(r.status,'PARTIAL');const actual=r as unknown as ReturnType<typeof syntheticDeskReport>;assert.equal(actual.frames[3].range_candidate?.review_required,true);assert.equal(actual.frames[3].dealing_range,null);assert.equal(actual.scenario.confirmed_narrative,null);}
});
test('Failures distinguish HTTP, schema, size, expiry, provider and network; never log upstream strings',async()=>{
  const expired=syntheticDeskReport();expired.expires_at=iso;
  const invalid=syntheticDeskReport();invalid.frames[3].range_candidate!.high='e1';
  const cases:[()=>Promise<Response>,string,string][]=[
    [async()=>new Response('private-secret-canary',{status:302}),'http','HTTP_REDIRECT'],
    [async()=>new Response('private-secret-canary',{status:500}),'http','HTTP_STATUS'],
    [async()=>new Response('private-secret-canary',{headers:{'content-type':'text/html'}}),'http','CONTENT_TYPE'],
    [async()=>new Response('{private-secret-canary',{headers:{'content-type':'application/json'}}),'schema','INVALID_JSON'],
    [async()=>Response.json(invalid),'schema','CONTRACT_REJECTED'],
    [async()=>Response.json(syntheticDeskReport(),{headers:{'x-desk-contract':'unknown-secret-version'}}),'schema','CONTRACT_REVISION_MISMATCH'],
    [async()=>Response.json({padding:'x'.repeat(MAX_REPORT_BYTES)}),'size','REPORT_TOO_LARGE'],
    [async()=>Response.json(expired),'expiry','REPORT_EXPIRED'],
    [async()=>Response.json(transportError('EURUSD',iso,'UPSTREAM_UNAVAILABLE'),{status:503}),'provider','UPSTREAM_UNAVAILABLE'],
    [async()=>{throw Error('private-secret-canary');},'http','NETWORK_ERROR'],
  ];
  for(const [fetcher,stage,code]of cases){const log:BridgeDiagnostic[]=[];const out=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','private-secret-canary',fetcher as typeof fetch,()=>now,[],row=>log.push(row));
    assert.equal(out.EURUSD.status,'ERROR');assert.equal(log[0].stage,stage);assert.equal(log[0].code,code);assert.ok(!JSON.stringify({log,out}).includes('private-secret-canary'));validateReport(out.EURUSD,'EURUSD',now);
  }
});
test('Publish API refusal has a safe publish-stage diagnostic',async()=>{
  await assert.rejects(()=>publishReports('token-canary',reports(),(async()=>new Response('private-account-body',{status:403})) as typeof fetch,now),(e:unknown)=>{
    const failure=e as {diagnostic:BridgeDiagnostic};assert.equal(failure.diagnostic.stage,'publish');assert.equal(failure.diagnostic.http_status,403);assert.ok(!JSON.stringify(e).includes('private-account'));return true;
  });
});
test('Publisher refuses a public repository before uploading any report',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return Response.json({private:false,full_name:TARGET_REPOSITORY,default_branch:'main'});};
  await assert.rejects(()=>publishReports('token-canary',reports(),fetcher as typeof fetch,now),/PRIVATE_REPOSITORY_REQUIRED/);assert.equal(calls,1);
});
for(const archiveEu50 of [false,true])test(`Publisher commits exactly three active reports atomically; existing EU50=${archiveEu50}`,async()=>{
  const writes:{path:string;body:Record<string,unknown>}[]=[];
  const fetcher=async(url:unknown,init?:RequestInit)=>{
    const path=String(url).split(TARGET_REPOSITORY)[1];const body=init?.body?JSON.parse(String(init.body)):{};if(init?.method!=='GET')writes.push({path,body});
    if(path==='')return Response.json({private:true,full_name:TARGET_REPOSITORY,default_branch:'main',fork:false});
    if(path==='/git/ref/heads/main')return Response.json({object:{sha:'parent'}});
    if(path==='/git/commits/parent')return Response.json({tree:{sha:'base-tree'}});
    if(path==='/git/trees/base-tree?recursive=1')return Response.json({tree:archiveEu50?[{path:'reports/latest/EU50.json',type:'blob',sha:'a'.repeat(40)}]:[]});
    if(path==='/git/trees')return Response.json({sha:'new-tree'});
    if(path==='/git/commits')return Response.json({sha:'new-commit'});
    if(path==='/git/refs/heads/main')return Response.json({object:{sha:'new-commit'}});
    throw Error('Unexpected endpoint');
  };
  const result=await publishReports('token-canary',reports(),fetcher as typeof fetch,now);
  assert.equal(result.commit,'new-commit');const tree=writes.find(w=>w.path==='/git/trees')!.body.tree as {path:string;content?:string;sha?:string|null}[];
  assert.deepEqual(tree.filter(t=>t.content!==undefined).map(t=>t.path),['reports/latest/EURUSD.json','reports/latest/NAS100.json','reports/latest/JP225.json','reports/latest/manifest.json']);
  assert.deepEqual(result.manifest.reports.map(r=>r.symbol),['EURUSD','NAS100','JP225']);
  for(const row of result.manifest.reports){const content=tree.find(t=>t.path===row.path)!.content!;assert.equal(row.bytes,Buffer.byteLength(content));assert.equal(row.sha256,createHash('sha256').update(content).digest('hex'));}
  if(archiveEu50){assert.equal(tree.find(t=>t.path==='reports/latest/EU50.json')!.sha,null);assert.equal(tree.find(t=>t.path===`reports/archive/EU50/${'a'.repeat(40)}.json`)!.sha,'a'.repeat(40));}
  assert.ok(!JSON.stringify(tree).includes('token-canary'));assert.deepEqual(writes.at(-1),{path:'/git/refs/heads/main',body:{sha:'new-commit',force:false}});
});
test('Publisher validates all three reports before the first content upload',async()=>{
  const input=reports();Object.assign(input.NAS100,{accounts:['private-data']});const writes:string[]=[];
  const fetcher=async(url:unknown,init?:RequestInit)=>{if(init?.method!=='GET')writes.push(String(url));return Response.json({private:true,full_name:TARGET_REPOSITORY,default_branch:'main'});};
  await assert.rejects(()=>publishReports('token-canary',input,fetcher as typeof fetch,now),/contract/);assert.equal(writes.length,0);
});

test('V5 readback pins all files to one commit, detects tampering and exposes expiry',async()=>{
 const commit='a'.repeat(40),files:Record<string,Buffer>={},rows=[];
 for(const symbol of ['EURUSD','NAS100','JP225']){
  const r={...syntheticDeskReport(symbol),published_at:iso},path=`reports/latest/${symbol}.json`,bytes=Buffer.from(JSON.stringify(r)+'\n');files[path]=bytes;
  rows.push({symbol,path,status:r.status,generated_at:r.generated_at,as_of:r.as_of,expires_at:r.expires_at,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 files['reports/latest/manifest.json']=Buffer.from(JSON.stringify({schema_version:'desk-report-manifest-v2',contract_revision:CONTRACT_REVISION,published_at:iso,reports:rows}));
 const fetcher=async(url:unknown)=>{const u=new URL(String(url));assert.equal(u.searchParams.get('ref'),commit);const bytes=files[u.pathname.split('/contents/')[1]];return Response.json({encoding:'base64',content:bytes.toString('base64')});};
 const current=await verifyPublication('token-canary',commit,fetcher as typeof fetch,()=>now);assert.equal(current.reports.length,3);assert.ok(current.reports.every(r=>!r.expired_at_read));
 const old=await verifyPublication('token-canary',commit,fetcher as typeof fetch,()=>now+4*3600_000);assert.ok(old.reports.every(r=>r.expired_at_read&&r.read_status==='STALE'));
 files['reports/latest/NAS100.json']=Buffer.concat([files['reports/latest/NAS100.json'],Buffer.from(' ')]);
 await assert.rejects(()=>verifyPublication('token-canary',commit,fetcher as typeof fetch,()=>now),/INVALID_PUBLICATION/);
});
