import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPaEngine, type PaEvidence} from '../lib/pa-engine/core';
import {activeThesisRange, idmItems, thesisLocation, thesisRanges} from '../lib/pa-engine/thesis-location';
import {TF_ORDER} from '../lib/knowledge/detectors';
import type {Timeframe} from '../lib/candle-data';
import {syntheticMarket} from './fixtures/jp225-synthetic';

const time = (i: number) => new Date(Date.UTC(2026, 0, 1, i * 4)).toISOString();

function fixture() {
  const core = buildPaEngine(syntheticMarket('NAS100').data, 'bid');
  const example = core.evidence.find(e => e.kind === 'FRACTAL' && e.lifecycle)!;
  const bars = Array.from({length:20}, (_, i) => ({
    index:i, segment:0, time:time(i), end:time(i + 1), open:100, close:100, high:104, low:96
  }));
  core.as_of = core.evaluated_through = time(20);
  core.evidence = [];
  for (const tf of TF_ORDER) {
    core.market_structure[tf].swing_sequence = [];
    core.frames[tf].ohlc = structuredClone(bars);
    core.dealing_ranges.find(d => d.timeframe === tf)!.explicit_range = null;
  }
  const add = (tf: Timeframe, kind: string, suffix: string, lo: number, hi: number, i: number) => {
    const e:PaEvidence = {...structuredClone(example), id:`NAS100:${tf}:bid:${kind}:${suffix}`,
      kind, timeframe:tf, origin:time(i - 1), confirmed_at:time(i + 2), evaluated_through:time(20),
      facts:{}, formation_status:'CONFIRMED', formation_role:'support', current_role:null,
      bounds:{lower:lo, upper:hi}, remaining_bounds:{lower:lo, upper:hi},
      candle_evidence:bars.slice(i - 1, i + 2).map(b => ({...b, closed_at:b.end})),
      lifecycle:{...example.lifecycle!, state:'ACTIVE', coverage:'COMPLETE_OBSERVED_INTERVAL', liquidity_consumed:false,
        invalidated_at:null, role_status:'ORIGINAL_GEOMETRY', confirmed_at:time(i + 2), evaluated_through:time(20),
        fill:kind === 'FVG' ? {state:'UNTOUCHED', max_observed_fraction:0, first_test_at:null, last_test_at:null} : null}
    };
    core.evidence.push(e);
    return e;
  };
  const pivot = (tf:Timeframe, polarity:'low'|'high', price:number, i:number, segment = 0) => {
    const e = add(tf, 'FRACTAL', polarity + i, price, price, i);
    e.facts = {price, polarity, pivot_time:time(i), variant:3};
    core.market_structure[tf].swing_sequence.push({id:e.id, price, polarity, segment, origin:e.origin,
      confirmed_at:e.confirmed_at, relation:'FIRST_OBSERVED'});
    return e;
  };
  return {core, pivot, add};
}

test('Q9 uses the most recent enclosing confirmed high and low as of the requested close', () => {
  const {core, pivot} = fixture();
  const low = pivot('W1','low',80,2);
  pivot('W1','high',150,4);
  const high = pivot('W1','high',120,8);
  pivot('W1','low',105,10);
  pivot('W1','high',130,18);
  assert.equal(activeThesisRange(core,'W1',time(4),100), null);
  const r = activeThesisRange(core,'W1',time(12),100)!;
  assert.equal(r.low_id,low.id);
  assert.equal(r.high_id,high.id);
  assert.equal(r.eq,100);
  assert.equal(r.position,'EQ');
  assert.equal(r.price_position_pct,50);
  assert.equal(thesisLocation(core).location.priority_tf, 'W1');
  core.frames.W1.ohlc.at(-1)!.segment = 1;
  assert.equal(activeThesisRange(core,'W1',time(20),100),null);
});

