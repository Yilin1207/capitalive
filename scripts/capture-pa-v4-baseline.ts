/** Run with cwd at the OLD checkout and its tsx loader. Writes PRIVATE local
 * artifacts only. The caller records/verifies that checkout's exact commit. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const out=process.env.PA_V4_BASELINE_DIR;if(!out)throw Error('PA_V4_BASELINE_DIR must be an ignored local output directory');
const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(actual!==process.env.PA_V4_EXPECTED_BASELINE_COMMIT)throw Error('Baseline checkout does not match the explicitly pinned commit');
const {buildIntelligence}=await import(pathToFileURL(resolve('lib/knowledge/intelligence.ts')).href) as typeof import('../lib/knowledge/intelligence');
mkdirSync(out,{recursive:true});
for(const set of ['archive','control',...(process.env.PA_V4_INPUT_DIR?['current']:[])])for(const symbol of ['EURUSD','NAS100','EU50']){
 const input=set==='current'?`${process.env.PA_V4_INPUT_DIR}/input-${symbol}.json`:set==='control'?`tests/fixtures/edge-v2/${symbol}.json`:`tests/fixtures/htf-${symbol}.json`;
 const raw=readFileSync(input),f=JSON.parse(raw.toString());for(const side of ['bid','ask'] as const){const result=buildIntelligence(f.data,side,f.quote);
  writeFileSync(`${out}/${set}-${symbol}-${side}.json`,JSON.stringify({baseline_commit:actual,input_sha256:createHash('sha256').update(raw).digest('hex'),result}));
  console.log(JSON.stringify({set,symbol,side,baseline_commit:actual}));
 }
}
