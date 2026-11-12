import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {chartPng} from '../lib/chart-png';
import {chartSvg,DEFAULT_LAYERS} from '../lib/chart-svg';
import {chartHtf} from '../lib/chart-htf';
import {analyzeSeries,ANALYSIS_SYMBOLS,ANALYSIS_TIMEFRAMES} from '../lib/technical-analysis';
import {detectIndependentSNR} from '../lib/htf-snr';
import {reviewScenario} from '../tests/htf-review-scenarios';
import annotations from '../tests/fixtures/htf-review-annotations.json';
import type {CandleResponse,Timeframe} from '../lib/candle-data';

const root='verification/capitalive-v2-1/final-charts';mkdirSync(root,{recursive:true});
const index:{file:string;provenance:string;annotation:string;states?:string[]}[]=[];
for(const asset of ANALYSIS_SYMBOLS){
  const f=JSON.parse(readFileSync(`tests/fixtures/htf-${asset}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>};
  for(const tf of ANALYSIS_TIMEFRAMES){
    const data=f.data[tf],a=analyzeSeries(data,asset),overlay=chartHtf(f.data,asset,'bid',data.candles.at(-1)?.close.bid??null);
    const svg=chartSvg(data,a,asset,'bid',{...DEFAULT_LAYERS,snr_mn1:true,snr_w1:true,snr_d1:true,snr_h4:true,snr_events:true},120,overlay);
    const file=`${asset}-${tf}.png`;writeFileSync(`${root}/${file}`,chartPng(svg));
    index.push({file,provenance:'Recorded real Capital.com DEMO OHLC; algorithm overlay, not independent labels',annotation:asset==='NAS100'&&tf==='W1'?'User sparse reference 28090–28220; see focus chart':'No independent expert annotation available'});
    if(asset==='NAS100'&&tf==='W1'){
      const focus={...overlay,priority_zones:{...overlay.priority_zones,zones:overlay.priority_zones.zones.filter(z=>z.timeframe==='W1'&&z.origin.price>=28090&&z.origin.price<=28220)}};
      const shown=data.candles.slice(-32),min=Math.min(...shown.map(c=>c.low.bid!)),max=Math.max(...shown.map(c=>c.high.bid!));
      const pad=Math.max((max-min)*0.1,Math.abs(max)*0.0001,0.00001),py=(v:number)=>140+(max+pad-v)/(max-min+2*pad)*554;
      const reference=`<rect x="72" y="${py(28220)}" width="1178" height="${py(28090)-py(28220)}" fill="none" stroke="#f1c76b" stroke-dasharray="3 5"/><text x="72" y="809" fill="#f1c76b" font-size="12">Gold dashed: user-provided approximate band, not exhaustive independent ground truth</text>`;
      const focusSvg=chartSvg(data,a,asset,'bid',{...DEFAULT_LAYERS,fractals:false,fvg:false,ranges:false,eq:false,snr_w1:true,snr_events:true},32,focus)
        .replace('</g></svg>',`${reference}</g></svg>`)
        .replace('CAPITALIVE 2.1 / OBSERVED MARKET DATA','NAS100 W1 / USER SPARSE REFERENCE 28090-28220');
      writeFileSync(`${root}/NAS100-W1-focus.png`,chartPng(focusSvg));
      index.push({file:'NAS100-W1-focus.png',provenance:'Real recorded BID OHLC; algorithm band and events',annotation:'Approximate user band 28090-28220 is sparse reference only; no exhaustive accuracy claim'});
    }
  }
}
for(const a of annotations.cases){
  const d=reviewScenario(a.pattern,a.timeframe as Timeframe),audit=detectIndependentSNR(d,'NAS100'),z=audit.zones.find(z=>z.origin.price===a.focus_price)!;
  const min=Math.min(...d.candles.map(c=>c.low.bid!))-3,max=Math.max(...d.candles.map(c=>c.high.bid!))+3;
  const x=(i:number)=>65+(i+0.5)*850/d.candles.length,y=(v:number)=>120+(max-v)/(max-min)*350;
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="720"><rect width="1100" height="720" fill="#0c1422"/><g font-family="Noto Sans" fill="#dce7f6"><text x="50" y="35" font-size="22">${a.id}</text><text x="50" y="65" font-size="14">SYNTHETIC · predeclared partial expectations · not independent expert labels</text><text x="50" y="88" font-size="13">Gold dashed: annotated focus band ${a.reference_band.join('–')} · Blue: engine band · No precision/recall claim</text>`];
  parts.push(`<rect x="65" y="${y(a.reference_band[1])}" width="850" height="${y(a.reference_band[0])-y(a.reference_band[1])}" fill="#f1c76b" fill-opacity="0.06" stroke="#f1c76b" stroke-width="2" stroke-dasharray="8 5"/>`);
  parts.push(`<rect x="70" y="${y(z.upper)}" width="835" height="${y(z.lower)-y(z.upper)}" fill="#66c8ff" fill-opacity="0.1" stroke="#66c8ff"/>`);
  for(let j=0;j<6;j++){const price=min+(max-min)*j/5;parts.push(`<text x="935" y="${y(price)+4}" font-size="13">${price.toFixed(1)}</text>`);}
  d.candles.forEach((c,i)=>{const color=!c.is_closed?'#f1c76b':c.close.bid!>=c.open.bid!?'#57dab2':'#f18794';parts.push(`<path d="M${x(i)} ${y(c.high.bid!)}V${y(c.low.bid!)}" stroke="${color}"/><rect x="${x(i)-6}" y="${y(Math.max(c.open.bid!,c.close.bid!))}" width="12" height="${Math.max(2,Math.abs(y(c.open.bid!)-y(c.close.bid!)))}" fill="${color}"/><text x="${x(i)}" y="495" text-anchor="middle" font-size="10">${i}</text>`);});
  parts.push(`<text x="50" y="530" font-size="16">Focus: ${z.status}; role ${z.role}; tests ${z.test_count}; reactions ${z.reaction_count}</text>`);
  z.evidence.events.slice(-6).forEach((e,i)=>parts.push(`<text x="50" y="${560+i*23}" font-size="13">bar ${e.index} · ${e.state} · ${e.confidence} · close ${e.facts.close} · known ${e.confirmed_at.slice(0,10)}</text>`));
  parts.push('</g></svg>');const file=`scenario-${a.id}.png`;writeFileSync(`${root}/${file}`,chartPng(parts.join('')));
  index.push({file,provenance:annotations.provenance,annotation:JSON.stringify(a),states:z.evidence.events.map(e=>e.state)});
}
writeFileSync(`${root}/index.json`,JSON.stringify({precision:null,recall:null,reason:annotations.reason,charts:index},null,2));
writeFileSync(`${root}/index.html`,`<!doctype html><meta charset="utf-8"><title>Capitalive HTF review</title><style>body{background:#0c1422;color:#dce7f6;font:16px system-ui;max-width:1400px;margin:auto}img{width:100%;height:auto}article{margin:2rem 0}p{max-width:1000px}</style><h1>HTF review: recorded data and synthetic expectations</h1><p>No independent exhaustive expert labels. Precision / recall are not established. Synthetic expectations are separate authored scenarios.</p>${index.map(c=>`<article><h2>${c.file}</h2><p>${c.provenance}</p><img src="${c.file}" alt="${c.file}" loading="lazy"></article>`).join('')}`);
console.log(JSON.stringify({charts:index.length,folder:root,precision:null,recall:null}));
