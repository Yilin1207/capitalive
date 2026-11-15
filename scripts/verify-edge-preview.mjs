// Authenticated external Preview HTTP. Uses the existing automation secret in memory only.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const [origin,cli]=process.argv.slice(2);
if(!origin?.startsWith('https://capitalive-')||!origin.endsWith('.vercel.app')||!cli)throw Error('Specify Preview origin and installed Vercel CLI launcher');
const link=JSON.parse(readFileSync('.vercel/project.json','utf8'));
const auth=spawnSync(process.execPath,[cli,'api',`/v9/projects/${link.projectId}?teamId=${link.orgId}`],{encoding:'utf8',windowsHide:true});
if(auth.status)throw Error('Cannot read authorized project');
const project=JSON.parse(auth.stdout),bypass=Object.entries(project.protectionBypass??{}).find(([,v])=>v.scope==='automation-bypass');
if(!bypass)throw Error('Existing authorized automation bypass is unavailable; this script never creates one');
const output='verification/the-edge-v2/preview';mkdirSync(output,{recursive:true});const results=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
async function get(path,kind='json',status=200){
 const r=await fetch(origin+path,{headers:{'x-vercel-protection-bypass':bypass[0]},redirect:'manual'}),b=Buffer.from(await r.arrayBuffer());
 assert.equal(r.status,status,`${path}: HTTP ${r.status}: ${b.toString().slice(0,150)}`);
 const type=r.headers.get('content-type');assert.ok(type?.includes(kind==='png'?'image/png':'application/json'));
 const parsed=kind==='png'?await sharp(b).metadata():JSON.parse(b.toString());
 if(kind==='png'){assert.equal(parsed.format,'png');assert.equal(parsed.width,1400);await sharp(b).raw().toBuffer();writeFileSync(`${output}/chart.png`,b);}
 results.push({path,status:r.status,content_type:type,bytes:b.length,sha256:hash(b),...(kind==='png'?{width:parsed.width,height:parsed.height,pixels_decoded:true}:{} )});return parsed;
}
const unauth=await fetch(origin+'/api/intelligence?symbol=EURUSD',{redirect:'manual'});
const publicAccess={status:unauth.status,content_type:unauth.headers.get('content-type'),protected:unauth.status!==200};await unauth.arrayBuffer();
for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask']){
 const r=await get(`/api/intelligence?symbol=${symbol}&side=${side}`);assert.equal(r.schema_version,'edge-knowledge-2');assert.equal(r.verdict.action,'WAIT');assert.equal(r.narrative.B,null);
 writeFileSync(`${output}/${symbol}-${side}.json`,JSON.stringify(r)+'\n');
 if(symbol==='EURUSD'&&side==='bid'){
  const p=r.frames.find(f=>f.timeframe==='H4').findings.filter(f=>f.kind==='FRACTAL'&&f.variant===3);
  const high=p.find(h=>h.polarity==='high'&&p.some(l=>l.polarity==='low'&&l.segment===h.segment&&l.price<h.price));
  const low=p.find(l=>l.polarity==='low'&&l.segment===high?.segment&&l.price<high.price);assert.ok(high&&low);
  const selected=await get(`/api/intelligence?${new URLSearchParams({symbol,side,high_id:high.id,low_id:low.id})}`);
  const range=selected.frames.find(f=>f.timeframe==='H4').range;assert.equal(range.high_id,high.id);assert.equal(range.low_id,low.id);assert.equal(range.equilibrium,(high.price+low.price)/2);
  results.at(-1).range={high_id:high.id,low_id:low.id,lower:range.lower,upper:range.upper,equilibrium:range.equilibrium};
  const missing=await get('/api/intelligence?symbol=EURUSD&target_id=unknown');assert.equal(missing.target_selection.validated_target,null);assert.ok(missing.target_selection.blockers.includes('REQUESTED_TARGET_UNAVAILABLE'));
 }
 const a=await get(`/api/market-audit?symbol=${symbol}&side=${side}&view=priority`);assert.equal(a.schema_version,'2.1');assert.equal(a.knowledge_intelligence,undefined);
}
const legacy=await get('/api/market-audit?symbol=EURUSD');assert.equal(legacy.ok,true);assert.equal(legacy.schema_version,'2.1');
await get('/api/chart?symbol=EURUSD&timeframe=H4','png');
const embedded=await get('/api/market-audit?symbol=EURUSD&view=priority&knowledge=1');assert.equal(embedded.knowledge_intelligence.schema_version,'edge-knowledge-2');
await get('/api/intelligence?symbol=EURUSD&high_id=unknown','json',400);
const report={checked_at:new Date().toISOString(),origin,transport:'External HTTPS to Vercel Preview; authenticated protection bypass; NOT public unauthenticated JSON',public_access:publicAccess,production_target:project.targets?.production?.url,results};
writeFileSync(`${output}/http-checks.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({origin,checks:results.length,public_access:publicAccess,png_decoded:true,production_target:report.production_target}));
