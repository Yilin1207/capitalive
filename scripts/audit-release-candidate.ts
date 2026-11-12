import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {buildHtfAudit} from '../lib/htf-audit';
import {ANALYSIS_SYMBOLS,ANALYSIS_TIMEFRAMES,analyzeSeries} from '../lib/technical-analysis';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
import {marketAudit} from '../lib/market-audit';
import {htfZones} from '../lib/htf-http';

async function main(){
  const root=process.env.CAPITALIVE_REVIEW_OUTPUT??'verification/capitalive-v2-1/rc';mkdirSync(root,{recursive:true});const results=[];
  for(const asset of ANALYSIS_SYMBOLS){
    const f=JSON.parse(readFileSync(`tests/fixtures/htf-${asset}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
    const deps={getCandles:async(_s:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.data.H4.fetched_at})};
    for(const side of ['bid','ask'] as const){
      const analyses=ANALYSIS_TIMEFRAMES.map(tf=>analyzeSeries(f.data[tf],asset,side,{},f.quote[side]));
      const audit=buildHtfAudit(asset,side,f.data,analyses,f.quote);
      const full=await marketAudit(new Request(`https://local/api/market-audit?symbol=${asset}&side=${side}&include_candles=1`),deps);
      const fullText=await full.text();
      const priority=await htfZones(new Request(`https://local/api/htf-zones?symbol=${asset}&side=${side}&view=priority`),deps);
      const priorityText=await priority.text();
      const focus=asset==='NAS100'?audit.snr.W1.zones.find(z=>Math.abs(z.origin.price-28184.7)<2):undefined;
      const result={asset,side,full_status:full.status,full_bytes:Buffer.byteLength(fullText),priority_status:priority.status,priority_bytes:Buffer.byteLength(priorityText),
        counts:{snr:audit.priority_zones.full_snr_count,priority:audit.priority_zones.selected_count},
        focus:focus?{id:focus.id,lower:focus.lower,upper:focus.upper,role:focus.role,provisional_role:focus.provisional_role,role_reversal_confirmed:focus.role_reversal_confirmed,break_status:focus.break_status,
          selected:audit.priority_zones.zones.some(z=>z.id===focus.id)}:null,
        geometry:Object.fromEntries(['long','short'].map(d=>{const r=audit.risk[d as 'long'|'short'];return [d,{entry:r.entry,sl:r.structural_sl,tp:r.principal_tp,first_obstacle:r.first_obstacle,rr_to_obstacle:r.rr_to_obstacle,rr_to_tp:r.rr_to_tp,
          support_context:r.current_zones.filter(z=>!z.opposes).map(z=>({id:z.id,role:z.role,directional_role:z.directional_role})),obstacles:r.obstacles_before_tp.length}];})),
        contact:audit.contact};
      results.push(result);console.log(JSON.stringify(result));
      if(full.status!==200||priority.status!==200)throw new Error('Recorded API contract regressed');
    }
  }
  writeFileSync(`${root}/recorded-contracts.json`,JSON.stringify({provenance:'Recorded real DEMO snapshots; local service handlers, not production/live quotes',results},null,2));
}
void main();
