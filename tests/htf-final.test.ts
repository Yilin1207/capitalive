import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candle,data,supportHistory} from './htf-test-helpers';
import {detectIndependentSNR} from '../lib/htf-snr';
import {buildHtfAudit} from '../lib/htf-audit';
import {rankPriorityZones} from '../lib/htf-priority';
import {analyzeSeries,ANALYSIS_TIMEFRAMES} from '../lib/technical-analysis';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';

test('one weak close is observed/pending; strong displacement confirms break but never same-bar role reversal',()=>{
  const base=supportHistory();
  const weak=detectIndependentSNR(data([...base,candle(12,110,94,96, true,100)]),'NAS100').zones.find(z=>z.origin.price===100)!;
  assert.deepEqual(weak.evidence.events.slice(-2).map(e=>e.state),['CLOSE_BREAK','BREAK_PENDING']);
  const strong=detectIndependentSNR(data([...base,candle(12,110,75,77,true,108)]),'NAS100').zones.find(z=>z.origin.price===100)!;
  assert.equal(strong.break_status,'confirmed'); assert.equal(strong.role,'support'); assert.equal(strong.provisional_role,'resistance');
  assert.equal(strong.evidence.events.at(-1)!.state,'CONFIRMED_BREAK');
  assert.equal(strong.evidence.events.at(-1)!.facts.close,77);
  assert.ok(strong.evidence.events.every(e=>e.confirmed_at>e.time));
  const reclaimed=detectIndependentSNR(data([...base,candle(12,110,75,77,true,108),candle(13,112,90,110)]),'NAS100').zones.find(z=>z.origin.price===100)!;
  assert.equal(reclaimed.break_status,'reclaimed'); assert.equal(reclaimed.role,'support');
  assert.equal(reclaimed.current_state,'BREAK_INVALIDATED');
});
test('prefix replay proves event timestamps, confidence and frozen bands do not use future candles',()=>{
  const bars=[...supportHistory(),candle(12,99,90,94),candle(13,96,90,93),candle(14,101,90,94),candle(15,96,88,92),candle(16,900,10,500)];
  const complete=detectIndependentSNR(data(bars),'NAS100');
  for(let end=4;end<=bars.length;end++){
    const prefix=detectIndependentSNR(data(bars.slice(0,end)),'NAS100');
    for(const z of prefix.zones){
      const full=complete.zones.find(f=>f.id===z.id)!;
      assert.equal(z.lower,full.lower);assert.equal(z.upper,full.upper);
      assert.deepEqual(z.evidence.events,full.evidence.events.filter(e=>e.time<=bars[end-1].time));
    }
  }
});
test('priority is bounded, explained, HTF represented without FVG, and every other candidate remains accounted for',()=>{
  const f=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
  const analyses=ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],'NAS100'));
  for(const s of analyses){s.fvgs=[];s.fractals=[];}
  const snr=Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf=>[tf,detectIndependentSNR(f.data[tf],'NAS100','bid',f.quote.bid)]));
  const p=rankPriorityZones(snr,analyses,f.quote.bid);
  assert.ok(p.selected_count<=20); assert.ok(p.zones.some(z=>z.timeframe==='MN1')); assert.ok(p.zones.some(z=>z.timeframe==='W1'));
  assert.equal(p.selected_count+p.excluded_from_priority.length,p.full_snr_count);
  assert.ok(p.zones.every(z=>z.confluences.length===0&&z.components.confluence===0));
  assert.equal(p.policy.score_is_probability,false);
});

function riskFixture(mirror=false){
  const rows=[[108,99,103],[110,100,105],[120,101,110],[112,100,106],[111,98,104],[109,90,100],[113,99,105],[115,100,108],[125,102,117],[119,101,110],[115,100,108],[112,95,102],[117,101,108],[119,102,110],[132,108,130], [131,120,125],[130,110,120],[129,118,123],[128,119,122]];
  const h4=rows.map(([h,l,c],i)=>candle(i,h,l,c));
  const daily=[[130,120,125],[132,122,126],[140,123,130],[131,120,125],[129,118,122]].map(([h,l,c],i)=>candle(i,h,l,c));
  const transform=(bars:typeof h4)=>mirror?bars.map(c=>candle((Date.parse(c.time)-Date.UTC(2025,0,6))/(7*86400000),300-c.low.bid!,300-c.high.bid!,300-c.close.bid!)):bars;
  const series=Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf=>[tf,{...data(transform(tf==='H4'?h4:tf==='D1'?daily:[])),timeframe:tf}])) as Record<Timeframe,CandleResponse>;
  const quote={...JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')).quote,bid:mirror?170:130,ask:mirror?170.2:130.2};
  return {series,quote};
}
test('SL protects the pre-BOS swing, not a newer nearer fractal; Ask/Bid spread enters both directional geometries',()=>{
  for(const mirror of [false,true]){
    const f=riskFixture(mirror),analysis=ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.series[tf],'NAS100'));
    const htf=buildHtfAudit('NAS100','bid',f.series,analysis,f.quote);
    const r=mirror?htf.risk.short:htf.risk.long;
    assert.ok(r.structural_sl); assert.equal(r.structural_sl!.price,mirror?205.2:95);
    assert.ok(Math.abs(r.distance_to_sl!-35.2)<1e-8); assert.ok(Math.abs(r.distance_to_tp!-9.8)<1e-8);
    assert.ok(Math.abs(r.rr_to_tp!-9.8/35.2)<1e-8); assert.notEqual(r.principal_tp!.timeframe,'H4');
    assert.equal(r.entry_side,mirror?'bid':'ask');assert.equal(r.exit_side,mirror?'ask':'bid');
    assert.ok(r.structural_sl!.protected_by_break_id);
    const noQuote=buildHtfAudit('NAS100','bid',f.series,analysis,{...f.quote,ask:null});
    assert.equal(noQuote.risk.long.rr_to_tp,null);assert.equal(noQuote.risk.short.rr_to_tp,null);
  }
});
test('real NAS100 W1 and EURUSD MN1 historical event replay is prefix invariant',()=>{
  for(const [asset,tf] of [['NAS100','W1'],['EURUSD','MN1']] as const){
    const f=JSON.parse(readFileSync(`tests/fixtures/htf-${asset}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>};
    const input=f.data[tf],complete=detectIndependentSNR(input,asset);
    for(let end=12;end<input.candles.length;end+=11){
      const prefix=detectIndependentSNR({...input,candles:input.candles.slice(0,end)},asset);
      for(const z of prefix.zones)assert.deepEqual(z.evidence.events,complete.zones.find(p=>p.id===z.id)!.evidence.events.filter(e=>e.time<=input.candles[end-1].time));
    }
  }
});
test('early break rejects weak displacement, small body and a close away from the directional extreme',()=>{
  for(const bar of [candle(12,110,94,96,true,108),candle(12,110,75,77,true,78),candle(12,110,50,77,true,108)]){
    const z=detectIndependentSNR(data([...supportHistory(),bar]),'NAS100').zones.find(z=>z.origin.price===100)!;
    assert.equal(z.break_status,'pending');assert.ok(!z.evidence.events.some(e=>e.state==='CONFIRMED_BREAK'));
  }
});
