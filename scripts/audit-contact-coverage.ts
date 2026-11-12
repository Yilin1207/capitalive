import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {buildHtfAudit} from '../lib/htf-audit';
import {ANALYSIS_TIMEFRAMES,analyzeSeries} from '../lib/technical-analysis';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
import {observeHtfContact} from '../lib/htf-contact';
import assert from 'node:assert/strict';

const root=process.env.CAPITALIVE_REVIEW_OUTPUT??'verification/capitalive-v2-1/rc2';mkdirSync(root,{recursive:true});
const f=JSON.parse(readFileSync('tests/fixtures/htf-NAS100.json','utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
const results=[];
for(const side of ['bid','ask'] as const){
  const now=Date.now(),time=new Date(now-1000).toISOString(),quote={...f.quote,fresh:true,provider_timestamp_available:true,quote_time:time,provider_timestamp:time,source_type:'WEBSOCKET' as const,delay_seconds:0};
  const audit=buildHtfAudit('NAS100',side,f.data,ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],'NAS100',side,{},quote[side])),quote);
  assert.equal(audit.contact.hit_count,3);
  const oldPriorityOnly=audit.priority_zones.zones.filter(z=>quote[side]!>=z.lower&&quote[side]!<=z.upper).map(z=>z.id);
  const excludedHit=audit.contact.contact_hits.find(z=>!oldPriorityOnly.includes(z.id))!;
  results.push({side,historical_price:quote[side],original_quote_time:f.quote.quote_time,simulation_quote_time:time,
    priority_hit_ids:oldPriorityOnly,contact:audit.contact,recovered_id:excludedHit.id,
    priority_exclusion:audit.priority_zones.excluded_from_priority.find(z=>z.id===excludedHit.id),
    stale:observeHtfContact({...quote,fresh:false},side,audit.catalog.zones,now),
    future:observeHtfContact({...quote,quote_time:new Date(now+1).toISOString()},side,audit.catalog.zones,now)});
}
writeFileSync(`${root}/contact-coverage.json`,JSON.stringify({provenance:'Controlled freshness simulation only; historical NAS100 fixture prices/OHLC unchanged. Not a current live quote or contact claim.',results},null,2));
console.log(JSON.stringify(results.map(r=>({side:r.side,old_hits:r.priority_hit_ids.length,new_hits:r.contact.hit_count,recovered_id:r.recovered_id,stale_hits:r.stale.hit_count,future_hits:r.future.hit_count}))));
