import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReports,publishReports,transportError,boundedJson,TARGET_REPOSITORY} from '../scripts/publish-research-bridge.ts';
import {MAX_REPORT_BYTES,CONTRACT_REVISION,validateReport,type BridgeDiagnostic} from '../lib/research-bridge/contract.ts';
import {syntheticDeskReport} from './fixtures/desk-report-synthetic.ts';
const now=Date.parse('2026-11-15T14:00:00Z'),iso=new Date(now).toISOString();
const reports=()=>Object.fromEntries(['EURUSD','NAS100','EU50'].map(s=>[s,transportError(s,iso)]));

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

test('V4 publisher-first rollout accepts v1.1 payloads and preserves legacy provider failures',async()=>{
 const fetcher=async(url:unknown)=>{
  const symbol=new URL(String(url)).searchParams.get('symbol')!;
  const legacy=symbol==='EU50'?{...transportError(symbol,iso,'UPSTREAM_UNAVAILABLE'),diagnostic:{stage:'provider',code:'CAPITAL_INVALID_RESPONSE',http_status:503,response_bytes:null,media_type:'json',contract_revision:'desk-report-v1.1'}}:syntheticDeskReport(symbol);
  return Response.json(legacy,{status:symbol==='EU50'?503:200,headers:{'x-desk-contract':'desk-report-v1.1'}});
 };
 const diagnostics:BridgeDiagnostic[]=[];
 const output=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','test-bypass',fetcher as typeof fetch,()=>now,[],d=>diagnostics.push(d));
 assert.equal(output.EURUSD.status,'PARTIAL');assert.equal(output.NAS100.status,'PARTIAL');assert.equal(output.EU50.status,'ERROR');
 assert.equal(diagnostics[0].stage,'provider');assert.equal(diagnostics[0].code,'CAPITAL_INVALID_RESPONSE');assert.equal(diagnostics[0].contract_revision,'desk-report-v1.1');
});
test('Publisher replaces inaccessible/HTML/oversize upstream results with independent sanitized ERROR reports',async()=>{
  const fetcher=async(url:unknown)=>String(url).includes('EURUSD')?new Response('private-password-html',{status:302,headers:{'content-type':'text/html'}}):String(url).includes('NAS100')?Response.json({padding:'x'.repeat(MAX_REPORT_BYTES)}):Response.json(transportError('EU50',iso,'UPSTREAM_UNAVAILABLE'),{status:503});
  const result=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','private-bypass-canary',fetcher as typeof fetch,()=>now);
  assert.deepEqual(Object.keys(result),['EURUSD','NAS100','EU50']);assert.ok(Object.values(result).every(r=>r.status==='ERROR'));assert.ok(!JSON.stringify(result).includes('private-password'));
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
test('Publisher commits exactly three allowlisted JSON files and manifest in one non-forced ref update',async()=>{
  const writes:{path:string;body:Record<string,unknown>}[]=[];
  const fetcher=async(url:unknown,init?:RequestInit)=>{
    const path=String(url).split(TARGET_REPOSITORY)[1];const body=init?.body?JSON.parse(String(init.body)):{};if(init?.method!=='GET')writes.push({path,body});
    if(path==='')return Response.json({private:true,full_name:TARGET_REPOSITORY,default_branch:'main',fork:false});
    if(path==='/git/ref/heads/main')return Response.json({object:{sha:'parent'}});
    if(path==='/git/commits/parent')return Response.json({tree:{sha:'base-tree'}});
    if(path==='/git/trees')return Response.json({sha:'new-tree'});
    if(path==='/git/commits')return Response.json({sha:'new-commit'});
    if(path==='/git/refs/heads/main')return Response.json({object:{sha:'new-commit'}});
    throw Error('Unexpected endpoint');
  };
  const result=await publishReports('token-canary',reports(),fetcher as typeof fetch,now);
  assert.equal(result.commit,'new-commit');const tree=writes.find(w=>w.path==='/git/trees')!.body.tree as {path:string;content:string}[];
  assert.deepEqual(tree.map(t=>t.path),['reports/latest/EURUSD.json','reports/latest/NAS100.json','reports/latest/EU50.json','reports/latest/manifest.json']);
  assert.ok(!JSON.stringify(tree).includes('token-canary'));assert.deepEqual(writes.at(-1),{path:'/git/refs/heads/main',body:{sha:'new-commit',force:false}});
});
test('Publisher validates all three reports before the first content upload',async()=>{
  const input=reports();Object.assign(input.NAS100,{accounts:['private-data']});const writes:string[]=[];
  const fetcher=async(url:unknown,init?:RequestInit)=>{if(init?.method!=='GET')writes.push(String(url));return Response.json({private:true,full_name:TARGET_REPOSITORY,default_branch:'main'});};
  await assert.rejects(()=>publishReports('token-canary',input,fetcher as typeof fetch,now),/contract/);assert.equal(writes.length,0);
});
