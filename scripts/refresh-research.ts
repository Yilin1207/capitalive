// Operator recovery path: existing Git Credential Manager + Vercel CLI login.
// No scheduler dependency, credential files, new secrets, public URLs or token output.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {collectReports,publishReports,verifyPublication,TARGET_REPOSITORY} from './publish-research-bridge.ts';
import {classifyFailure} from '../lib/research-bridge/contract.ts';
async function main(){
 const args=process.argv.slice(2),option=(key:string)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
 const credential=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\nusername=Yilin1207\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
 const token=credential.stdout?.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);
 if(!token)throw Error('INVALID_BRIDGE_CONFIGURATION');
 async function github(path:string,method='GET',body?:unknown){const r=await fetch(`https://api.github.com/repos/${TARGET_REPOSITORY}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30_000)});if(!r.ok)throw Error('INVALID_PUBLICATION');return r.status===204?null:r.json();}
 if(args.includes('--dispatch')){await github('/actions/workflows/research-bridge.yml/dispatches','POST',{ref:'main'});console.log(JSON.stringify({status:'REQUESTED',note:'Execution and publication still require readback; not a success claim.'}));return;}
 const project=JSON.parse(readFileSync(option('--project')??'.vercel/project.json','utf8'));
 const cli=process.env.VERCEL_CLI_JS;
 if(!cli||!/^prj_[a-zA-Z0-9]+$/.test(project.projectId)||!/^team_[a-zA-Z0-9]+$/.test(project.orgId))throw Error('INVALID_BRIDGE_CONFIGURATION');
 const result=spawnSync(process.execPath,[cli,'api',`/v9/projects/${project.projectId}?teamId=${project.orgId}`],{encoding:'utf8',maxBuffer:2_000_000});
 if(result.status!==0)throw Error('INVALID_BRIDGE_CONFIGURATION');
 const info=JSON.parse(result.stdout),createdAt=Number(process.env.BRIDGE_BYPASS_CREATED_AT);
 const bypass=Object.entries(info.protectionBypass??{}).find(([,v])=>(v as {createdAt:number}).createdAt===createdAt)?.[0];
 if(!bypass)throw Error('INVALID_BRIDGE_CONFIGURATION');
 const base=option('--source')??(await github('/actions/variables/BRIDGE_BASE_URL')).value;
 const requestedAt=new Date().toISOString();
 const reports=await collectReports(base,bypass,fetch,()=>Date.now(),[token],d=>console.warn(JSON.stringify({event:'bridge_failure',...d})));
 const publication=await publishReports(token,reports,fetch,Date.now(),option('--branch')??'main');
 const readback=await verifyPublication(token,publication.commit);
 console.log(JSON.stringify({requested_at:requestedAt,...readback}));
 if(readback.reports.some(r=>r.status==='ERROR'||r.expired_at_read||r.delivery.status!=='FRESH'))process.exitCode=1;
}
void main().catch(e=>{console.error(JSON.stringify({event:'refresh_failed',...classifyFailure(e,'publish')}));process.exitCode=1;});
