import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tdaRelationships,tdaAnchorLevels} from '../lib/knowledge/tda';
import {resolveContext} from '../lib/knowledge/narrative';
import {selectTarget} from '../lib/knowledge/target-selection';
import {buildIntelligence} from '../lib/knowledge/intelligence';
import {buildDeskReport} from '../lib/research-bridge/report';
import {validateReport} from '../lib/research-bridge/contract';
import {TF_ORDER,type Finding,type KeyLevel} from '../lib/knowledge/detectors';
import type {Frame} from '../lib/knowledge/data';
import type {LevelState} from '../lib/knowledge/level-state';
const at=(h:number)=>new Date(Date.UTC(2026,0,1,h)).toISOString();
const candle=(h:number)=>({time:at(h),closed_at:at(h+4),open:11,close:12,high:13,low:9});
const finding=(id:string,kind:Finding['kind'],tf:Frame['timeframe'],h:number,extra={})=>({id,kind,timeframe:tf,side:'bid',origin:at(h),confirmed_at:at(h+12),candle_evidence:[candle(h),candle(h+4),candle(h+8)],facts:{direction:'bullish',variant:3,polarity:'low',price:10,...extra}} as unknown as Finding);
const poi=(id='A',tf:Frame['timeframe']='D1',kind:KeyLevel['kind']='FRACTAL'):KeyLevel=>({id,timeframe:tf,side:'bid',kind,lower:10,upper:10,role:'support',confirmed_at:at(12),qualified:kind!=='RB'&&kind!=='SNR',source_finding:finding(id,kind==='RB'?'RB_TWO_CANDLE':kind==='SNR'?'SNR_CLOSED_BREAK':kind,tf,0)});
const state=(l:KeyLevel,status='ACTIVE')=>({id:l.id,timeframe:l.timeframe,confirmed_at:l.confirmed_at,evaluated_through:at(96),state:status,coverage:'COMPLETE_OBSERVED_INTERVAL',liquidity_consumed:status==='CONSUMED',current_role:status==='CONSUMED'?null:l.role,role_status:'ORIGINAL',role_evidence:[]} as unknown as LevelState);
const frames=()=>Object.fromEntries(TF_ORDER.map(tf=>[tf,{symbol:'TEST',timeframe:tf,side:'bid',as_of:at(96),status:'PARTIAL',warnings:[],bars:[{index:0,segment:0,time:at(12),end:at(16),open:11,high:13,low:9,close:12}]}])) as unknown as Record<Frame['timeframe'],Frame>;

