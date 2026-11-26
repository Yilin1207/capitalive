import type {Timeframe} from '../candle-data';
import {TF_ORDER} from '../knowledge/detectors';
import {INSTRUMENTS, type AnalysisSymbol} from '../technical-analysis';
import {atrD1, ATR_D1_PERIOD} from './brief-facts';
import type {PaEngine, PaEvidence} from './core';

type Swing = PaEngine['market_structure'][string]['swing_sequence'][number];
type Bounds = {lower:number; upper:number};
type Level = Bounds & {e:PaEvidence};
type Side = 'above' | 'below';
const round = (n:number) => Number(n.toFixed(10));
const laterFirst = (a:{confirmed_at:string; id:string}, b:{confirmed_at:string; id:string}) =>
  b.confirmed_at.localeCompare(a.confirmed_at) || a.id.localeCompare(b.id);

function byTf<T>(f:(tf:Timeframe) => T, order:Timeframe[]=TF_ORDER):Record<Timeframe,T> {
  return Object.fromEntries(order.map(tf => [tf,f(tf)])) as Record<Timeframe,T>;
}

function segmentAt(core:PaEngine, tf:Timeframe, at:string) {
  return core.frames[tf].ohlc.findLast(b => b.end <= at)?.segment;
}

function swingsAt(core:PaEngine, tf:Timeframe, at:string) {
  const segment = segmentAt(core,tf,at);
  return core.market_structure[tf].swing_sequence
    .filter(p => p.segment === segment && p.confirmed_at <= at).sort(laterFirst);
}

/** Q9. Swing boundaries describe structure. Their current liquidity state is independent.
 * At a historical cutoff, only bars and pivots available by that cutoff participate. */
export function activeThesisRange(core:PaEngine, tf:Timeframe, at:string, price:number) {
  if (!Number.isFinite(price) || at > core.as_of || core.frames[tf].range_selection_error) return null;
  const swings = swingsAt(core,tf,at);
  const explicit = core.dealing_ranges.find(d => d.timeframe === tf)?.explicit_range;
  const pair = (high:Swing|undefined, low:Swing|undefined, selection:'EXPLICIT_IDS'|'Q9_LAST_ENCLOSING_SWINGS') => {
    if (!high || !low || high.confirmed_at === low.confirmed_at || high.price <= low.price ||
        high.price < price || low.price > price) return null;
    const confirmed_at = high.confirmed_at > low.confirmed_at ? high.confirmed_at : low.confirmed_at;
    if (core.frames[tf].ohlc.some(b => b.segment === high.segment && b.end >= confirmed_at && b.end <= at &&
        (b.close < low.price || b.close > high.price))) return null;
    const eq = round((high.price + low.price)/2);
    const position = price < eq ? 'DISCOUNT' as const : price > eq ? 'PREMIUM' as const : 'EQ' as const;
    return {timeframe:tf, low:low.price, high:high.price, eq, low_id:low.id, high_id:high.id,
      confirmed_at, selection, position, zone:position, price_position_pct:round(100*(price-low.price)/(high.price-low.price))};
  };
  // An unavailable, broken or out-of-segment user selection cannot be substituted with a different pair.
  if (explicit) {
    if (explicit.confirmed_at > at) return null;
    return pair(swings.find(p => p.id === explicit.high_id && p.polarity === 'high'),
      swings.find(p => p.id === explicit.low_id && p.polarity === 'low'),'EXPLICIT_IDS');
  }
  return pair(swings.find(p => p.polarity === 'high' && p.price >= price),
    swings.find(p => p.polarity === 'low' && p.price <= price),'Q9_LAST_ENCLOSING_SWINGS');
}

export type ActiveRange = NonNullable<ReturnType<typeof activeThesisRange>> & {htf_priority:boolean};

export function thesisRanges(core:PaEngine) {
  const ref = core.frames.H4.ohlc.findLast(b => b.end <= core.as_of);
  const ranges = byTf(tf => ref ? activeThesisRange(core,tf,core.evaluated_through,ref.close) : null);
  const priority_tf = TF_ORDER.find(tf => ranges[tf]) ?? null;
  const active_dr = byTf<ActiveRange|null>(tf => ranges[tf] && {...ranges[tf],htf_priority:tf === priority_tf});
  return {active_dr,priority_tf};
}

