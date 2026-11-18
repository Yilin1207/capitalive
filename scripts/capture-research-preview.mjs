import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [origin,cli]=process.argv.slice(2),link=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(!/^https:\/\/capitalive-[a-z0-9]+-yilin1207s-projects\.vercel\.app$/.test(origin??'')||!cli)throw Error('Specify protected project Preview and CLI launcher');
const r=spawnSync(process.execPath,[cli,'api',`/v9/projects/${link.projectId}?teamId=${link.orgId}`],{encoding:'utf8',windowsHide:true});if(r.status)throw Error('Project read failed');const project=JSON.parse(r.stdout),bypass=Object.entries(project.protectionBypass??{}).find(([,v])=>v.scope==='automation-bypass');if(!bypass)throw Error('No existing authorized bypass');
console.log(JSON.stringify({bypass_created_at:bypass[1].createdAt}));
const output='verification/capitalive-v3/raw';mkdirSync(output,{recursive:true});const manifest=[];
async function get(name,query){const path='/api/research-source?'+new URLSearchParams(query);let response;
 for(let attempt=0;attempt<3;attempt++){response=await fetch(origin+path,{headers:{'x-vercel-protection-bypass':bypass[0]},signal:AbortSignal.timeout(60000)});if(response.status!==429)break;await response.arrayBuffer();await new Promise(r=>setTimeout(r,Math.min(60,Math.max(1,Number(response.headers.get('retry-after')??30)))*1000));}
 const raw=await response.text();if(!response.ok){console.log(JSON.stringify({name,status:response.status,error:raw.slice(0,160)}));manifest.push({file:name+'.json',url:origin+path,status:response.status,unavailable:true});}else{const j=JSON.parse(raw);if(j.ok!==true)throw Error('Invalid research source');writeFileSync(`${output}/${name}.json`,raw+'\n');manifest.push({file:name+'.json',url:origin+path,status:response.status,captured_at:j.captured_at,environment:j.environment,payload_sha256:j.payload_sha256,file_sha256:createHash('sha256').update(raw+'\n').digest('hex'),request:j.request});console.log(JSON.stringify({name,rows:j.payload.prices?.length,first:j.payload.prices?.[0]?.snapshotTimeUTC,last:j.payload.prices?.at(-1)?.snapshotTimeUTC}));}
 writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
}
const protocol=JSON.parse(readFileSync('knowledge/research/v3-protocol.json','utf8'));
for(const symbol of protocol.symbols){await get(`${symbol}-market`,{symbol,mode:'market'});for(const timeframe of ['D1','W1','H4'])await get(`${symbol}-${timeframe}`,{symbol,timeframe});
 for(const cutoff of protocol.requested_cutoffs_utc){const to=new Date(cutoff),from=new Date(to.getTime()-90*86400_000);await get(`${symbol}-H4-${cutoff.slice(0,10)}`,{symbol,timeframe:'H4',from:from.toISOString().replace('.000Z','Z'),to:to.toISOString().replace('.000Z','Z')});}
 // Historical daily pages cover complete calendar months for the research MN1 aggregate.
 for(const [from,to] of [['2020-01-01T00:00:00Z','2022-06-01T00:00:00Z'],['2022-06-01T00:00:00Z','2024-11-01T00:00:00Z'],['2024-11-01T00:00:00Z','2026-11-15T00:00:00Z']])await get(`${symbol}-D1-${from.slice(0,10)}`,{symbol,timeframe:'D1',from,to});
}
