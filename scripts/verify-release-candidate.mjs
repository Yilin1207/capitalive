import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),npx=join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
const release=process.argv.includes('--release'),rc2=release||process.argv.includes('--rc2');
const root=`verification/capitalive-v2-1/${release?'release':rc2?'rc2':'rc'}`,attempt=`${root}/attempt-${new Date().toISOString().replaceAll(':','-')}`;
mkdirSync(attempt,{recursive:true});const env={...process.env,CI:'true'};delete env.FORCE_COLOR;delete env.NO_COLOR;
env.CAPITALIVE_REVIEW_OUTPUT=root;
const checks=[['npm test',[npm,'test'],'tests'],['npm run lint',[npm,'run','lint'],'lint'],['npx tsc --noEmit',[npx,'tsc','--noEmit'],'tsc'],['npm run build',[npm,'run','build'],'build'],['npm run test:ui',[npm,'run','test:ui'],'ui'],
  ['node scripts/verify-rc-http.mjs',['scripts/verify-rc-http.mjs'],'http'],['recorded six-side contracts',['--conditions=react-server','--import','tsx','scripts/audit-release-candidate.ts'],'recorded']];
if(rc2)checks.push(['two-process Next snapshot availability',['scripts/verify-snapshot-processes.mjs'],'multiprocess'],
  ['contact coverage regression evidence',['--conditions=react-server','--import','tsx','scripts/audit-contact-coverage.ts'],'contact']);
const results=[];
for(const [command,args,name] of checks){const start=Date.now(),r=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:20*1024*1024});
  const output=(r.stdout??'')+(r.stderr??'');writeFileSync(`${attempt}/${name}.txt`,output);writeFileSync(`${root}/${name}.txt`,output);
  results.push({command,exit_code:r.status,seconds:(Date.now()-start)/1000,log:`${name}.txt`});
  writeFileSync(`${root}/checks.json`,JSON.stringify({checked_at:new Date().toISOString(),checks:results},null,2));console.log(JSON.stringify(results.at(-1)));
  if(r.status!==0){console.log(output.slice(-6500));process.exit(r.status??1);}
}
