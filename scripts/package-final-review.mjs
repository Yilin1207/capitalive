import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join,dirname,extname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const contactFix=process.argv.includes('--rc2'),release=contactFix||process.argv.includes('--rc');
const cwd=process.cwd(),checkpoint=contactFix?'fd09b847d56d1a424e3f9bf6fc71aa04584b4c77':release?'5516a6fd8c02ad28fd0f054cf9026c42adecb416':'a07395ee73d4ecfdc0445109a66d2e4e2ac3193a';
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
if(git(['rev-parse',contactFix?'checkpoint/capitalive-2-1-before-contact-fix':release?'checkpoint/capitalive-2-1-before-bugfix':'checkpoint/capitalive-2-1-before-final-review'])!==checkpoint)throw new Error('Wrong checkpoint');
const files=git(['ls-files','--cached','--others','--exclude-standard']).split('\n');
const rootFiles=new Set(['package.json','package-lock.json','tsconfig.json','next.config.ts','next-env.d.ts','playwright.config.ts','vercel.json',
  '.gitignore','.dockerignore','.vercelignore','Dockerfile.worker','railway.json','README.md','CAPITALIVE_2_1_FINAL_AUDIT_RU.md','REPRODUCE_HTF_REVIEW.md',
  'CAPITALIVE_2_1_BUGFIX_AUDIT_RU.md','REPRODUCE_RELEASE_CANDIDATE.md','CAPITALIVE_2_1_RC2_CONTACT_AUDIT_RU.md','REPRODUCE_RELEASE_CANDIDATE_2.md']);
const allowed=files.filter(p=>rootFiles.has(p)||/^(app|lib|tests|scripts|assets|deploy)\//.test(p)||p.startsWith('verification/capitalive-v2-1/'))
  .filter(p=>!/(^|\/)(?:\.env[^/]*|node_modules|\.git|\.vercel|\.next|data|test-results|playwright-report)(\/|$)/i.test(p))
  .filter(p=>!/(?:\.sqlite(?:-wal|-shm)?|\.tsbuildinfo|\.zip|(?:final-)?package-build\.json)$/i.test(p));
const knownSecrets=[];
const sensitiveNames=/(?:API_KEY|PASSWORD|TOKEN|SECRET|COOKIE|IDENTIFIER|DATABASE_URL)/i;
for(const name of ['.env','.env.local'])if(existsSync(name)){
  for(const line of readFileSync(name,'utf8').split(/\r?\n/)){
    const match=line.match(/^([A-Z_0-9]+)\s*=\s*(.*)$/);if(!match||!sensitiveNames.test(match[1]))continue;
    const value=match[2].trim().replace(/^['"]|['"]$/g,'');if(value.length>=8)knownSecrets.push(value);
  }
}
for(const [name,value] of Object.entries(process.env))if(sensitiveNames.test(name)&&value&&value.length>=8)knownSecrets.push(value);
const stage=mkdtempSync(join(tmpdir(),'capitalive-final-review-'));
const manifest=[],redactions=[];
const textExtensions=new Set(['.ts','.tsx','.json','.mjs','.js','.md','.txt','.ps1','.css','.html','.svg','.patch','.yml','.yaml','.service']);
function sanitize(text,path){
  let clean=text;
  for(const root of [cwd,cwd.replaceAll('\\','/'),cwd.replaceAll('\\','\\\\')])clean=clean.split(root).join('<WORKSPACE>');
  clean=clean.replace(/[A-Z]:[\\/]Users[\\/][^\s\\/"'<>]+/gi,'<USER_HOME>');
  if(clean!==text)redactions.push(path);
  if(knownSecrets.some(value=>clean.includes(value)))throw new Error(`Known private credential in ${path}; packaging stopped`);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(clean))throw new Error(`Credential pattern in ${path}`);
  if(/eyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(clean))throw new Error(`Encoded token pattern in ${path}`);
  if(/(?:https?:\/\/|postgres(?:ql)?:\/\/)[^\s/:'"]+:[^\s/'"]{8,}@/.test(clean)&&!path.startsWith('tests/'))throw new Error(`Credential URL in ${path}`);
  return clean;
}
function put(path,bytes){
  const destination=resolve(stage,path);if(!destination.startsWith(stage+sep)||path.includes('..'))throw new Error('Invalid archive path');
  mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes);
  manifest.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const path of allowed){
  let bytes=readFileSync(path);
  if(textExtensions.has(extname(path))||rootFiles.has(path)||path.endsWith('Dockerfile.worker')){
    const text=bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8').replace(/^\uFEFF/,'');
    bytes=Buffer.from(sanitize(text,path));
  }else if(!['.png','.ttf'].includes(extname(path)))throw new Error(`Unreviewed binary format ${path}`);
  put(path,bytes);
}
const diff=git(['diff',checkpoint,'--binary','--','.',':(exclude)verification']);
put('SOURCE_DIFF.patch',Buffer.from(sanitize(diff,'SOURCE_DIFF.patch')+'\n'));
put('CHANGED_FILES.txt',Buffer.from(git(['diff',checkpoint,'--name-status','--','.',':(exclude)verification'])+'\n'));
const security={scope:'allowlisted source/tests and requested verification directory; no private configuration or live logs',
  excluded:['.env*','.git','.vercel','.next','node_modules','databases','other verification folders','ZIP archives'],
  checks:['known private values from local environment compared in memory; values never exported','private-key/GitHub-token/credential-URL patterns','binary whitelist PNG/font only','personal local paths redacted'],
  credential_matches:0,personal_path_redactions:[...new Set(redactions)],synthetic_test_authentication_values:'retained as non-secret fixtures',
  limitation:'Pattern/value checks are not a formal proof against every possible secret encoding. Human review remains appropriate.'};
put('SECURITY_REVIEW.json',Buffer.from(JSON.stringify(security,null,2)));
writeFileSync(join(stage,'REVIEW_PACKAGE_MANIFEST.json'),JSON.stringify({checkpoint,source_head:git(['rev-parse','HEAD']),files:manifest},null,2));
const output={stage,archive:join(cwd,contactFix?'CAPITALIVE_2_1_RELEASE_CANDIDATE_2.zip':release?'CAPITALIVE_2_1_RELEASE_CANDIDATE.zip':'CAPITALIVE_2_1_FINAL_REVIEW.zip'),files:manifest.length+1,credential_matches:0,path_redactions:security.personal_path_redactions.length};
writeFileSync(contactFix?'verification/capitalive-v2-1/rc2/package-build.json':release?'verification/capitalive-v2-1/rc/package-build.json':'verification/capitalive-v2-1/final-package-build.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
