import type { MarketQuote } from './quote-normalization';
import type { PriceSide } from './candle-data';
import type { PriorityZones } from './htf-priority';

/** A point-in-time quote observation is never a closed retest or an emitted alert. */
export function observeHtfContact(quote:MarketQuote,side:PriceSide,priority:PriorityZones,now=Date.now()){
  const price=quote[side],time=quote.quote_time?Date.parse(quote.quote_time):NaN;
  const eligible=quote.fresh && quote.provider_timestamp_available!==false && Number.isFinite(time) && now-time>=0 && now-time<=300_000 &&
    price!==null && Number.isFinite(price) && price>0 && (quote.source_type==='WEBSOCKET'||quote.delay_seconds===0);
  return {eligible,quote_time:quote.quote_time,evaluated_at:new Date(now).toISOString(),price_side:side,
    state:eligible?'FRESH_QUOTE_OBSERVATION':'UNVERIFIED_OR_STALE_QUOTE',alerts_emitted:false,
    zones:eligible?priority.zones.filter(z=>price!>=z.lower&&price!<=z.upper).map(z=>({id:z.id,state:'IN_ZONE',closed_retest_confirmed:false})):[],
    interpretation:'Point-in-time contact only; not a crossing event, confirmed retest, role reversal or live trading alert. DEMO remains DEMO.'};
}
