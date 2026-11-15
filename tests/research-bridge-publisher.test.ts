import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReports,publishReports,transportError,boundedJson,TARGET_REPOSITORY} from '../scripts/publish-research-bridge.ts';
import {MAX_REPORT_BYTES} from '../lib/research-bridge/contract.ts';
const now=Date.parse('2026-11-15T14:00:00Z'),iso=new Date(now).toISOString();
const reports=()=>Object.fromEntries(['EURUSD','NAS100','EU50'].map(s=>[s,transportError(s,iso)]));
test('Publisher replaces inaccessible/HTML/oversize upstream results with independent sanitized ERROR reports',async()=>{
  const fetcher=async(url:unknown)=>String(url).includes('EURUSD')?new Response('private-password-html',{status:302,headers:{'content-type':'text/html'}}):String(url).includes('NAS100')?Response.json({padding:'x'.repeat(MAX_REPORT_BYTES)}):Response.json(transportError('EU50',iso,'UPSTREAM_UNAVAILABLE'),{status:503});
  const result=await collectReports('https://capitalive-abc-yilin1207s-projects.vercel.app','private-bypass-canary',fetcher as typeof fetch,()=>now);
  assert.deepEqual(Object.keys(result),['EURUSD','NAS100','EU50']);assert.ok(Object.values(result).every(r=>r.status==='ERROR'));assert.ok(!JSON.stringify(result).includes('private-password'));
  await assert.rejects(()=>collectReports('https://evil.test','secret',fetcher as typeof fetch),/CONFIGURATION/);
  await assert.rejects(()=>boundedJson(new Response('x'.repeat(MAX_REPORT_BYTES+1),{headers:{'content-type':'application/json'}})),/UNTRUSTED_RESPONSE/);
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
