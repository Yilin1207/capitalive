import {readFileSync,writeFileSync} from 'node:fs';
import {ANALYSIS_SYMBOLS,ANALYSIS_TIMEFRAMES} from '../lib/technical-analysis';
import {marketAudit} from '../lib/market-audit';
import {htfZones} from '../lib/htf-http';
import type {CandleResponse,Timeframe} from '../lib/candle-data';
import type {MarketQuote} from '../lib/quote-normalization';
import {prepareHtfBars} from '../lib/htf-data-quality';

async function main(){
const results=[];
for(const asset of ANALYSIS_SYMBOLS){
  const f=JSON.parse(readFileSync(`tests/fixtures/htf-${asset}.json`,'utf8')) as {data:Record<Timeframe,CandleResponse>;quote:MarketQuote};
  const original=JSON.parse(readFileSync(`verification/capitalive-v2-1/baseline-${asset}-audit.json`,'utf8'));
  for(const tf of ANALYSIS_TIMEFRAMES)if(JSON.stringify(f.data[tf].candles)!==JSON.stringify(original.structure[tf].candles))throw new Error(`Provenance mismatch ${asset} ${tf}`);
  const deps={getCandles:async(_s:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>({...f.quote,cache_hit:false,evaluated_at:f.data.H4.fetched_at})};
  for(const side of ['bid','ask'] as const){
    const full=await marketAudit(new Request(`https://local/api/market-audit?symbol=${asset}&side=${side}&include_candles=1`),deps);
    const fullText=await full.text(),body=JSON.parse(fullText);
    const priority=await htfZones(new Request(`https://local/api/htf-zones?symbol=${asset}&side=${side}&view=priority`),deps);
    const priorityText=await priority.text();
    if(full.status!==200||priority.status!==200)throw new Error(`HTTP service contract failed ${asset} ${side}`);
    const z=asset==='NAS100'?body.htf.snr.W1.zones.find((z:{origin:{price:number}})=>z.origin.price===(side==='bid'?28184.7:f.data.W1.candles.find(c=>c.time==='2026-06-08T00:00:00.000Z')!.low.ask)):undefined;
    const closed=prepareHtfBars(f.data.W1,side).bars,nov=closed.findIndex(b=>b.time==='2026-11-02T00:00:00.000Z');
    results.push({asset,side,input_matches_recorded_http:true,full_status:full.status,full_bytes:Buffer.byteLength(fullText),priority_status:priority.status,priority_bytes:Buffer.byteLength(priorityText),
      full_snr_count:body.htf.priority_zones.full_snr_count,priority_count:body.htf.priority_zones.selected_count,
      by_timeframe:Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf=>[tf,{all:body.htf.snr[tf].all_zone_count,tested:body.htf.snr[tf].zones.filter((z:{status:string})=>z.status==='tested').length,priority:body.htf.priority_zones.zones.filter((z:{timeframe:string})=>z.timeframe===tf).length}])),
      nas100_focus:z?{id:z.id,lower:z.lower,upper:z.upper,status:z.status,break_status:z.break_status,role:z.role,provisional_role:z.provisional_role,states:z.evidence.events,
        selected_in_priority:body.htf.priority_zones.zones.some((p:{id:string})=>p.id===z.id),november_bar:closed[nov],preceding_atr:closed[nov-1]?.atr}:null,
      risk:body.htf.risk,probability:null});
  }
}
writeFileSync('verification/capitalive-v2-1/final-contracts.json',JSON.stringify({source:'Local HTTP service functions with recorded real fixtures; not new deployment',results},null,2));
console.log(JSON.stringify(results.map(r=>({asset:r.asset,side:r.side,full_bytes:r.full_bytes,priority_bytes:r.priority_bytes,full_snr:r.full_snr_count,priority:r.priority_count,nas100_focus:r.nas100_focus?{lower:r.nas100_focus.lower,upper:r.nas100_focus.upper,break_status:r.nas100_focus.break_status,selected:r.nas100_focus.selected_in_priority}:undefined}))));
}
void main();
