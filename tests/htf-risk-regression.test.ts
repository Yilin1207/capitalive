import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyObstacles,directionalRole} from '../lib/htf-obstacles';
import type {CatalogEntry} from '../lib/htf-zone-catalog';
import {buildHtfAudit} from '../lib/htf-audit';
import {observeHtfContact} from '../lib/htf-contact';
import {ANALYSIS_TIMEFRAMES,analyzeSeries} from '../lib/technical-analysis';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
import {data,supportHistory,candle} from './htf-test-helpers';
import {detectIndependentSNR} from '../lib/htf-snr';

const zone=(id:string,role:CatalogEntry['role'],lower:number,upper:number,extra:Partial<CatalogEntry>={}):CatalogEntry=>({id,source_id:id,asset:'NAS100',timeframe:'MN1',type:'SNR',lower,upper,role,
  provisional_role:null,role_reversal_confirmed:false,status:'tested',origin:{time:'2025-01-01T00:00:00Z'},test_count:3,last_test:'2025-02-01T00:00:00Z',break_status:'unbroken',retest_status:'none',quality:{},evidence:{},
  invalidation:'test',data_reliability:{status:'PARTIAL',reasons:[],scope:'synthetic'},main_tp_eligible:false,significant:true,downgrade_reasons:[],distance:null,...extra});
const classify=(zones:CatalogEntry[],direction:'long'|'short'='long',tp:number|null=140)=>classifyObstacles(zones,direction,100,tp,0,direction==='long'?'bid':'ask');

test('LONG inside monthly support: context only; bearish FVG at 110 is first supply, not zero distance',()=>{
  const r=classify([zone('monthly','support',95,105),zone('fvg','resistance',110,115,{type:'FVG',timeframe:'H4'})]);
  assert.equal(r.first!.id,'fvg');assert.equal(r.first!.price-100,10);assert.equal(r.current_zones[0].opposes,false);
  assert.match(r.first!.evidence_time_basis,/formation_bar_start/);
});
test('SHORT inside weekly resistance: context only; bullish OB at 90 is first demand',()=>{
  const r=classify([zone('weekly','resistance',95,105,{timeframe:'W1'}),zone('ob','support',85,90,{type:'ORDER_BLOCK',timeframe:'H4'})],'short',60);
  assert.equal(r.first!.id,'ob');assert.equal(100-r.first!.price,10);assert.equal(r.current_zones[0].opposes,false);
});
test('zero obstacle distance is legitimate only for opposing role; geometry does not convert a role',()=>{
  assert.equal(classify([zone('s','support',95,105)]).first,null);
  assert.equal(classify([zone('r','resistance',95,105)]).first!.price,100);
  assert.equal(classify([zone('s','support',95,105)],'short',60).first!.price,100);
  assert.equal(classify([zone('r','resistance',95,105)],'short',60).first,null);
  assert.equal(classify([zone('s','support',110,120)]).first,null);
});
test('provisional role is potential opposing evidence, never a confirmed reversal or the old role in both directions',()=>{
  const z=zone('break','support',95,105,{provisional_role:'resistance',break_status:'pending',provisional_at:'2025-03-01T00:00:00Z'});
  const r=classify([z]).first!;assert.equal(r.directional_role,'provisional_resistance');assert.equal(r.confirmation,'provisional');assert.equal(r.role_reversal_confirmed,false);
  assert.equal(r.role,'support');assert.equal(r.evidence_at,z.provisional_at);assert.equal(classify([z],'short',60).first,null);
});
test('confirmed reversal, neutral role and conflicted cross-TF evidence remain distinct',()=>{
  const r=zone('reversed','resistance',110,115,{role_reversal_confirmed:true});
  assert.equal(classify([r]).first!.role_reversal_confirmed,true);
  const n=zone('unknown','boundary',95,105);assert.equal(directionalRole(n),'neutral');assert.equal(classify([n]).first,null);assert.equal(classify([n]).uncertain_zones.length,1);
  const result=classify([r,zone('weekly','support',108,117,{timeframe:'W1'})]);
  assert.equal(result.first!.id,'reversed');assert.equal(result.first!.classification,'conflicted');assert.equal(result.first!.conflict_count,1);
  assert.equal(result.before_tp.length,1); // Opposing evidence survives conflict; supportive evidence is not promoted.
});
test('first obstacle is ahead and strictly before TP; at/beyond TP is separately enumerated',()=>{
  const zones=[zone('behind','resistance',80,90),zone('at','resistance',140,145),zone('beyond','resistance',150,160)];
  const r=classify(zones);assert.equal(r.first,null);assert.deepEqual(r.beyond_or_at_tp,['at','beyond']);
  assert.equal(classify([...zones,zone('between','resistance',120,125)]).first!.id,'between');
});
test('a completed reversal flag is causal; first close and forming follow-through cannot set it',()=>{
  const base=[...supportHistory(),candle(12,99,90,94),candle(13,96,90,93),candle(14,101,90,94)];
  const focus=(bars:ReturnType<typeof supportHistory>)=>detectIndependentSNR(data(bars),'NAS100').zones.find(z=>z.origin.price===100)!;
  assert.equal(focus(base).role_reversal_confirmed,false);
  assert.equal(focus([...base,candle(15,96,88,92,false)]).role_reversal_confirmed,false);
  const done=focus([...base,candle(15,96,88,92)]);assert.equal(done.role,'resistance');assert.equal(done.role_reversal_confirmed,true);
});

