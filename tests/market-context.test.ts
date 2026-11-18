import test from 'node:test';
import assert from 'node:assert/strict';
import {rangeSeries,realized,sentimentRow} from '../lib/context/metrics';
import type {Bar} from '../lib/knowledge/data';
import {readFileSync} from 'node:fs';
test('sentiment requires an exact, unique market and verified percentages',()=>{
 const row={marketId:'US100',longPositionPercentage:0,shortPositionPercentage:100};
 const get=(rows:unknown[])=>sentimentRow({clientSentiments:rows},'US100');
 assert.deepEqual(get([row]),{long_pct:0,short_pct:100});
 for(const rows of [[row,row],[{...row,marketId:'NAS100'}],[{...row,longPositionPercentage:'0'}],[{...row,shortPositionPercentage:99}]])assert.equal(get(rows),null);
});
test('amplitude, ATR, realized log volatility and ratio use only completed windows',()=>{
 const bars:Bar[]=Array.from({length:15},(_,i)=>({index:i,time:new Date(i*14400000).toISOString(),end:new Date((i+1)*14400000).toISOString(),open:100,high:101,low:99,close:100,segment:0}));
 Object.assign(bars[14],{open:109,high:112,low:108,close:110});
 assert.equal(rangeSeries(bars.slice(0,14),'EU50').length,0);
 const [x]=rangeSeries(bars,'EU50');
 assert.equal(x.amplitude,4);assert.equal(x.range_ratio,2);assert.equal(x.range_change,'EXPANSION');
 assert.ok(Math.abs(x.atr14-38/14)<1e-7);assert.ok(Math.abs(x.realized_volatility_14_pct-100*Math.log(1.1))<1e-7);
 bars[14].segment=1;assert.deepEqual(rangeSeries(bars,'EU50'),[]);
});
for(const symbol of ['EU50','NAS100','EURUSD'])test(symbol+' closed H4/D1 context on both sides',()=>{
 const {data}=JSON.parse(readFileSync('tests/fixtures/edge-v2/'+symbol+'.json','utf8'));
 for(const tf of ['H4','D1'])for(const side of ['bid','ask'] as const){
  const f=data[tf],now=Date.parse(f.fetched_at),r=realized(f,side,now);
  assert.ok(r.history.length>0);assert.ok(r.history.every(p=>Date.parse(p.timestamp)<=now&&p.atr14>=0));
  assert.equal(realized(f,side,now+7*86400000).status,'STALE');
 }
});

test('context route rejects historical requests and reports missing configuration with no fabricated metrics',async()=>{
 const {marketContextHttp}=await import('../lib/context/http');
 const endpoint='https://local/api/desk-report?view=market-context';
 assert.equal((await marketContextHttp(new Request(endpoint+'&as_of=2020-01-01'))).status,400);
 const before=process.env.CAPITAL_API_KEY;
 try{
  delete process.env.CAPITAL_API_KEY;
  const r=await marketContextHttp(new Request(endpoint+'&symbol=EU50'));
  assert.equal(r.status,503);
  const j=await r.json();
  for(const m of [j.vix,j.client_sentiment,j.realized_volatility.H4,j.realized_volatility.D1]){
   assert.equal(m.status,'UNAVAILABLE');assert.equal(m.timestamp,null);assert.equal(m.value,null);
  }
 }finally{if(before!==undefined)process.env.CAPITAL_API_KEY=before;}
});
