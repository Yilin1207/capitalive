import type {buildIntelligence} from './intelligence';
import type {Frame} from './data';
import type {Timeframe} from '../candle-data';
import {TF_ORDER} from './detectors';

/** Explicit, protected, snapshot-pinned inspection. Never a Bridge publication payload. */
export function inspectResearch(r:ReturnType<typeof buildIntelligence>,frames:Record<Timeframe,Frame>,offset:number,limit:number,timeframe?:Timeframe) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('INVALID_INSPECTION_PAGE');
  const universe=r.frames.filter(f=>!timeframe||f.timeframe===timeframe).flatMap(f=>f.findings).sort((a,b)=>TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe)||a.confirmed_at.localeCompare(b.confirmed_at)||a.id.localeCompare(b.id));
  const findings=universe.slice(offset,offset+limit),ids=new Set(findings.map(f=>f.id));
  const windows=TF_ORDER.flatMap(tf=>{const times=new Set(findings.filter(f=>f.timeframe===tf).flatMap(f=>f.candle_evidence.map(c=>c.time)));
    return frames[tf].bars.filter(b=>times.has(b.time)&&b.end<=r.as_of).map(b=>({timeframe:tf,time:b.time,closed_at:b.end,open:b.open,high:b.high,low:b.low,close:b.close}));});
  return {schema_version:'research-inspection-v1',symbol:r.symbol,environment:r.environment,provider:'Capital.com',price_side:r.price_side,as_of:r.as_of,evidence_sha256:r.narrative.human_review.evidence_sha256,
    source_revision:r.knowledge.catalog_revision,offset,limit,total:universe.length,returned:findings.length,next_offset:offset+findings.length<universe.length?offset+findings.length:null,
    findings,level_reviews:r.research_context.levels.filter(l=>ids.has(l.id)),
    closed_ohlc_windows:windows,ohlc_scope:'FORMATION_WINDOWS_FOR_THIS_PAGE',publication_allowed:false,trading_enabled:false};
}
