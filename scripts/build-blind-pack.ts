// Deliberately imports no detector, intelligence engine, predictions, or expected answers.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeCandles,parseCandleTime,HISTORY,type CandleResponse,type Timeframe} from '../lib/candle-data';
import {aggregateMonths} from '../lib/monthly-candles';
import {historyDiagnostics} from '../lib/history-diagnostics';
import {canonical,type BlindCase} from '../lib/research/blind';
const protocol=JSON.parse(readFileSync('knowledge/research/v3-protocol.json','utf8'));
const read=(symbol:string,name:string)=>JSON.parse(readFileSync(`verification/capitalive-v3/raw/${symbol}-${name}.json`,'utf8'));
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const cases:BlindCase[]=[];
for(const symbol of protocol.symbols){const dailyPages=['D1-2020-01-01','D1-2022-06-01','D1-2024-11-01'].map(n=>read(symbol,n)),weekly=read(symbol,'W1');
 for(const cutoff of protocol.requested_cutoffs_utc){const asOf=new Date(cutoff).toISOString(),at=Date.parse(asOf),h4=read(symbol,`H4-${asOf.slice(0,10)}`),data={} as Record<Timeframe,CandleResponse>;
  for(const tf of ['MN1','W1','D1','H4'] as Timeframe[]){const sources=tf==='MN1'||tf==='D1'?dailyPages:tf==='W1'?[weekly]:[h4];const prices=sources.flatMap(p=>p.payload.prices).filter((r:{snapshotTimeUTC:string})=>{const t=parseCandleTime(r.snapshotTimeUTC);return t!==null&&Date.parse(t)+(tf==='W1'?7:tf==='H4'?1/6:1)*86400_000<=at;});
   const q=normalizeCandles({prices},tf==='MN1'?'D1':tf,at);q.candles=q.candles.filter(c=>c.is_closed&&Date.parse(c.time)+(tf==='W1'?7:tf==='H4'?1/6:1)*86400_000<=at);
   const gaps=q.rejected.flatMap(r=>r.time&&!q.candles.some(c=>c.time===r.time)?[r.time]:[]);
   if(tf==='MN1')q.candles=aggregateMonths(q.candles,at,gaps).filter(c=>c.is_closed);
   const candles=q.candles.slice(-HISTORY[tf].limit);
   data[tf]={ok:true,symbol,epic:weekly.epic,timeframe:tf,provider:'Capital.com',environment:weekly.environment,price_side:'bid_ask',fetched_at:sources.map(s=>s.captured_at).sort().at(-1),candles,metadata:{requested:HISTORY[tf].limit,returned:candles.length,available:q.candles.length,insufficient_history:candles.length<HISTORY[tf].limit,discarded_rows:q.discarded_rows,discarded_sides:q.discarded_sides,discarded_reasons:q.discarded_reasons,duplicate_rows:q.duplicate_rows,validation_gaps:gaps,time_semantics:tf==='MN1'?'calendar_month_start_utc':'provider_bar_start_utc',closure_basis:tf==='MN1'?'calendar_month_end_elapsed_at_fetch':'successor_or_nominal_interval_elapsed_at_fetch',cache_ttl_seconds:0,cache_hit:false,diagnostics:historyDiagnostics(q,candles,tf,at,at,0)}};
  }
  const body={id:hash({symbol,asOf,protocol:protocol.version}).slice(0,16),symbol,as_of:asOf,price_side:'bid' as const,environment:weekly.environment,source:'Capital.com demo /api/v1/prices; archived 2026-11-15',data,vintage_warning:'Historical reconstruction from current provider vintage. Original point-in-time revisions are not independently verified.'};cases.push({...body,case_sha256:hash(body)});
 }
}
cases.sort((a,b)=>a.as_of.localeCompare(b.as_of)||a.id.localeCompare(b.id));const pack={schema:'capitalive-blind-pack-1',protocol:protocol.version,pack_id:hash(cases.map(c=>({id:c.id,hash:c.case_sha256}))),cases};
mkdirSync('knowledge/research',{recursive:true});writeFileSync('knowledge/research/blind-pack.json',JSON.stringify(pack)+'\n');console.log(JSON.stringify({pack_id:pack.pack_id,cases:cases.length,frames:cases.map(c=>({id:c.id,symbol:c.symbol,as_of:c.as_of,counts:Object.fromEntries(Object.entries(c.data).map(([tf,d])=>[tf,d.candles.length]))}))},null,2));
