import test from 'node:test';import assert from 'node:assert/strict';
import {ACTIVE_RESEARCH_SYMBOLS} from '../lib/active-research-markets';import {VERIFIED_MARKETS} from '../lib/capital';import {analysisParams} from '../lib/analysis-http';
import {buildIntelligence} from '../lib/knowledge/intelligence';import {buildDeskReport} from '../lib/research-bridge/report';import {validateReport} from '../lib/research-bridge/contract';import {deskReportHttp} from '../lib/research-bridge/http';
import {closedFrame} from '../lib/knowledge/data';import {detectFractals,detectFvg} from '../lib/knowledge/detectors';import {regularSession,calendarDiagnostics} from '../lib/research/calendars';
import {jp225Synthetic} from './fixtures/jp225-synthetic';
import {marketAudit} from '../lib/market-audit';import type {Timeframe} from '../lib/candle-data';
test('JP225 active trio and J225 mapping; archived EU50 remains general analysis only',async()=>{
 assert.deepEqual(ACTIVE_RESEARCH_SYMBOLS,['EURUSD','NAS100','JP225']);assert.equal(VERIFIED_MARKETS.JP225.epic,'J225');assert.equal(analysisParams(new URLSearchParams({symbol:'JP225'})).symbol,'JP225');
 assert.equal(analysisParams(new URLSearchParams({symbol:'EU50'})).symbol,'EU50');
 let calls=0;const r=await deskReportHttp(new Request('https://local/api/desk-report?symbol=EU50'),{getCandles:async()=>{calls++;throw Error('must not fetch');},getAnalysisQuote:async()=>{throw Error('must not fetch');}} as never);assert.equal(r.status,400);assert.equal(calls,0);
});
for(const side of ['bid','ask'] as const)test(`JP225 synthetic ${side}: four-frame V4 pipeline and compact contract without future evidence`,()=>{
 const {data,quote,asOf}=jp225Synthetic(),r=buildIntelligence(data,side,quote),report=buildDeskReport(r,data,quote,asOf);
 validateReport(report,'JP225');assert.equal(r.frames.length,4);assert.equal(report.scenario.confirmed_narrative,null);assert.equal(report.scenario.action,'NOT_EVALUATED');assert.ok(Buffer.byteLength(JSON.stringify(report)+'\n')<=65536);
 assert.ok(Object.values(report.evidence).length>0);
 for(const f of r.frames){assert.ok(f.findings.every(x=>x.id.startsWith(`JP225:${f.timeframe}:${side}:`)&&x.confirmed_at<=r.as_of));
  const full=closedFrame(data[f.timeframe],side),events=[...detectFractals(full),...detectFvg(full).findings];
  for(let n=1;n<=full.bars.length;n++){const prefix={...full,bars:full.bars.slice(0,n),as_of:full.bars[n-1].end};assert.deepEqual([...detectFractals(prefix),...detectFvg(prefix).findings],events.filter(e=>e.confirmed_at<=prefix.as_of));}
 }
 const invalid=structuredClone(report);const e=Object.values(invalid.evidence)[0] as {id:string};e.id=e.id.replace('JP225:','EU50:');assert.throws(()=>validateReport(invalid,'JP225'),/INVALID_EVIDENCE_ID/);
});
test('JP225 never inherits the EU50/US historical session calendar',()=>{
 assert.equal(regularSession('JP225',Date.parse('2026-11-15T23:00:00Z')),'UNKNOWN');const c=calendarDiagnostics(jp225Synthetic().data.H4);assert.equal(c.timezone,'UTC');assert.equal(c.holiday_calendar,'NOT_VERIFIED');
});

test('JP225 Market Audit integration retains the existing 2.1 API and optional V4 knowledge',async()=>{
 const f=jp225Synthetic(),deps={getCandles:async(_symbol:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.asOf})};
 const response=await marketAudit(new Request('https://local/api/market-audit?symbol=JP225&side=ask&view=priority&knowledge=1'),deps),r=await response.json();
 assert.equal(response.status,200);assert.equal(r.schema_version,'2.1');assert.equal(r.symbol,'JP225');assert.equal(r.knowledge_intelligence.price_side,'ask');assert.equal(r.knowledge_intelligence.frames.length,4);
});
