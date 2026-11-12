import { ANALYSIS_TIMEFRAMES } from './technical-analysis';
import type { PriceSide } from './candle-data';
import type { CatalogEntry } from './htf-zone-catalog';

export type DirectionalRole = 'support' | 'resistance' | 'provisional_support' | 'provisional_resistance' | 'neutral';
export type RoleClassification = DirectionalRole | 'conflicted';

/** Role comes from evidence, never from which side of the current quote a band occupies. */
export function directionalRole(z: CatalogEntry): DirectionalRole {
  if (!z.significant || z.data_reliability.status === 'UNVERIFIED' || z.break_status === 'unknown_after_gap') return 'neutral';
  if (z.type === 'SNR' && z.provisional_role && ['pending','confirmed'].includes(z.break_status)) return `provisional_${z.provisional_role}`;
  return z.role === 'support' || z.role === 'resistance' ? z.role : 'neutral';
}

export function classifyObstacles(zones: CatalogEntry[], direction: 'long'|'short', entry: number, tp: number|null, adjustment: number, priceSide: PriceSide) {
  const long=direction==='long', opposing=long?'resistance':'support';
  const significant=zones.filter(z=>z.significant);
  const described=significant.map(z=>{
    const role=directionalRole(z), underlying=role.replace('provisional_','');
    const conflicts=underlying==='neutral'?[]:significant.filter(p=>p.id!==z.id && p.timeframe!==z.timeframe && p.lower<=z.upper && p.upper>=z.lower &&
      directionalRole(p)!=='neutral' && directionalRole(p).replace('provisional_','')!==underlying).map(p=>p.id);
    const lower=z.lower+adjustment,upper=z.upper+adjustment;
    const position=entry<lower?'above':entry>upper?'below':'inside';
    const classification:RoleClassification=conflicts.length?'conflicted':role;
    const origin=z.origin as {time?:string;formed_at?:string;confirmed_at?:string}|null;
    return {id:z.id,source_id:z.source_id,timeframe:z.timeframe,type:z.type,direction,role:z.role,provisional_role:z.provisional_role??null,
      role_reversal_confirmed:z.role_reversal_confirmed??false,directional_role:role,classification,
      confirmation:role==='neutral'?'unverified':role.startsWith('provisional_')?'provisional':'established_by_rules',
      break_status:z.break_status,source_bounds:{lower:z.lower,upper:z.upper},lower,upper,position,price_side:priceSide,
      side_conversion:adjustment===0?'none':'current_spread_approximation',
      evidence_at:(role.startsWith('provisional_')?z.provisional_at:null)??z.role_confirmed_at??origin?.confirmed_at??origin?.formed_at??origin?.time??z.last_test,
      evidence_time_basis:z.type==='FVG'?'formation_bar_start; confirmed_status_observed_in_snapshot':'closed_confirmation_time_when_available_else_origin',
      conflict_count:conflicts.length,opposes:underlying===opposing,
      reason:role==='neutral'?'ROLE_UNVERIFIED':role.startsWith('provisional_')?'POST_BREAK_POTENTIAL_ROLE_NOT_CONFIRMED_REVERSAL':z.type==='FVG'?'MATERIAL_DIRECTIONAL_RESIDUAL_FVG':z.type==='FRACTAL'?'CONFIRMED_UNSWEPT_LIQUIDITY':z.type==='ORDER_BLOCK'||z.type==='BREAKER'?'ACTIVE_DIRECTIONAL_STRUCTURE_ZONE':'ESTABLISHED_SNR_ROLE',
    };
  });
  const ahead=described.filter(z=>z.opposes && (long?z.upper>=entry:z.lower<=entry))
    .map(z=>({...z,price:long?Math.max(entry,z.lower):Math.min(entry,z.upper)}))
    .sort((a,b)=>Math.abs(a.price-entry)-Math.abs(b.price-entry)||ANALYSIS_TIMEFRAMES.indexOf(a.timeframe)-ANALYSIS_TIMEFRAMES.indexOf(b.timeframe)||a.id.localeCompare(b.id));
  const before=ahead.filter(z=>tp===null || Math.abs(z.price-entry)<Math.abs(tp-entry));
  return {first:before[0]??null,before_tp:before,current_zones:described.filter(z=>z.position==='inside'),
    uncertain_zones:described.filter(z=>z.directional_role==='neutral'),
    beyond_or_at_tp:ahead.filter(z=>!before.includes(z)).map(z=>z.id)};
}
