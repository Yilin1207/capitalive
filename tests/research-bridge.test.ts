import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDeskReport,errorReport} from '../lib/research-bridge/report';
import {validateReport,MAX_REPORT_BYTES} from '../lib/research-bridge/contract';
import {deskReportHttp} from '../lib/research-bridge/http';
import type {buildIntelligence} from '../lib/knowledge/intelligence';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
type Intelligence=ReturnType<typeof buildIntelligence>;
const now='2026-11-15T14:00:00.000Z';
const fixture=(symbol:string)=>JSON.parse(readFileSync(`tests/fixtures/edge-v2/${symbol}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
const analysis=(symbol:string,side='bid')=>JSON.parse(readFileSync(`verification/capitalive-v3/after/${symbol}-${side}.json`,'utf8')).response as Intelligence;

for(const symbol of ['EURUSD','NAS100','EU50'])for(const side of ['bid','ask'])test(`Bridge ${symbol}/${side}: bounded causal projection, exact IDs and unchanged Narrative`,()=>{
  const input=fixture(symbol),r=analysis(symbol,side),before=JSON.stringify(r);
  const report=buildDeskReport(r,input.data,input.quote,now);
  validateReport(report,symbol);
  assert.ok(Buffer.byteLength(JSON.stringify(report))<=MAX_REPORT_BYTES);
  assert.equal(report.scenario.confirmed_narrative,r.narrative.confirmed_narrative);
  assert.equal(report.scenario.candidate_narrative,r.narrative.candidate_bias);
  assert.equal(report.status,'STALE');assert.equal(report.quote.provider_timestamp,null);
  assert.equal(report.frames.length,4);assert.equal(JSON.stringify(r),before);
  const evidence=Object.values(report.evidence) as {id:string;confirmed_at:string}[];
  assert.ok(evidence.length>20);for(const e of evidence)assert.equal(e.confirmed_at,r.frames.flatMap(f=>f.findings).find(f=>f.id===e.id)!.confirmed_at);
  assert.equal(report.coverage.findings_included,evidence.length);
  assert.equal(report.coverage.findings_included+report.coverage.findings_omitted,report.coverage.findings_total);
  for(const f of report.frames){assert.equal(f.fractals.length,4);assert.equal(f.dealing_range,null);assert.equal(f.range_status,'EXPLICIT_SELECTION_REQUIRED');}
});
test('Bridge rejects future, wrong-side and missing dependency evidence rather than publishing incomplete claims',()=>{
  const input=fixture('EURUSD');
  const future=analysis('EURUSD');future.frames[0].findings[0].confirmed_at='2099-01-01T00:00:00.000Z';
  assert.throws(()=>buildDeskReport(future,input.data,input.quote,now),/INVALID_EVIDENCE/);
  const wrong=analysis('EURUSD');wrong.frames[0].findings[0].side='ask';assert.throws(()=>buildDeskReport(wrong,input.data,input.quote,now),/INVALID_EVIDENCE/);
  const missing=analysis('EURUSD');missing.frames[0].order_flow.evidence_ids=['missing'];assert.throws(()=>buildDeskReport(missing,input.data,input.quote,now),/INVALID_EVIDENCE/);
});
test('Bridge allowlist excludes arbitrary upstream text, accounts, secrets and OHLC',()=>{
  const input=fixture('EURUSD'),r=analysis('EURUSD');const secret='CANARY-private-account-password-123456';
  Object.assign(input.quote,{accountId:secret,password:secret,name:secret,error:secret});
  Object.assign(r,{accounts:[secret],secret});r.frames.forEach(f=>f.findings.forEach(x=>{x.invalidation=secret;x.counterarguments=[secret];x.facts.personal_data=secret;}));
  r.narrative.blockers.push('CANARY_PRIVATE_PASSWORD');
  const report=buildDeskReport(r,input.data,input.quote,now),text=JSON.stringify(report);assert.ok(!text.includes(secret));assert.ok(!text.includes('CANARY_PRIVATE_PASSWORD'));assert.ok(!text.includes('"open":'));assert.ok(!text.includes('"candles":'));
  assert.throws(()=>validateReport({...report,accounts:[secret]}),/contract/);
  const leak=structuredClone(report);Object.assign(leak.quote,{password:secret});assert.throws(()=>validateReport(leak),/contract/);
  assert.throws(()=>validateReport(report,'EURUSD',Date.parse(now),['Capital.com']),/SECRET_IN_REPORT/);
});
test('Portable validator rejects unresolved refs, future windows, oversize and unreviewed confirmation',()=>{
  const input=fixture('EURUSD'),r=buildDeskReport(analysis('EURUSD'),input.data,input.quote,now);
  const missing=structuredClone(r);missing.frames[0].snr.items=['e9999'];assert.throws(()=>validateReport(missing),/MISSING_EVIDENCE/);
  const changed=structuredClone(r);changed.scenario.confirmed_narrative='Bullish';assert.throws(()=>validateReport(changed),/UNREVIEWED_CONFIRMATION/);
  assert.throws(()=>validateReport({...r,padding:'x'.repeat(MAX_REPORT_BYTES)}),/REPORT_TOO_LARGE/);
  assert.throws(()=>validateReport(r,'NAS100'),/WRONG_SYMBOL/);
  assert.throws(()=>validateReport(r,'EURUSD',Date.parse('2026-11-16T00:00:00Z')),/INVALID_REPORT_TIME/);
  const future=structuredClone(r);future.candle_windows.push(['2099-01-01T00:00:00.000Z','2099-01-02T00:00:00.000Z']);assert.throws(()=>validateReport(future),/FUTURE_CANDLE/);
  validateReport(errorReport('EURUSD','UPSTREAM_UNAVAILABLE',now),'EURUSD');
});
test('HTTP failures become sanitized ERROR and unsupported requests fail before provider access',async()=>{
  const deps={getCandles:async()=>{throw Error('private-password upstream body');},getAnalysisQuote:async()=>fixture('EURUSD').quote};
  const r=await deskReportHttp(new Request('https://local/api/desk-report?symbol=EURUSD'),deps as never),body=await r.json();
  assert.equal(r.status,503);assert.equal(body.status,'ERROR');assert.ok(!JSON.stringify(body).includes('private-password'));validateReport(body,'EURUSD');
  assert.equal((await deskReportHttp(new Request('https://local/api/desk-report?symbol=BRENT'),deps as never)).status,400);
  assert.equal((await deskReportHttp(new Request('https://local/api/desk-report?symbol=EURUSD&high_id=x'),deps as never)).status,400);
});
test('Bridge preserves explicit H4 range IDs, confirmation, EQ and invalidation without selecting a new range',()=>{
  const input=fixture('EURUSD'),r=analysis('EURUSD'),h4=r.frames.find(f=>f.timeframe==='H4')!;
  const high=h4.findings.filter(f=>f.kind==='FRACTAL'&&f.facts.variant===3&&f.facts.polarity==='high').at(-1)!;
  const low=h4.findings.filter(f=>f.kind==='FRACTAL'&&f.facts.variant===3&&f.facts.polarity==='low').at(-1)!;
  const lower=Number(low.facts.price),upper=Number(high.facts.price),confirmed=[high.confirmed_at,low.confirmed_at].sort().at(-1)!;
  h4.range={high_id:high.id,low_id:low.id,lower,upper,equilibrium:(lower+upper)/2,confirmed_at:confirmed,origin:low.origin,timeframe:'H4',segment:0};
  h4.range_state={state:'INVALIDATED',invalidated_at:r.as_of};
  const report=buildDeskReport(r,input.data,input.quote,now),dr=report.frames.find(f=>f.timeframe==='H4')!.dealing_range!;
  assert.equal((report.evidence[dr.high] as {id:string}).id,high.id);assert.equal((report.evidence[dr.low] as {id:string}).id,low.id);
  assert.equal(dr.equilibrium,h4.range.equilibrium);assert.equal(dr.confirmed_at,confirmed);assert.equal(dr.state,'INVALIDATED');
});
