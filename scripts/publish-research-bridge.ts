// Node 24 strips TypeScript types. No npm install, broker credentials or engine code required.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ACTIVE_RESEARCH_SYMBOLS} from '../lib/active-research-markets.ts';
import {deliveryHealth} from '../lib/research-bridge/freshness.ts';
import {MAX_REPORT_BYTES,CONTRACT_REVISION,validateReport,BridgeFailure,diagnostic,classifyFailure,type BridgeDiagnostic} from '../lib/research-bridge/contract.ts';
export const TARGET_REPOSITORY='Yilin1207/capitalive-research-bridge';
const symbols=ACTIVE_RESEARCH_SYMBOLS;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
export function transportError(symbol:string,now:string,code='TRANSPORT_ERROR',failure?:BridgeDiagnostic){
  return {schema_version:'pa-engine-v6',mode:'PA_ONLY',symbol,status:'ERROR',generated_at:now,as_of:null,expires_at:now,error:code,
    source:null,quote:null,data_quality:'UNVERIFIED',freshness:null,frames:{},evidence:[],market_structure:{},dealing_ranges:[],lifecycle_events:[],cross_timeframe_interactions:[],omitted:{evidence:0},warnings:[code],coverage:null,trading_enabled:false,...(failure?{diagnostic:failure}:{})};
}
const media=(response:Response):BridgeDiagnostic['media_type']=>response.headers.get('content-type')?.includes('application/json')?'json':response.headers.get('content-type')?.includes('text/html')?'html':'other';
export async function boundedJson(response:Response,max=MAX_REPORT_BYTES,onBytes:(size:number)=>void=()=>{}){
  if(media(response)!=='json'){await response.body?.cancel();throw new BridgeFailure(diagnostic('http','CONTENT_TYPE'));}
  const declared=Number(response.headers.get('content-length'));
  if(declared>max){await response.body?.cancel();onBytes(declared);throw new BridgeFailure(diagnostic('size','REPORT_TOO_LARGE'));}
  const reader=response.body?.getReader();if(!reader)throw new BridgeFailure(diagnostic('http','CONTENT_TYPE'));const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;onBytes(size);if(size>max)throw new BridgeFailure(diagnostic('size','REPORT_TOO_LARGE'));chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new BridgeFailure(diagnostic('schema','INVALID_JSON'));}
}
export async function collectReports(baseUrl:string,bypass:string,fetcher:typeof fetch=fetch,clock=()=>Date.now(),secrets:string[]=[],emit:(row:{symbol:string}&BridgeDiagnostic)=>void=()=>{}){
  if(!/^https:\/\/capitalive-[a-z0-9]+-yilin1207s-projects\.vercel\.app$/.test(baseUrl)||!bypass)throw Error('INVALID_BRIDGE_CONFIGURATION');
  const reports:Record<string,ReturnType<typeof transportError>>={};
  for(const symbol of symbols){
    let status:number|null=null,bytes:number|null=null,contentType:BridgeDiagnostic['media_type']=null,phase:'http'|'schema'='http';
    try{
      let response=await fetcher(`${baseUrl}/api/desk-report?symbol=${symbol}&side=bid&refresh=1`,{method:'POST',headers:{'x-vercel-protection-bypass':bypass},redirect:'manual',signal:AbortSignal.timeout(90_000)});
      if(response.status===429){await response.body?.cancel();await new Promise(r=>setTimeout(r,Math.min(60_000,Math.max(1000,Number(response.headers.get('retry-after')??30)*1000))));response=await fetcher(`${baseUrl}/api/desk-report?symbol=${symbol}&side=bid&refresh=1`,{method:'POST',headers:{'x-vercel-protection-bypass':bypass},redirect:'manual',signal:AbortSignal.timeout(90_000)});}
      status=response.status;contentType=media(response);
      if(![200,429,503].includes(status)){await response.body?.cancel();throw new BridgeFailure(diagnostic('http',status>=300&&status<400?'HTTP_REDIRECT':'HTTP_STATUS'));}
      const revision=response.headers.get('x-desk-contract');
      // The V5 source and publisher must migrate together; old evidence is not reinterpreted.
      if(revision&&revision!==CONTRACT_REVISION){await response.body?.cancel();throw new BridgeFailure(diagnostic('schema','CONTRACT_REVISION_MISMATCH'));}
      const body=await boundedJson(response,MAX_REPORT_BYTES,size=>{bytes=size;});phase='schema';validateReport(body,symbol,clock(),[bypass,...secrets]);
      if(status!==200&&body.status!=='ERROR')throw new BridgeFailure(diagnostic('http','HTTP_STATUS'));
      reports[symbol]=body;
      if(body.status==='ERROR'){
        const d:BridgeDiagnostic=body.diagnostic??diagnostic(body.error==='REPORT_TOO_LARGE'?'size':'provider',body.error==='REPORT_TOO_LARGE'?'REPORT_TOO_LARGE':'UPSTREAM_UNAVAILABLE');
        emit({symbol,...d,http_status:status,response_bytes:bytes,media_type:contentType});
      }
    }catch(error){
      const d={...classifyFailure(error,phase),http_status:status,response_bytes:bytes,media_type:contentType};
      const code=d.stage==='schema'?'SCHEMA_ERROR':d.stage==='size'?'REPORT_TOO_LARGE':d.stage==='expiry'?'EXPIRED_REPORT':d.code==='NETWORK_ERROR'||d.code==='TIMEOUT'?'TRANSPORT_ERROR':'HTTP_ERROR';
      reports[symbol]=transportError(symbol,new Date(clock()).toISOString(),code,d);emit({symbol,...d});
    }
  }
  return reports;
}

