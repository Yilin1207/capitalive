import type {buildIntelligence} from './intelligence';
import type {Frame} from './data';
import type {Timeframe} from '../candle-data';
import {TF_ORDER} from './detectors';
import {validatePathCompleteness} from './research-context';

/** Explicit, protected, snapshot-pinned inspection. Never a Bridge publication payload. */
export function inspectResearch(r:ReturnType<typeof buildIntelligence>,frames:Record<Timeframe,Frame>,offset:number,limit:number,timeframe?:Timeframe) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('INVALID_INSPECTION_PAGE');
  const universe=r.frames.filter(f=>!timeframe||f.timeframe===timeframe).flatMap(f=>f.findings).sort((a,b)=>TF_ORDER.indexOf(a.timeframe)-TF_ORDER.indexOf(b.timeframe)||a.confirmed_at.localeCompare(b.confirmed_at)||a.id.localeCompare(b.id));
  const findings=universe.slice(offset,offset+limit),ids=new Set(findings.map(f=>f.id));
  const windows=TF_ORDER.flatMap(tf=>{const times=new Set(findings.filter(f=>f.timeframe===tf).flatMap(f=>f.candle_evidence.map(c=>c.time)));
    return frames[tf].bars.filter(b=>times.has(b.time)&&b.end<=r.as_of).map(b=>({timeframe:tf,time:b.time,closed_at:b.end,open:b.open,high:b.high,low:b.low,close:b.close}));});
  return {schema_version:'research-inspection-v1',symbol:r.symbol,environment:r.environment,provider:'Capital.com',price_side:r.price_side,as_of:r.as_of,evidence_sha256:r.narrative.human_review.evidence_sha256,
    source_revision:r.knowledge.catalog_revision,offset,limit,total:universe.length,returned:findings.length,next_offset:offset+findings.length<universe.length?offset+findings.length:null,
    dealing_ranges:r.frames.filter(f=>!timeframe||f.timeframe===timeframe).map(f=>({timeframe:f.timeframe,...f.dr_detection})),
    findings,level_reviews:r.research_context.levels.filter(l=>ids.has(l.id)).map(l=>{
      const from=r.data_quality.reference_price,inside=from!==null&&from>=l.lower&&from<=l.upper;
      const to=from===null?null:from<l.lower?l.lower:from>l.upper?l.upper:from;
      return {...l,approach_path:{basis:'LAST_CLOSED_H4_TO_NEAREST_ZONE_BOUNDARY',reference_inside:inside,
        reason:inside?'REFERENCE_ALREADY_INSIDE_ZONE':'APPROACH_REQUIRES_OBSTACLE_REVIEW',
        validation:inside?null:validatePathCompleteness(r.levels.detected_levels,r.levels.states,frames,from,to,[l.id]),
        free_path_proven:false}};
    }),
    closed_ohlc_windows:windows,ohlc_scope:'FORMATION_WINDOWS_FOR_THIS_PAGE',publication_allowed:false,trading_enabled:false};
}
