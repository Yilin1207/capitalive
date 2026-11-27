import test from 'node:test';import assert from 'node:assert/strict';import fixture from './fixtures/pa-v4/golden.json';
import * as pa from '../lib/knowledge/detectors';import type {Frame} from '../lib/knowledge/data';import type {Timeframe} from '../lib/candle-data';
const time=(n:number)=>new Date(Date.UTC(2026,0,1,n*4)).toISOString();
type Case={id:string;detector:string;variant?:number;filter?:{polarity?:string};segments?:number[];origin_bar?:number;pivot_index?:number;kl?:{price:number;upper?:number;role:string;timeframe?:string};bars:number[][];expected:Record<string,unknown>[]};
const frame=(c:Case,n=c.bars.length):Frame=>({timeframe:'H4',symbol:'TEST',side:'bid',status:'PARTIAL',warnings:[],as_of:time(n),bars:c.bars.slice(0,n).map(([open,high,low,close],index)=>({open,high,low,close,index,time:time(index),end:time(index+1),segment:c.segments?.[index]??0}))});
function run(c:Case,f:Frame):pa.Finding[]{
 const pivots=pa.detectFractals(f),kl:pa.KeyLevel[]=c.kl?[{id:'source-kl',timeframe:(c.kl.timeframe??'H4') as Timeframe,side:'bid',kind:'FRACTAL',lower:c.kl.price,upper:c.kl.upper??c.kl.price,role:c.kl.role as 'support'|'resistance',confirmed_at:time(-1),qualified:true,source_finding:{} as pa.Finding}]:[];
 const events=c.detector==='FRACTAL'?pa.detectFractals(f,c.variant as 3):c.detector==='FVG'?pa.detectFvg(f).findings:c.detector==='RB'?pa.detectRejectionBlocks(f,kl):c.detector==='SNR'?pa.detectSnr(f,kl):c.detector==='RAID'?pa.detectRaids(f,pivots.filter(p=>p.index===c.pivot_index&&p.polarity==='high')):c.detector==='STRUCTURE'?pa.detectStructure(f,pivots).findings:c.detector==='IDM'?pa.detectIdm(f,pivots,kl):c.detector==='COMPRESSION'?pa.measureCompression(f,pivots,kl):c.detector==='DISPLACEMENT'?pa.measureDisplacement(f):[];
 return events.filter(e=>(!c.filter?.polarity||e.facts.polarity===c.filter.polarity)&&(c.origin_bar===undefined||e.origin===time(c.origin_bar)));
}
for(const c of fixture.cases as Case[])test(`V4 golden ${c.id} + every closed prefix`,()=>{
 const full=run(c,frame(c));assert.equal(full.length,c.expected.length);
 c.expected.forEach((expected,i)=>{for(const [key,value]of Object.entries(expected)){if(key==='confirmed_bar')assert.equal(full[i].confirmed_at,time(Number(value)+1));else assert.deepEqual(key==='kind'||key==='state'?full[i][key]:full[i].facts[key],value);}});
 for(let n=1;n<=c.bars.length;n++){const prefix=run(c,frame(c,n));assert.ok(prefix.every(e=>e.confirmed_at<=time(n)&&e.candle_evidence.every(b=>b.closed_at<=e.confirmed_at)));
  if(!['COMPRESSION','DISPLACEMENT'].includes(c.detector))assert.deepEqual(prefix,full.filter(e=>e.confirmed_at<=time(n)),`unstable prefix ${n}`);
 }
});