for(const asset of ['EURUSD','NAS100','EU50'] as const)test(`${asset} recorded BID/ASK: every obstacle has opposing evidence and correct geometry; independent audit counterexamples`,()=>{
  const f=JSON.parse(readFileSync(`tests/fixtures/htf-${asset}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
  for(const side of ['bid','ask'] as const){
    const analyses=ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],asset,side,{},f.quote[side]));
    const a=buildHtfAudit(asset,side,f.data,analyses,f.quote);
    for(const direction of ['long','short'] as const){
      const r=a.risk[direction],opposing=direction==='long'?'resistance':'support';
      assert.equal(r.entry,direction==='long'?f.quote.ask:f.quote.bid);
      for(const o of r.obstacles_before_tp){
        assert.equal(o.directional_role.replace('provisional_',''),opposing);
        assert.equal(o.price_side,direction==='long'?'bid':'ask');
        assert.ok(direction==='long'?o.price>=r.entry!:o.price<=r.entry!);
        if(r.principal_tp)assert.ok(Math.abs(o.price-r.entry!)<Math.abs(r.principal_tp.price-r.entry!));
      }
      if(!r.structural_sl){assert.equal(r.rr_to_tp,null);assert.equal(r.rr_to_obstacle,null);}
      if(r.structural_sl&&r.first_obstacle)assert.equal(r.rr_to_obstacle,Math.abs(r.first_obstacle.price-r.entry!)/Math.abs(r.entry!-r.structural_sl.price));
    }
    if(asset==='NAS100'){
      const focus=a.snr.W1.zones.find(z=>Math.abs(z.origin.price-28184.7)<2)!;
      assert.equal(focus.break_status,'confirmed');assert.equal(focus.role,'support');assert.equal(focus.role_reversal_confirmed,false);
      assert.equal(a.risk.long.first_obstacle!.id,focus.id);assert.equal(a.risk.long.first_obstacle!.confirmation,'provisional');
      assert.ok(a.priority_zones.zones.some(z=>z.id===focus.id));
      assert.ok(a.risk.long.current_zones.some(z=>z.timeframe==='MN1'&&z.directional_role==='support'&&!z.opposes));
      assert.ok(!a.risk.short.obstacles_before_tp.some(z=>z.id===focus.id));
    }
    if(asset==='EURUSD'){assert.equal(a.risk.long.first_obstacle!.type,'FVG');assert.equal(a.risk.long.first_obstacle!.timeframe,'H4');assert.ok(a.risk.long.distance_to_first_obstacle!>0);}
    if(asset==='EU50'){assert.notEqual(a.risk.short.first_obstacle!.timeframe,'W1');assert.equal(a.risk.short.first_obstacle!.directional_role,'provisional_support');assert.equal(a.contact.eligible,false);}
  }
});
test('stale, absent, future timestamps and false freshness never generate realtime contact or alerts',()=>{
  const f=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
  const a=buildHtfAudit('NAS100','bid',f.data,ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],'NAS100')),f.quote);
  const now=Date.parse(f.quote.quote_time!);
  const valid={...f.quote,fresh:true,provider_timestamp_available:true,source_type:'WEBSOCKET' as const};
  const fresh=observeHtfContact(valid,'bid',a.catalog.zones,now);assert.equal(fresh.eligible,true);assert.ok(fresh.zones.length);assert.equal(fresh.zones[0].closed_retest_confirmed,false);
  for(const [q,t] of [[{...valid,fresh:false},now],[{...valid,quote_time:null},now],[valid,now+300001],[valid,now-1]] as const){
    const c=observeHtfContact(q,'bid',a.catalog.zones,t);assert.equal(c.eligible,false);assert.deepEqual(c.zones,[]);assert.equal(c.alerts_emitted,false);
  }
});