test('a valid explicit pair wins, a later closed break withdraws it, and an outside bar cannot supply an ordered leg', () => {
  const {core, pivot} = fixture();
  const low = pivot('D1','low',90,2), high = pivot('D1','high',130,4);
  pivot('D1','high',140,7);
  core.dealing_ranges.find(d => d.timeframe === 'D1')!.explicit_range = {
    timeframe:'D1', low_id:low.id, high_id:high.id, lower:90, upper:130, equilibrium:110,
    confirmed_at:high.confirmed_at, origin:low.origin, segment:0
  };
  assert.equal(activeThesisRange(core,'D1',time(10),100)?.selection,'EXPLICIT_IDS');
  assert.equal(activeThesisRange(core,'D1',time(10),100)?.high_id,high.id);
  core.frames.D1.ohlc[12].close = 135;
  assert.equal(activeThesisRange(core,'D1',time(20),100),null);
  pivot('H4','high',105,10);
  pivot('H4','low',95,10);
  assert.equal(activeThesisRange(core,'H4',time(20),100),null);
  assert.equal(thesisLocation(core).execution.movement_origins.H4,null);
});

test('current levels use remaining FVG bounds, strict lifecycle eligibility, distance and live higher-TF containment', () => {
  const {core, add, pivot} = fixture();
  const parent = add('W1','FVG','wide',100,130,2);
  const fvg = add('D1','FVG','remainder',101,112,3);
  fvg.remaining_bounds = {lower:105, upper:112};
  fvg.lifecycle!.fill!.state = 'PARTIAL';
  fvg.lifecycle!.fill!.max_observed_fraction = 4/11;
  add('D1','FVG','unknown',101,102,4).lifecycle!.fill!.state = 'UNKNOWN';
  add('D1','FVG','filled',102,103,5).lifecycle!.fill!.state = 'FILLED';
  add('D1','RB_TWO_CANDLE','reversed',102,102,6).current_role = 'resistance';
  pivot('D1','high',103,8).lifecycle!.liquidity_consumed = true;
  const below = pivot('D1','low',90,10);
  add('D1','SNR_CLOSED_BREAK','gapped',95,95,11).lifecycle!.state = 'UNVERIFIED';
  const x = thesisLocation(core);
  const above = x.location.nearest_kl.D1.above!;
  assert.equal(above.id,fvg.id);
  assert.equal(above.near,105);
  assert.equal(above.far,112);
  assert.equal(above.distance_points,5);
  assert.equal(above.distance_atr_d1,0.625);
  assert.deepEqual(above.nested_in,[parent.id]);
  assert.equal(x.location.nearest_kl.D1.below!.id,below.id);
});

test('the last swing and subsequent extremum determine the movement origin and its midpoint, with same-TF obstacles on each side', () => {
  const {core, pivot, add} = fixture();
  const low = pivot('D1','low',88,5);
  core.frames.D1.ohlc[5].high = 170; // intrabar ordering at origin is unknown
  core.frames.D1.ohlc[11].high = 118;
  const gap = add('D1','FVG','below',93,95,9);
  add('H4','FVG','closer',99,99.5,10);
  const x = thesisLocation(core);
  assert.equal(x.execution.movement_origins.D1!.id,low.id);
  assert.equal(x.location.midpoints.D1!.extreme,118);
  assert.equal(x.location.midpoints.D1!.extreme_at,time(12));
  assert.equal(x.location.midpoints.D1!.midpoint,103);
  assert.equal(x.execution.obstacles.D1.above!.kind,'IMPULSE_0_5');
  assert.equal(x.execution.obstacles.D1.below!.id,gap.id);
  assert.equal(x.execution.obstacles.D1.below!.near,95);
});

test('IDM identifies any confirmed internal swing, distinguishes X-1, excludes edges and records omitted observations', () => {
  const {core, pivot, add} = fixture();
  pivot('D1','low',80,1);
  pivot('D1','high',120,3);
  const zone = add('D1','FVG','parent',104,116,7);
  const edge = pivot('H4','high',120,4);
  const pre = pivot('H4','low',108,5);
  for (let i=9;i<16;i++) pivot('H4', i%2 ? 'low':'high',108+i/10,i);
  const x = thesisLocation(core).execution.idm.D1;
  assert.ok(x.total > x.items.length);
  assert.equal(x.omitted,x.total-x.items.length);
  assert.ok(x.items.every(e => e.id !== edge.id && e.inside_active_dr));
  assert.ok(x.items.some(e => e.tf_relation === 'X-1' && e.inside_kl.includes(zone.id)));
  assert.ok(x.items.every(e => e.id !== pre.id || !e.inside_kl.includes(zone.id)));
});

