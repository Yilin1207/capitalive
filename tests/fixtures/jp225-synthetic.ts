// Generated synthetic integration data, not broker OHLC or an expert golden label.
import {HISTORY,type Candle,type CandleResponse,type Timeframe} from '../../lib/candle-data';
import {historyDiagnostics} from '../../lib/history-diagnostics';import {unavailable} from '../../lib/quote-normalization';
export function syntheticMarket(symbol:string){
 const epic=symbol==='JP225'?'J225':symbol==='NAS100'?'US100':symbol;
 const scale=symbol==='EURUSD'?0.00003:symbol==='EU50'?0.15:symbol==='NAS100'?0.7:1;
 const asOf='2026-11-15T14:00:00.000Z',now=Date.parse(asOf),data={} as Record<Timeframe,CandleResponse>;
 for(const tf of ['MN1','W1','D1','H4'] as const){
  const end=tf==='W1'?Date.UTC(2026,10,9):tf==='D1'?Date.UTC(2026,10,15):Date.UTC(2026,10,15,12);
  const candles:Candle[]=Array.from({length:20},(_,i)=>{
   const time=tf==='MN1'?Date.UTC(2025,3+i,1):end-(20-i)*HISTORY[tf].seconds*1000;
   const value=Math.round((40000+i*7+Math.sin(i*1.2)*80)*10)/10,price=(p:number)=>({bid:Number((p*scale).toFixed(5)),ask:Number(((p+10)*scale).toFixed(5))});
   return {time:new Date(time).toISOString(),open:price(value-3),high:price(value+12),low:price(value-12),close:price(value+3),is_closed:true,...(tf==='MN1'?{end_time:new Date(Date.UTC(2025,4+i,1)).toISOString(),history_completeness:'unknown_sessions_not_verified' as const}:{} )};
  });
  data[tf]={ok:true,symbol,epic,timeframe:tf,provider:'Capital.com',environment:'demo',price_side:'bid_ask',fetched_at:asOf,candles,
   metadata:{requested:20,returned:20,available:20,insufficient_history:false,discarded_rows:0,discarded_sides:0,discarded_reasons:{invalid_time:0,future_time:0,no_valid_side:0,crossed_sides:0},duplicate_rows:0,validation_gaps:[],time_semantics:tf==='MN1'?'calendar_month_start_utc':'provider_bar_start_utc',closure_basis:tf==='MN1'?'calendar_month_end_elapsed_at_fetch':'successor_or_nominal_interval_elapsed_at_fetch',cache_ttl_seconds:30,cache_hit:false,diagnostics:historyDiagnostics({provider_rows:20,provider_times:candles.map(c=>c.time),rejected:[]},candles,tf,now,now,30)}};
 }
 const quote={...unavailable(symbol,epic),bid:40010*scale,ask:40020*scale,mid:40015*scale,provider_timestamp:asOf,quote_time:asOf,retrieved_at:asOf,fetched_at_utc:asOf,environment:'demo' as const,fresh:true,market_status:'TRADEABLE',delay_seconds:0};
 return {data,quote,asOf};
}

export const jp225Synthetic=()=>syntheticMarket('JP225');