function currentLevels(core:PaEngine, at:string) {
  const order = Object.values(core.frames).map(frame => frame.timeframe);
  const segments = byTf(tf => segmentAt(core,tf,at),order);
  const confirmations = byTf(tf => new Set(core.frames[tf].ohlc.filter(b => b.segment === segments[tf] && b.end <= at).map(b => b.end)),order);
  const levels:Level[] = [];
  for (const e of core.evidence) {
    const s = e.lifecycle;
    if (!['FRACTAL','FVG','SNR_CLOSED_BREAK','RB_TWO_CANDLE'].includes(e.kind) || !s ||
        e.formation_status !== 'CONFIRMED' || !confirmations[e.timeframe]?.has(e.confirmed_at) ||
        s.evaluated_through !== at || s.coverage !== 'COMPLETE_OBSERVED_INTERVAL' ||
        s.liquidity_consumed || s.invalidated_at || (e.current_role && e.current_role !== e.formation_role)) continue;
    // A test leaves an RB or SNR eligible until a strict own-timeframe close breaks it.
    const formedZone = e.kind === 'RB_TWO_CANDLE' || e.kind === 'SNR_CLOSED_BREAK';
    if (s.state !== 'ACTIVE' && !(formedZone && s.state === 'TESTED')) continue;
    const fvg = e.kind === 'FVG';
    if (fvg && (!s.fill || !['UNTOUCHED','TOUCHED','PARTIAL'].includes(s.fill.state) || s.fill.max_observed_fraction >= 1)) continue;
    const b = fvg ? e.remaining_bounds : e.bounds;
    if (b && Number.isFinite(b.lower) && Number.isFinite(b.upper) && b.lower > 0 &&
        (fvg ? b.upper > b.lower : b.upper >= b.lower)) levels.push({e,...b});
  }
  return levels;
}

/** The origin is the middle candle of a confirmed Fractal3, not the first evidence candle.
 * Start tracking extremes on the next candle because OHLC does not order the two wicks of the origin. */
function lastImpulse(core:PaEngine, tf:Timeframe, at:string) {
  const swings = swingsAt(core,tf,at);
  const p = swings[0];
  if (!p || swings[1]?.confirmed_at === p.confirmed_at) return null;
  const bars = core.frames[tf].ohlc;
  const right = bars.findIndex(b => b.end === p.confirmed_at);
  if (right < 1) return null;
  const leg = bars.slice(right).filter(b => b.segment === p.segment && b.end <= at);
  const low = p.polarity === 'low';
  if (!leg.length || leg.some(b => low ? b.low < p.price : b.high > p.price)) return null;
  const field = low ? 'high' : 'low';
  const extreme = leg.reduce((best,b) => (low ? b[field] > best[field] : b[field] < best[field]) ? b : best);
  if (low ? extreme.high <= p.price : extreme.low >= p.price) return null;
  const origin = {id:p.id, polarity:p.polarity, price:p.price, at:bars[right-1].time, confirmed_at:p.confirmed_at};
  return {origin, extreme:extreme[field], extreme_at:extreme.end, midpoint:round((p.price + extreme[field])/2)};
}

const LIMIT = 3;
function bounded<T>(items:T[], limit = LIMIT) {
  return {items:items.slice(0,limit), total:items.length, omitted:Math.max(0,items.length-limit)};
}

function relatedLevels(levels:Level[], test:(level:Level) => boolean) {
  return bounded(levels.filter(test).sort((a,b) => TF_ORDER.indexOf(a.e.timeframe)-TF_ORDER.indexOf(b.e.timeframe)
    || laterFirst(a.e,b.e)).map(z => z.e.id));
}

function idm(core:PaEngine, tf:Timeframe, at:string|null, range:ReturnType<typeof activeThesisRange>, levels:Level[], evidence:Map<string,PaEvidence>) {
  const order = Object.values(core.frames).map(frame => frame.timeframe);
  const child = order[order.indexOf(tf)+1];
  const zones = levels.filter(l => l.e.timeframe === tf && l.upper > l.lower && l.e.kind !== 'FRACTAL');
  const members = [];
  for (const source of child ? [tf,child] : [tf]) {
    for (const p of at ? swingsAt(core,source,at) : []) {
      const e = evidence.get(p.id);
      if (!e) continue;
      const inside = !!range && range.low < p.price && p.price < range.high;
      const containers = relatedLevels(zones,z => source === child && z.e.confirmed_at <= p.origin && z.lower < p.price && p.price < z.upper);
      if (!inside && !containers.total) continue;
      members.push({id:p.id, polarity:p.polarity, price:p.price, confirmed_at:p.confirmed_at,
        tf_relation:source === tf ? 'X' as const : 'X-1' as const, inside_active_dr:inside,
        inside_kl:containers.items, inside_kl_omitted:containers.omitted, state:e.lifecycle?.state ?? 'UNVERIFIED'});
    }
  }
  return members.sort(laterFirst);
}