test('no H4 reference means no placement, and an ATR cannot span a segment boundary', () => {
  const {core} = fixture();
  core.frames.D1.ohlc.at(-1)!.segment = 1;
  assert.equal(thesisLocation(core).location.atr_d1,null);
  core.frames.H4.ohlc = [];
  const x = thesisLocation(core);
  assert.equal(x.location.reference,null);
  assert.equal(x.location.priority_tf,null);
  assert.ok(TF_ORDER.every(tf => x.location.active_dr[tf] === null && x.location.nearest_kl[tf].above === null));
});


test('range-only output selects the first applicable TF, shared with full location', () => {
  const {core, pivot} = fixture();
  pivot('MN1','low',80,3);
  pivot('MN1','high',125,5);
  pivot('W1','low',70,2);
  pivot('W1','high',110,6);
  assert.equal(thesisRanges(core).priority_tf,'MN1');
  assert.equal(thesisRanges(core).active_dr.MN1?.htf_priority,true);
  assert.equal(thesisRanges(core).active_dr.W1?.htf_priority,false);
  assert.equal(thesisRanges(core).active_dr.MN1?.zone,'DISCOUNT');
  assert.deepEqual(thesisRanges(core).active_dr,thesisLocation(core).location.active_dr);
});

test('a tested live RB still qualifies when own TF history extends beyond the H4 price timestamp', () => {
  const {core, add} = fixture();
  core.frames.H4.ohlc.pop();
  const z = add('D1','RB_TWO_CANDLE','tested',105,108,10);
  z.lifecycle!.state = 'TESTED';
  const x = thesisLocation(core);
  assert.equal(x.location.reference!.at,time(19));
  assert.equal(x.location.nearest_kl.D1.above!.id,z.id);
  assert.equal(x.location.nearest_kl.D1.above!.state,'TESTED');
});

test('EURUSD display distance is explicitly denominated in pips while ATR uses raw price units', () => {
  const {core, add} = fixture();
  core.symbol = 'EURUSD';
  const ref = core.frames.H4.ohlc.at(-1)!;
  ref.close = 1.12345;
  add('D1','FVG','fx-gap',1.1237,1.1240,5);
  const x = thesisLocation(core);
  assert.equal(x.location.distance_unit.name,'pip');
  assert.equal(x.location.distance_unit.price_per_unit,0.0001);
  assert.equal(x.location.nearest_kl.D1.above!.distance_points,2.5);
});

test('an invalid explicit selection suppresses automatic placement even when a confirmed pair encloses price', () => {
  const {core, pivot} = fixture();
  pivot('MN1','low',90,3);
  pivot('MN1','high',125,5);
  core.frames.MN1.range_selection_error = 'INVALID_CONFIRMED_RANGE_PAIR';
  assert.equal(thesisRanges(core).active_dr.MN1,null);
});

test('a reference precisely at quoted-decimal equilibrium retains EQ despite floating point representation', () => {
  const {core, pivot} = fixture();
  pivot('MN1','low',1.00001,3);
  pivot('MN1','high',1.00009,5);
  for (const b of core.frames.MN1.ohlc) b.close=1.00005;
  assert.equal(activeThesisRange(core,'MN1',time(20),1.00005)?.position,'EQ');
});

test('SNR reports its authored near and far and measures distance to the closest boundary', () => {
  const {core, add} = fixture();
  const e=add('D1','SNR_CLOSED_BREAK','close1-open1',105,111,10);
  e.facts={near:111,far:105,side:'SUPPORT'};
  const row=thesisLocation(core).location.nearest_kl.D1.above!;
  assert.equal(row.near,111);
  assert.equal(row.far,105);
  assert.equal(row.distance_points,5);
  assert.equal(row.confirmed_at,e.confirmed_at);
});

test('full Q11 membership supplies every item and reproduces the compact subset in identical order', () => {
  const {core, pivot} = fixture();
  pivot('D1','low',80,1);
  pivot('D1','high',120,3);
  for (let i=6;i<16;i++) pivot('H4','low',90+i/10,i);
  const compact = thesisLocation(core).execution.idm.D1;
  const full = idmItems(core,'D1');
  assert.equal(full.length,10);
  assert.equal(compact.total,full.length);
  assert.deepEqual(compact.items,full.slice(0,compact.items.length));
});
