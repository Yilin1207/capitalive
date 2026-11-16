// Node 24 strips TypeScript types. No npm install, broker credentials or engine code required.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ACTIVE_RESEARCH_SYMBOLS} from '../lib/active-research-markets.ts';
import {MAX_REPORT_BYTES,CONTRACT_REVISION,validateReport,BridgeFailure,diagnostic,classifyFailure,type BridgeDiagnostic} from '../lib/research-bridge/contract.ts';
export const TARGET_REPOSITORY='Yilin1207/capitalive-research-bridge';
const symbols=ACTIVE_RESEARCH_SYMBOLS;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
export function transportError(symbol:string,now:string,code='TRANSPORT_ERROR',failure?:BridgeDiagnostic){
  return {schema_version:'desk-report-v1',symbol,status:'ERROR',generated_at:now,as_of:null,expires_at:now,error:code,
    source:null,quote:null,frames:[],scenario:null,evidence:{},rules:{},candle_windows:[],coverage:null,trading_enabled:false,...(failure?{diagnostic:failure}:{})};
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
      let response=await fetcher(`${baseUrl}/api/desk-report?symbol=${symbol}&side=bid`,{headers:{'x-vercel-protection-bypass':bypass},redirect:'manual',signal:AbortSignal.timeout(90_000)});
      if(response.status===429){await response.body?.cancel();await new Promise(r=>setTimeout(r,Math.min(60_000,Math.max(1000,Number(response.headers.get('retry-after')??30)*1000))));response=await fetcher(`${baseUrl}/api/desk-report?symbol=${symbol}&side=bid`,{headers:{'x-vercel-protection-bypass':bypass},redirect:'manual',signal:AbortSignal.timeout(90_000)});}
      status=response.status;contentType=media(response);
      if(![200,503].includes(status)){await response.body?.cancel();throw new BridgeFailure(diagnostic('http',status>=300&&status<400?'HTTP_REDIRECT':'HTTP_STATUS'));}
      const revision=response.headers.get('x-desk-contract');
      // v1.2 is an additive validator. Permit the previous pinned source during
      // a publisher-first rollout; every payload still passes the strict schema.
      if(revision&&revision!==CONTRACT_REVISION&&revision!=='desk-report-v1.1'){await response.body?.cancel();throw new BridgeFailure(diagnostic('schema','CONTRACT_REVISION_MISMATCH'));}
      const body=await boundedJson(response,MAX_REPORT_BYTES,size=>{bytes=size;});phase='schema';validateReport(body,symbol,clock(),[bypass,...secrets]);
      if(status===503&&body.status!=='ERROR')throw new BridgeFailure(diagnostic('http','HTTP_STATUS'));
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

export async function publishReports(token:string,reports:Record<string,unknown>,fetcher:typeof fetch=fetch,now=Date.now()){
  if(!token||Object.keys(reports).sort().join(',')!==[...symbols].sort().join(','))throw Error('INVALID_PUBLICATION');
  async function api(path:string,method='GET',body?:unknown){
    const response=await fetcher(`https://api.github.com/repos/${TARGET_REPOSITORY}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new BridgeFailure(diagnostic('publish','GITHUB_HTTP_ERROR',{http_status:response.status}));return response.json();
  }
  const repository=await api('');
  if(repository.private!==true||repository.full_name!==TARGET_REPOSITORY||repository.fork||repository.default_branch!=='main')throw Error('PRIVATE_REPOSITORY_REQUIRED');
  const rows=[];const tree=[];
  for(const symbol of symbols){
    const report=reports[symbol];validateReport(report,symbol,now,[token]);const content=JSON.stringify(report)+'\n';
    if(Buffer.byteLength(content)>MAX_REPORT_BYTES)throw Error('REPORT_TOO_LARGE');
    const r=report as {status:string;as_of:string|null;generated_at:string;expires_at:string};
    const path=`reports/latest/${symbol}.json`;rows.push({symbol,path,status:r.status,as_of:r.as_of,generated_at:r.generated_at,expires_at:r.expires_at,bytes:Buffer.byteLength(content),sha256:sha(content)});
    tree.push({path,mode:'100644',type:'blob',content});
  }
  const manifest={schema_version:'desk-report-manifest-v1',contract_revision:CONTRACT_REVISION,generated_at:new Date(now).toISOString(),reports:rows,privacy:'PRIVATE_REPOSITORY_ONLY',no_raw_ohlc:true,trading_enabled:false};
  tree.push({path:'reports/latest/manifest.json',mode:'100644',type:'blob',content:JSON.stringify(manifest,null,2)+'\n'});
  const ref=await api('/git/ref/heads/main'),parent=await api(`/git/commits/${ref.object.sha}`);
  const currentTree=await api(`/git/trees/${parent.tree.sha}?recursive=1`);
  if(currentTree.truncated)throw Error('INVALID_PUBLICATION');
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
  await api('/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});
  return {commit:commit.sha,manifest};
}

async function main(){
  if(process.env.GITHUB_REPOSITORY!==TARGET_REPOSITORY)throw Error('WRONG_WORKFLOW_REPOSITORY');
  const token=process.env.GITHUB_TOKEN??'',base=process.env.BRIDGE_BASE_URL??'',bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET??'';
  const reports=await collectReports(base,bypass,fetch,()=>Date.now(),[token],row=>console.warn(JSON.stringify({event:'bridge_failure',...row})));
  const result=await publishReports(token,reports);
  console.log(JSON.stringify({commit:result.commit,reports:result.manifest.reports.map(r=>({symbol:r.symbol,status:r.status,bytes:r.bytes}))}));
  // Publication of ERROR is intentional: an old successful file must never masquerade as current.
  if(result.manifest.reports.some(r=>r.status==='ERROR'))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(error=>{console.error(JSON.stringify({event:'bridge_failure',...classifyFailure(error,'publish')}));process.exitCode=1;});