/** Unabridged rows for the same TF and immediate child reported in execution.idm[tf]. */
export function idmItems(core:PaEngine,tf:Timeframe) {
  const ref = (tf==='H1'?core.frames.H1:core.frames.H4).ohlc.findLast(b => b.end <= core.as_of);
  if (!ref) return [];
  const at = core.evaluated_through;
  const range = activeThesisRange(core,tf,at,ref.close);
  return idm(core,tf,at,range,currentLevels(core,at),new Map(core.evidence.map(e => [e.id,e])));
}

type Feature = Bounds & {id:string; kind:string; timeframe:Timeframe; confirmed_at:string; near?:number; far?:number};
function nearest<T extends Feature>(features:T[], price:number|null, side:Side) {
  if (price === null) return null;
  const candidates = features.filter(f => side === 'above' ? f.lower > price : f.upper < price);
  return candidates.sort((a,b) => (side === 'above' ? a.lower-b.lower : b.upper-a.upper) || laterFirst(a,b))[0] ?? null;
}

/** Every distance is to the near boundary measured from the last closed H4 close. */
export function thesisLocation(core:PaEngine) {
  const ref = core.frames.H4.ohlc.findLast(b => b.end <= core.as_of);
  const at = ref ? core.evaluated_through : null, price = ref?.close ?? null;
  const reference = ref ? {at:ref.end,price:ref.close,basis:'LAST_CLOSED_H4_CLOSE' as const} : null;
  const ranges = thesisRanges(core);
  const levels = at ? currentLevels(core,at) : [];
  const daily = core.frames.D1.ohlc.filter(b => at && b.end <= at);
  const recent = daily.slice(-ATR_D1_PERIOD-1);
  const atr_d1 = recent.every(b => b.segment === recent[0].segment)
    ? atrD1({frames:{...core.frames,D1:{...core.frames.D1,ohlc:recent}}}) : null;
  const unit = INSTRUMENTS[core.symbol as AnalysisSymbol] ?? {unit:'price',unit_size:1};
  const impulses = byTf(tf => at ? lastImpulse(core,tf,at) : null);
  const levelFeatures = levels.map(({e,lower,upper}) => ({
    id:e.id,kind:e.kind,timeframe:e.timeframe,confirmed_at:e.confirmed_at,lower,upper,state:e.lifecycle!.state,
    ...(e.kind === 'SNR_CLOSED_BREAK' && typeof e.facts.near === 'number' && typeof e.facts.far === 'number'
      ? {near:e.facts.near,far:e.facts.far} : {})
  }));
  const distance = (row:Feature, side:Side) => {
    const closest = side === 'above' ? row.lower : row.upper, opposite = side === 'above' ? row.upper : row.lower;
    const gap = Math.abs(closest - price!);
    return {id:row.id,kind:row.kind,confirmed_at:row.confirmed_at,near:row.near ?? closest,far:row.far ?? opposite,distance_points:round(gap/unit.unit_size),
      distance_atr_d1:atr_d1 && atr_d1.value > 0 ? round(gap/atr_d1.value) : null};
  };
  const nearest_kl = byTf(tf => {
    const own = levelFeatures.filter(e => e.timeframe === tf);
    const select = (side:Side) => {
      const row = nearest(own,price,side);
      if (!row) return null;
      const containers = relatedLevels(levels,z => TF_ORDER.indexOf(z.e.timeframe) < TF_ORDER.indexOf(tf) &&
        z.e.kind !== 'FRACTAL' && z.lower <= row.lower && row.upper <= z.upper);
      return {...distance(row,side), state:row.state, nested_in:containers.items, nested_in_omitted:containers.omitted};
    };
    return {above:select('above'),below:select('below')};
  });
  const obstacles = byTf(tf => {
    const candidates:Feature[] = levelFeatures.filter(e => e.timeframe === tf && (e.kind === 'FVG' || e.kind === 'FRACTAL'));
    const impulse = impulses[tf];
    if (impulse) candidates.push({kind:'IMPULSE_0_5', id:impulse.origin.id, timeframe:tf,
      confirmed_at:impulse.extreme_at,lower:impulse.midpoint,upper:impulse.midpoint});
    const select = (side:Side) => {
      const row = nearest(candidates,price,side);
      return row ? distance(row,side) : null;
    };
    return {above:select('above'),below:select('below')};
  });
  const evidence = new Map(core.evidence.map(e => [e.id,e]));
  return {
    location:{reference, ...ranges,
      nearest_kl, midpoints:{W1:impulses.W1,D1:impulses.D1}, atr_d1,
      distance_unit:{name:unit.unit, price_per_unit:unit.unit_size}},
    execution:{idm:byTf(tf => bounded(idm(core,tf,at,ranges.active_dr[tf],levels,evidence))),
      movement_origins:byTf(tf => impulses[tf]?.origin ?? null), obstacles}
  };
}