test('TDA D1 consumed fractal can anchor reaction and H4 SNR; consumed liquidity never becomes target',()=>{
 const a=poi(),s=state(a,'CONSUMED'),f=finding('VC','SNR_CLOSED_BREAK','H4',16),r=tdaRelationships(frames(),[f],[a],[s],[],12);
 assert.equal(r.anchors[0].eligible_as_poi,true);assert.equal(r.anchors[0].liquidity_available,false);assert.deepEqual(r.anchors[0].vc_ids,['VC']);
 assert.equal(resolveContext(tdaAnchorLevels([a],r),12,undefined,['A']).a?.id,'A');
 assert.equal(selectTarget([a],[s],12,'down',null).candidate_target,null);
});
test('TDA research POI eligibility does not mutate RB/SNR trade qualification',()=>{
 for(const kind of ['RB','SNR'] as const){const a=poi('A','D1',kind),r=tdaRelationships(frames(),[],[a],[state(a,'CANDIDATE')],[],10);assert.equal(r.anchors[0].eligible_as_poi,true);assert.equal(tdaAnchorLevels([a],r).length,1);assert.equal(a.qualified,false);assert.equal(r.automatic_narrative_confirmation,false);}
});
test('Only fractals trigger; X-2 VC belongs to the trigger and does not require parent VC',()=>{
 const a={...poi('A','W1','FVG'),lower:8,upper:12},trigger=finding('TRIGGER','FRACTAL','D1',16),vc=finding('LOCAL_VC','SNR_CLOSED_BREAK','H4',32),gap=finding('GAP','FVG','D1',16);
 const r=tdaRelationships(frames(),[trigger,vc,gap],[a],[state(a)],[],11),x=r.anchors[0];
 assert.deepEqual(x.trigger_ids,['TRIGGER']);assert.ok(!x.vc_ids.includes('LOCAL_VC'));assert.deepEqual(x.refinements[0].vc_ids,['LOCAL_VC']);assert.equal(x.refinements[0].parent_confirmation_required,false);
 const withoutParent=tdaRelationships(frames(),[trigger,vc],[a],[state(a)],[],11).anchors[0];assert.deepEqual(withoutParent.vc_ids,[]);assert.deepEqual(withoutParent.refinements[0].vc_ids,['LOCAL_VC']);
});
test('Future, pre-POI and wrong-direction VC cannot leak into current TDA',()=>{
 const a=poi(),f=frames(),good=finding('GOOD','SNR_CLOSED_BREAK','H4',16),future=finding('FUTURE','FVG','H4',100),early=finding('EARLY','FVG','H4',0),wrong=finding('WRONG','FVG','H4',16,{direction:'bearish'});
 const one=tdaRelationships(f,[good],[a],[state(a)],[],12),many=tdaRelationships(f,[good,future,early,wrong],[a],[state(a)],[],12);assert.deepEqual(many,one);
});
test('H4 explicitly reports unavailable lower timeframe; tested FVG never qualifies as POI',()=>{
 const a=poi('A','H4','FVG');assert.equal(tdaRelationships(frames(),[],[a],[state(a)],[],10).anchors[0].vc_status,'LOWER_TIMEFRAME_UNAVAILABLE');assert.equal(tdaRelationships(frames(),[],[a],[state(a,'TESTED')],[],10).anchors[0].eligible_as_poi,false);
});
test('Potential H4 target for D1 remains distinct from path validation and includes H4 obstacles',()=>{
 const a=poi(),b={...poi('B','H4'),lower:20,upper:20,role:'resistance' as const},o={...poi('OBSTACLE','H4','SNR'),lower:15,upper:15,role:'resistance' as const};
 const r=selectTarget([a,b,o],[state(a),state(b),state(o,'CANDIDATE')],12,'up',a,undefined,'PARTIAL');assert.equal(r.candidate_target?.id,'B');assert.equal(r.validated_target,null);assert.ok(r.obstacles.some(x=>x.id==='OBSTACLE'));assert.equal(r.path_completeness,'PARTIAL');
});
test('DR supplies context and confirmed boundary evidence without inventing a directional A',()=>{
 const a=poi(),range={timeframe:'D1' as const,high_id:'H',low_id:'L',lower:8,upper:20,equilibrium:14,origin:at(0),confirmed_at:at(12),segment:0};const r=tdaRelationships(frames(),[],[a],[state(a)],[{timeframe:'D1',range,state:'ACTIVE'}],12);assert.equal(r.anchors[0].premium_discount,'DISCOUNT');assert.equal(r.range_pois[0].directional_anchor,false);
});
test('Real report TDA is bounded, causal and does not confirm Narrative; forged trigger/TF rejected',()=>{
 const i=JSON.parse(readFileSync('tests/fixtures/edge-v2/NAS100.json','utf8')),r=buildIntelligence(i.data,'bid',i.quote),report=buildDeskReport(r,i.data,i.quote,'2026-11-15T14:00:00.000Z');validateReport(report);assert.ok(Buffer.byteLength(JSON.stringify(report)+'\n')<=65536);assert.equal(report.tda.trigger_policy,'FRACTAL_ONLY');assert.equal(report.scenario.confirmed_narrative,null);assert.ok(report.tda.anchors.items.length);
 const bad:any=structuredClone(report);bad.tda.anchors.items[0].vc_timeframe='MN1';assert.throws(()=>validateReport(bad));
 const bad2:any=structuredClone(report),nonFractal=Object.entries(report.evidence).find(([,e]:any)=>e.kind==='FVG')![0];bad2.tda.anchors.items[0].triggers={items:[nonFractal],total:1,omitted:0};assert.throws(()=>validateReport(bad2));
});
