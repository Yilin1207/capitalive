import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {chartResponse} from '../lib/chart-http';
import {chartHtf} from '../lib/chart-htf';
import {chartSvg,DEFAULT_LAYERS} from '../lib/chart-svg';
import {analyzeSeries} from '../lib/technical-analysis';
import {htfZones} from '../lib/htf-http';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

const fixture=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
test('all SNR frames and closed event labels render with explicit image-only counts; switches preserve full data',()=>{
  const data=fixture.data.W1,analysis=analyzeSeries(data,'NAS100');
  const overlay=chartHtf(fixture.data,'NAS100','bid',data.candles.at(-1)!.close.bid);
  const layers={...DEFAULT_LAYERS,snr_mn1:true,snr_w1:true,snr_d1:true,snr_h4:true,snr_events:true};
  const svg=chartSvg(data,analysis,'NAS100','bid',layers,120,overlay);
  for(const tf of ['MN1','W1','D1','H4'])assert.ok(svg.includes(`data-snr-timeframe="${tf}"`),tf);
  assert.match(svg,/full catalog retains/);assert.match(svg,/data-snr-state=/);
  assert.doesNotMatch(chartSvg(data,analysis,'NAS100','bid',DEFAULT_LAYERS,120,overlay),/data-snr-timeframe=/);
  assert.doesNotMatch(chartSvg(data,analysis,'NAS100','bid',{...layers,snr_events:false},120,overlay),/data-snr-state=/);
});
test('PNG route uses one sequential history request per TF only when SNR requested and decodes genuine image',async()=>{
  const calls:string[]=[];
  const deps={getCandles:async(_s:string,tf:Timeframe)=>{calls.push(tf);return fixture.data[tf];}};
  const plain=await chartResponse(new Request('https://local/api/chart?symbol=NAS100&timeframe=W1'),deps);
  assert.equal(plain.status,200);assert.deepEqual(calls,['W1']);calls.length=0;
  const response=await chartResponse(new Request('https://local/api/chart?symbol=NAS100&timeframe=W1&snr_mn1=1&snr_w1=1&snr_d1=1&snr_h4=1&snr_events=1'),deps);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(calls,['W1','MN1','D1','H4']);
  const bytes=Buffer.from(await response.arrayBuffer()),meta=await sharp(bytes).metadata();
  assert.equal(meta.width,1400);assert.equal(meta.height,1280);assert.ok(!bytes.equals(Buffer.from(await plain.arrayBuffer())));
  assert.equal((await chartResponse(new Request('https://local/api/chart?snr_w1=yes'),deps)).status,400);
});
test('priority HTTP view is compact and links full evidence without presenting it as the full catalog',async()=>{
  const response=await htfZones(new Request('https://local/api/htf-zones?symbol=NAS100&view=priority'),{
    getCandles:async(_s,tf)=>fixture.data[tf],getAnalysisQuote:async()=>({...fixture.quote,cache_hit:false,evaluated_at:fixture.data.H4.fetched_at}),
  });
  const text=await response.text(),body=JSON.parse(text);
  assert.equal(response.status,200);assert.ok(text.length<250000);assert.equal(body.scope.full_catalog_included,false);
  assert.ok(body.scope.full_catalog_count>body.priority_zones.selected_count);assert.match(body.scope.full_catalog_url,/view=full/);
  assert.equal(body.catalog,undefined);assert.deepEqual(Object.keys(body.frame_snapshots),['MN1','W1','D1','H4']);
});
