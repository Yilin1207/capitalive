import test from 'node:test';
import assert from 'node:assert/strict';
import {detectDealingRange,selectTopDownRange} from '../lib/knowledge/dealing-range';
import {detectFractals,TF_ORDER,type KeyLevel} from '../lib/knowledge/detectors';
import type {Frame} from '../lib/knowledge/data';
import {provenance} from '../lib/knowledge/rules';

const at=(i:number)=>new Date(Date.UTC(2026,0,1,i*4)).toISOString();
const base=[[12,10,11],[11,8,10],[13,9,12],[16,12,14],[14,11,12],[13,10,12],[15,11,14],[18,13,16],[16,12,14],[15,9,13],[16,11,14]];
function frame(rows=base,tf:Frame['timeframe']='H4'):Frame{return {symbol:'EURUSD',side:'bid',timeframe:tf,as_of:at(rows.length),status:'PARTIAL',warnings:[],bars:rows.map(([high,low,close],i)=>({index:i,time:at(i),end:at(i+1),high,low,close,open:close,segment:0}))};}
const run=(f:Frame,levels:KeyLevel[]=[])=>detectDealingRange(f,detectFractals(f),levels);

test('DR requires two chronological confirmed Fractal 3 endpoints on every TF',()=>{
 for(const tf of TF_ORDER){const first=run(frame(base.slice(0,4),tf));assert.equal(first.current,null);assert.equal(first.status,'AWAITING_CONFIRMED_PAIR');
  const d=run(frame(base.slice(0,5),tf));assert.equal(d.status,'ESTABLISHED');assert.equal(d.current?.direction,'Bullish');assert.equal(d.current?.start_at,at(1));assert.equal(d.current?.end_at,at(3));assert.equal(d.current?.confirmed_at,at(5));assert.equal(d.current?.lower,8);assert.equal(d.current?.upper,16);}
});
test('DR preserves the starting low across internal pivots and expands only to a fresh confirmed high',()=>{
 const d=run(frame());assert.equal(d.current?.lower,8);assert.equal(d.current?.upper,18);assert.equal(d.current?.start_at,at(1));assert.equal(d.current?.end_at,at(7));
 assert.ok(d.internal_fractal_ids.length>=2);assert.equal(d.internal_classification,'INTERNAL_LIQUIDITY_NOT_AUTOMATIC_IDM');assert.equal(d.local_candidates.length,0);assert.equal(d.transitions.at(-1)?.kind,'EXPANDED');assert.equal(d.narrative_confirmed,false);
});
test('DR bearish direction mirrors the chronological high-to-new-low rule',()=>{
 const mirrored=base.map(([h,l,c])=>[30-l,30-h,30-c]);const d=run(frame(mirrored));assert.equal(d.current?.direction,'Bearish');assert.equal(d.current?.upper,22);assert.equal(d.current?.lower,12);assert.equal(d.current?.start_at,at(1));assert.equal(d.current?.end_at,at(7));
});
test('DR wick raid preserves established boundaries; closed break awaits a newly confirmed extreme',()=>{
 const brokenAtConfirmation=run(frame([...base.slice(0,4),[14,6,7]]));assert.equal(brokenAtConfirmation.status,'AWAITING_NEW_EXTREME');assert.equal(brokenAtConfirmation.close_break_at,at(5));
 const wick=run(frame([...base.slice(0,5),[17,10,15]]));assert.equal(wick.status,'ESTABLISHED');assert.equal(wick.current?.upper,16);assert.equal(wick.last_wick_raid_at,at(6));assert.equal(wick.close_break_at,null);
 const pending=run(frame([...base.slice(0,5),[17,10,17]]));assert.equal(pending.status,'AWAITING_NEW_EXTREME');assert.equal(pending.premium_discount,null);assert.equal(pending.current?.upper,16);
 const confirmed=run(frame([...base.slice(0,5),[17,10,17],[16,11,14]]));assert.equal(confirmed.status,'ESTABLISHED');assert.equal(confirmed.current?.upper,17);assert.equal(confirmed.current?.lower,8);
});
test('DR opposite external extreme establishes a fresh opposite leg without confirming Narrative',()=>{
 const before=run(frame([...base.slice(0,5),[13,7,10]]));assert.equal(before.current?.direction,'Bullish');assert.equal(before.current?.lower,8);
 const after=run(frame([...base.slice(0,5),[13,7,10],[14,9,12]]));assert.equal(after.current?.direction,'Bearish');assert.equal(after.current?.upper,16);assert.equal(after.current?.lower,7);assert.equal(after.transitions.at(-1)?.kind,'OPPOSITE_LEG_ESTABLISHED');assert.equal(after.narrative_confirmed,false);
});
test('DR internal KL reaction offers a local candidate, retaining its outer parent and requiring review',()=>{
 const f=frame([...base.slice(0,7),[14,12,13],[13,11,12]]);
 const p=detectFractals(f).find(p=>p.polarity==='low'&&p.price===10)!;
 const level:KeyLevel={id:'POI',kind:'FVG',timeframe:'D1',side:'bid',lower:9.5,upper:10.5,role:'support',qualified:true,confirmed_at:at(3),source_finding:{...p,id:'POI'}};
 const d=run(f,[level]);assert.equal(d.current?.lower,8);assert.equal(d.current?.upper,16);assert.equal(d.local_candidates.length,1);assert.equal(d.local_candidates[0].range.lower,10);assert.equal(d.local_candidates[0].range.upper,15);assert.equal(d.local_candidates[0].parent_low_id,d.current?.low_id);assert.equal(d.local_candidates[0].review_required,true);
 assert.equal(run(f,[{...level,confirmed_at:at(8)}]).local_candidates.length,0,'No future KL can justify a prior local origin');
 const brokenOnConfirmation=frame([...base.slice(0,7),[14,9,9],[13,10,12]]);
 assert.equal(run(brokenOnConfirmation,[level]).local_candidates.length,0,'A local pair broken by its confirming candle is not an active candidate');
});
test('DR top-down fallback skips missing monthly boundary and cannot invent a monthly DR',()=>{
 const rows=TF_ORDER.map(tf=>({timeframe:tf,dr_detection:run(frame(tf==='MN1'?base.slice(0,3):base,tf))}));const d=selectTopDownRange(rows);assert.equal(d.timeframe,'W1');assert.equal(d.skipped[0].timeframe,'MN1');assert.equal(d.narrative_confirmed,false);
 assert.equal(selectTopDownRange(rows.map(r=>({...r,dr_detection:run(frame([],r.timeframe))}))).timeframe,null);
});
test('DR new expansion from a causally tested KL retains the parent and uses the new origin',()=>{
 const f=frame(base.slice(0,9)),pivot=detectFractals(f).find(p=>p.polarity==='low'&&p.price===10)!;
 const level:KeyLevel={id:'POI',kind:'FVG',timeframe:'D1',side:'bid',lower:9.5,upper:10.5,role:'support',qualified:true,confirmed_at:at(3),source_finding:{...pivot,id:'POI'}};
 const d=run(f,[level]);assert.equal(d.current?.start_at,at(5));assert.equal(d.current?.lower,10);assert.equal(d.current?.upper,18);assert.equal(d.parent_ranges[0].lower,8);assert.equal(d.parent_ranges[0].upper,16);assert.deepEqual(d.origin_context_ids,['POI']);assert.ok(d.transitions.some(x=>x.kind==='KL_ORIGIN_NEW_RANGE'));
 const noRejection=frame(base.slice(0,9).map((b,i)=>i===6?[b[0],10.4,10.5]:b));assert.equal(run(noRejection,[level]).current?.lower,8,'Touch without a closed departure does not reset the origin');
});
test('DR never stitches a history gap or uses a future-confirmed pivot in a historical prefix',()=>{
 const all=frame(),pivots=detectFractals(all);
 for(let n=1;n<=all.bars.length;n++){const prefix=frame(base.slice(0,n));assert.deepEqual(detectDealingRange(prefix,pivots),run(prefix));}
 const gap=frame();gap.bars=gap.bars.map((b,i)=>({...b,segment:i<9?0:1}));assert.equal(run(gap).status,'AWAITING_CONFIRMED_PAIR');
});
