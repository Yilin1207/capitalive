// Explicit release operations; credentials stay in memory and are never printed or persisted.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const [action,...args]=process.argv.slice(2),repo='Yilin1207/capitalive';
let token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
if(!token){const r=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\nusername=Yilin1207\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
  token=(r.stdout??'').split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);}
if(!token)throw new Error('GitHub credential unavailable; authenticate via Git Credential Manager');
async function api(path,method='GET',body){const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok)throw new Error(`GitHub HTTP ${r.status}: ${result.message??'request failed'}`);return result;}
if(action==='status'){const p=await api('');console.log(JSON.stringify({repo:p.full_name,permissions:p.permissions,default_branch:p.default_branch}));}
else if(action==='create-pr'){
  const [branch,bodyFile]=args;const existing=await api(`/pulls?head=Yilin1207:${encodeURIComponent(branch)}&base=main&state=open`);
  const pr=existing[0]??await api('/pulls','POST',{title:'Release Capitalive 2.1: HTF SNR, structural risk and verified contact coverage',head:branch,base:'main',body:readFileSync(bodyFile,'utf8')});
  console.log(JSON.stringify({number:pr.number,url:pr.html_url,head:pr.head.sha,base:pr.base.sha}));
}else if(action==='checks'){
  const sha=args[0],checks=await api(`/commits/${sha}/check-runs`),statuses=await api(`/commits/${sha}/status`),runs=await api(`/actions/runs?head_sha=${sha}`);
  console.log(JSON.stringify({sha,checks:checks.check_runs.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion,url:c.html_url})),status:statuses.state,statuses:statuses.statuses.map(s=>({context:s.context,state:s.state,url:s.target_url})),runs:runs.workflow_runs.map(r=>({id:r.id,name:r.name,status:r.status,conclusion:r.conclusion,url:r.html_url}))}));
}else if(action==='review'){
  const pr=await api(`/pulls/${args[0]}`),files=[];
  for(let page=1;;page++){const batch=await api(`/pulls/${args[0]}/files?per_page=100&page=${page}`);files.push(...batch);if(batch.length<100)break;}
  console.log(JSON.stringify({number:pr.number,state:pr.state,mergeable:pr.mergeable,mergeable_state:pr.mergeable_state,head:pr.head.sha,base:pr.base.sha,changed_files:pr.changed_files,additions:pr.additions,deletions:pr.deletions,files:files.map(f=>({filename:f.filename,status:f.status,additions:f.additions,deletions:f.deletions}))}));
}else if(action==='merge'){
  const [number,sha]=args,pr=await api(`/pulls/${number}`);if(pr.head.sha!==sha)throw new Error('PR head changed; review and retest');
  const checks=await api(`/commits/${sha}/check-runs`),runs=await api(`/actions/runs?head_sha=${sha}`);
  if(!runs.workflow_runs.some(r=>r.name==='Release checks'&&r.conclusion==='success')||checks.check_runs.some(c=>c.status!=='completed'||!['success','neutral','skipped'].includes(c.conclusion)))throw new Error('Required release checks not complete/successful');
  console.log(JSON.stringify(await api(`/pulls/${number}/merge`,'PUT',{sha,merge_method:'merge'})));
}else throw new Error('Use status, create-pr <branch> <body-file>, checks <SHA>, review <PR>, or merge <PR> <tested-SHA>');
