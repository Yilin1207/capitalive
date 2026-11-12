import type { MarketQuote } from './quote-normalization';
import type { PriceSide } from './candle-data';
import type { CatalogEntry } from './htf-zone-catalog';
import { ANALYSIS_TIMEFRAMES } from './technical-analysis';

/** A point-in-time quote observation is never a closed retest or an emitted alert. */
export function observeHtfContact(quote:MarketQuote,side:PriceSide,catalog:readonly CatalogEntry[],now=Date.now()){
  const price=quote[side],time=quote.quote_time?Date.parse(quote.quote_time):NaN;
  const eligible=quote.fresh && quote.provider_timestamp_available!==false && Number.isFinite(time) && now-time>=0 && now-time<=300_000 &&
    price!==null && Number.isFinite(price) && price>0 && (quote.source_type==='WEBSOCKET'||quote.delay_seconds===0);
  // Contact coverage is independent of UI ranking/capacity and preserves overlapping source IDs.
  const snr=catalog.filter(z=>z.type==='SNR');
  const candidates=snr.filter(z=>z.significant && z.status==='tested' && z.data_reliability.status!=='UNVERIFIED' && z.break_status!=='unknown_after_gap');
  const hits=eligible?candidates.filter(z=>price!>=z.lower&&price!<=z.upper)
    .sort((a,b)=>ANALYSIS_TIMEFRAMES.indexOf(a.timeframe)-ANALYSIS_TIMEFRAMES.indexOf(b.timeframe)||a.id.localeCompare(b.id))
    .map(z=>({id:z.id,source_id:z.source_id,timeframe:z.timeframe,lower:z.lower,upper:z.upper,role:z.role,provisional_role:z.provisional_role??null,
      status:z.status,significant:z.significant,data_reliability:z.data_reliability,break_status:z.break_status,
      role_reversal_confirmed:z.role_reversal_confirmed??false,provisional_at:z.provisional_at??null,role_confirmed_at:z.role_confirmed_at??null,
      state:'IN_ZONE',closed_retest_confirmed:false})):[];
  return {eligible,quote_time:quote.quote_time,evaluated_at:new Date(now).toISOString(),price_side:side,
    state:eligible?'FRESH_QUOTE_OBSERVATION':'UNVERIFIED_OR_STALE_QUOTE',alerts_emitted:false,
    zones:hits,contact_hits:hits,hit_count:hits.length,
    coverage:{source:'full_catalog_significant_snr_before_priority_selection',total_snr:snr.length,eligible_candidates:candidates.length,
      excluded_by_policy:snr.length-candidates.length,priority_cap_applied:false,merged_or_omitted_hits:0,
      policy:'SNR only; significant AND tested; reliability other than UNVERIFIED; no unknown_after_gap. Watch and unverified candidates remain in full catalog, not confirmed contact hits.'},
    interpretation:'Point-in-time contact only; not a crossing event, confirmed retest, role reversal or live trading alert. DEMO remains DEMO.'};
}
