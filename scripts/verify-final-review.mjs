import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {writeFileSync} from 'node:fs';
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const npx=join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
const env={...process.env,CI:'true'};delete env.FORCE_COLOR;delete env.NO_COLOR;
const checks=[['npm test',[npm,'test'],'final-tests.txt'],['npm run lint',[npm,'run','lint'],'final-lint.txt'],['npx tsc --noEmit',[npx,'tsc','--noEmit'],'final-tsc.txt'],['npm run build',[npm,'run','build'],'final-build.txt'],['npm run test:ui',[npm,'run','test:ui'],'final-ui.txt']];
const results=[];
for(const [command,args,filename] of checks){
  const started=Date.now(),r=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:20*1024*1024});
  const output=(r.stdout??'')+(r.stderr??'');writeFileSync(`verification/capitalive-v2-1/${filename}`,output);
  results.push({command,exit_code:r.status,seconds:(Date.now()-started)/1000,log:filename});
  writeFileSync('verification/capitalive-v2-1/final-checks.json',JSON.stringify({checked_at:new Date().toISOString(),checks:results},null,2));
  console.log(JSON.stringify(results.at(-1)));
  if(r.status!==0){console.log(output.slice(-7000));process.exit(r.status??1);}
}