export async function publishReports(token:string,reports:Record<string,unknown>,fetcher:typeof fetch=fetch,now=Date.now(),branch='main'){
  if(!token||Object.keys(reports).sort().join(',')!==[...symbols].sort().join(','))throw Error('INVALID_PUBLICATION');
  if(branch!=='main'&&!/^verification\/v5-[a-z0-9-]+$/.test(branch))throw Error('INVALID_PUBLICATION');
  async function api(path:string,method='GET',body?:unknown){
    const response=await fetcher(`https://api.github.com/repos/${TARGET_REPOSITORY}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new BridgeFailure(diagnostic('publish','GITHUB_HTTP_ERROR',{http_status:response.status}));return response.json();
  }
  const repository=await api('');
  if(repository.private!==true||repository.full_name!==TARGET_REPOSITORY||repository.fork||repository.default_branch!=='main')throw Error('PRIVATE_REPOSITORY_REQUIRED');
  const rows=[];const tree=[];
  for(const symbol of symbols){
    const report={...(reports[symbol] as Record<string,unknown>),published_at:new Date(now).toISOString()};validateReport(report,symbol,now,[token]);const content=JSON.stringify(report)+'\n';
    if(Buffer.byteLength(content)>MAX_REPORT_BYTES)throw Error('REPORT_TOO_LARGE');
    const r=report as unknown as {status:string;as_of:string|null;generated_at:string;expires_at:string};
    const path=`reports/latest/${symbol}.json`;rows.push({symbol,path,status:r.status,as_of:r.as_of,generated_at:r.generated_at,expires_at:r.expires_at,bytes:Buffer.byteLength(content),sha256:sha(content)});
    tree.push({path,mode:'100644',type:'blob',content});
  }
  const manifest={schema_version:'desk-report-manifest-v2',contract_revision:CONTRACT_REVISION,generated_at:new Date(now).toISOString(),published_at:new Date(now).toISOString(),publication_branch:branch,
    publisher_commit:/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??'')?process.env.GITHUB_SHA:null,
    timestamp_semantics:'published_at_is_commit_preparation_time; verify_ref_and_commit_readback',reports:rows,privacy:'PRIVATE_REPOSITORY_ONLY',no_raw_ohlc:true,trading_enabled:false};
  tree.push({path:'reports/latest/manifest.json',mode:'100644',type:'blob',content:JSON.stringify(manifest,null,2)+'\n'});
  const ref=await api(`/git/ref/heads/${branch}`),parent=await api(`/git/commits/${ref.object.sha}`);
  const currentTree=await api(`/git/trees/${parent.tree.sha}?recursive=1`);
  if(currentTree.truncated||!Array.isArray(currentTree.tree))throw Error('INVALID_PUBLICATION');
  const oldEu50=currentTree.tree?.find((entry:{path:string;type:string;sha:string})=>entry.path==='reports/latest/EU50.json'&&entry.type==='blob');
  if(oldEu50){
    // Preserve the exact old blob outside latest before removing its active path.
    tree.push({path:`reports/archive/EU50/${oldEu50.sha}.json`,mode:'100644',type:'blob',sha:oldEu50.sha});
    tree.push({path:'reports/latest/EU50.json',mode:'100644',type:'blob',sha:null});
  }
  const newTree=await api('/git/trees','POST',{base_tree:parent.tree.sha,tree});
  const commit=await api('/git/commits','POST',{message:'Refresh compact research reports',tree:newTree.sha,parents:[ref.object.sha],author:{name:'Capitalive Research Bridge',email:'41898282+github-actions[bot]@users.noreply.github.com'}});
  // Recheck immediately before the atomic ref update. Never force through a concurrent change.
  if((await api('')).private!==true)throw Error('PRIVATE_REPOSITORY_REQUIRED');
  await api(`/git/refs/heads/${branch}`,'PATCH',{sha:commit.sha,force:false});
  return {commit:commit.sha,manifest};
}

/** Read all four files pinned to the published commit, never mix latest refs. */
export async function verifyPublication(token:string,commit:string,fetcher:typeof fetch=fetch,clock=()=>Date.now()){
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('INVALID_PUBLICATION');
  async function file(path:string){
    const response=await fetcher(`https://api.github.com/repos/${TARGET_REPOSITORY}/contents/${path}?ref=${commit}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new BridgeFailure(diagnostic('publish','GITHUB_HTTP_ERROR',{http_status:response.status}));
    const data=await response.json();if(data.encoding!=='base64'||typeof data.content!=='string')throw Error('INVALID_PUBLICATION');
    return Buffer.from(data.content,'base64');
  }
  const manifest=JSON.parse((await file('reports/latest/manifest.json')).toString());
  if(manifest.schema_version!=='desk-report-manifest-v2'||manifest.reports?.map((r:{symbol:string})=>r.symbol).sort().join(',')!==[...symbols].sort().join(','))throw Error('INVALID_PUBLICATION');
  const results=[];
  for(const row of manifest.reports){
    if(row.path!==`reports/latest/${row.symbol}.json`)throw Error('INVALID_PUBLICATION');
    const bytes=await file(row.path),report=JSON.parse(bytes.toString());validateReport(report,row.symbol,undefined,[token]);
    if(bytes.length!==row.bytes||sha(bytes.toString())!==row.sha256||report.generated_at!==row.generated_at||report.as_of!==row.as_of||report.expires_at!==row.expires_at||report.status!==row.status||report.published_at!==manifest.published_at)throw Error('INVALID_PUBLICATION');
    const readAt=clock(),expired=Date.parse(report.expires_at)<=readAt;
    const quoteAge=report.quote?.provider_timestamp?(readAt-Date.parse(report.quote.provider_timestamp))/1000:null;
    results.push({symbol:row.symbol,bytes:bytes.length,sha256:row.sha256,status:report.status,read_status:expired&&report.status!=='ERROR'?'STALE':report.status,expired_at_read:expired,
      delivery:deliveryHealth(report.generated_at,readAt),provider_age_seconds_at_read:quoteAge,provider_timestamp:report.quote?.provider_timestamp??null,last_closed_h4:(Array.isArray(report.frames)?report.frames.find((f:{timeframe:string})=>f.timeframe==='H4')?.last_closed_at:report.frames?.H4?.last_closed_at)??null,engine_commit:report.source?.engine_commit??null});
  }
  return {commit,readback_at:new Date(clock()).toISOString(),published_at:manifest.published_at,reports:results};
}

async function main(){
  if(process.env.GITHUB_REPOSITORY!==TARGET_REPOSITORY)throw Error('WRONG_WORKFLOW_REPOSITORY');
  const token=process.env.GITHUB_TOKEN??'',base=process.env.BRIDGE_BASE_URL??'',bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET??'';
  const requestedAt=new Date().toISOString();
  // Monitoring is separate from refresh. Failure to read old metadata cannot make
  // an old report become the fallback result of a failed provider request.
  try{
    const prior=await fetch(`https://api.github.com/repos/${TARGET_REPOSITORY}/contents/reports/latest/manifest.json?ref=${process.env.BRIDGE_PUBLISH_BRANCH??'main'}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20_000)});
    if(!prior.ok)throw Error('MONITOR_UNAVAILABLE');
    const wrapper=await prior.json(),manifest=JSON.parse(Buffer.from(wrapper.content,'base64').toString());
    console.log(JSON.stringify({event:'bridge_delivery_health',requested_at:requestedAt,trigger:process.env.GITHUB_EVENT_NAME==='schedule'?'SCHEDULE':'ON_DEMAND',...deliveryHealth(manifest.generated_at,Date.now()),scheduler_or_delivery_delay_seconds:Math.max(0,(Date.now()-Date.parse(manifest.generated_at))/1000-3600)}));
  }catch{console.warn(JSON.stringify({event:'bridge_delivery_health',code:'PREVIOUS_PUBLICATION_UNAVAILABLE',requested_at:requestedAt}));}
  const reports=await collectReports(base,bypass,fetch,()=>Date.now(),[token],row=>console.warn(JSON.stringify({event:'bridge_failure',...row})));
  const result=await publishReports(token,reports,fetch,Date.now(),process.env.BRIDGE_PUBLISH_BRANCH??'main');
  const readback=await verifyPublication(token,result.commit);
  console.log(JSON.stringify({event:'bridge_readback',...readback}));
  console.log(JSON.stringify({commit:result.commit,reports:result.manifest.reports.map(r=>({symbol:r.symbol,status:r.status,bytes:r.bytes}))}));
  // Publication of ERROR is intentional: an old successful file must never masquerade as current.
  if(result.manifest.reports.some(r=>r.status==='ERROR')||readback.reports.some(r=>r.expired_at_read))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(error=>{console.error(JSON.stringify({event:'bridge_failure',...classifyFailure(error,'publish')}));process.exitCode=1;});
