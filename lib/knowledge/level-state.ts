import type {Frame,Bar} from './data';
import {TF_ORDER,type KeyLevel,type Finding} from './detectors';
import type {Timeframe} from '../candle-data';
import {provenance} from './rules';
export type Role='support'|'resistance';
export type LevelEvidence={kind:string;timeframe:Timeframe;time:string;confirmed_at:string;index:number;open:number;high:number;low:number;close:number};
export type LevelState={id:string;kind:KeyLevel['kind'];timeframe:Timeframe;lower:number;upper:number;initial_role:Role;current_role:Role|null;as_of:string;evaluated_through:string;origin:string;confirmed_at:string;invalidated_at:string|null;continuity_end:string;coverage:'COMPLETE_OBSERVED_INTERVAL'|'UNVERIFIED';coverage_gaps:{from:string;to:string}[];state:'ACTIVE'|'CONSUMED'|'INVALIDATED'|'UNVERIFIED'|'CANDIDATE';role_status:'ORIGINAL_GEOMETRY'|'RETEST_CONFIRMED'|'UNVERIFIED';age_days:number;liquidity_consumed:boolean;first_raid:LevelEvidence|null;last_test:LevelEvidence|null;test_episodes:number;reaction:LevelEvidence|null;role_evidence:LevelEvidence[];lower_tf_breach:LevelEvidence|null;counterarguments:string[];rule_id:string;rule_version:number;rule_status:string;specification:string;sources:ReturnType<typeof provenance>['sources'];invalidation:string};
const proof=(kind:string,timeframe:Timeframe,b:Bar):LevelEvidence=>({kind,timeframe,time:b.time,confirmed_at:b.end,index:b.index,open:b.open,high:b.high,low:b.low,close:b.close});
const intersects=(b:Bar,l:KeyLevel)=>b.high>=l.lower&&b.low<=l.upper;
const broken=(b:Bar,l:KeyLevel,role:Role)=>role==='support'?b.close<l.lower:b.close>l.upper;
/** Interval proof can use a closed parent candle to cover an LTF session gap.
 * Candles starting before confirmation never prove a post-confirmation interaction. */
export function intervalCoverage(frames:Frame[],from:string,to:string){
 const intervals=frames.flatMap(f=>f.bars.filter(b=>b.time>=from&&b.end<=f.as_of&&b.end<=to&&b.time<to).map(b=>({from:b.time,to:b.end}))).sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
 let cursor=from;const gaps:{from:string;to:string}[]=[];
 for(const x of intervals){if(x.from>cursor)gaps.push({from:cursor,to:x.from<to?x.from:to});if(x.to>cursor)cursor=x.to;if(cursor>=to)break;}
 if(cursor<to)gaps.push({from:cursor,to});
 return {complete:from<=to&&gaps.length===0,gaps,continuity_end:gaps[0]?.from??to};
}
export function assessLevel(l:KeyLevel,all:Record<Timeframe,Frame>,asOf:string,through:string):LevelState{
 const rank=TF_ORDER.indexOf(l.timeframe),eligible=TF_ORDER.slice(rank).map(tf=>all[tf]).filter(f=>f.side===l.side&&f.symbol===all[l.timeframe].symbol);
 const frames=eligible.map(f=>({...f,bars:f.bars.filter(b=>b.time>=l.confirmed_at&&b.end<=asOf&&b.end<=through)}));
 const coverage=intervalCoverage(frames,l.confirmed_at,through);
 const observations=frames.flatMap(f=>f.bars.map(b=>({tf:f.timeframe,b}))).sort((a,b)=>a.b.end.localeCompare(b.b.end)||TF_ORDER.indexOf(a.tf)-TF_ORDER.indexOf(b.tf));
 const isFractal=l.kind==='FRACTAL',isFvg=l.kind==='FVG';
 const raid=observations.find(({b})=>isFractal&&(l.role==='resistance'?b.high>l.upper:b.low<l.lower));
 const ownBreak=observations.find(({tf,b})=>tf===l.timeframe&&broken(b,l,l.role));
 const lowerBreak=observations.filter(({tf,b})=>tf!==l.timeframe&&broken(b,l,l.role)).at(-1);
 const lowerPressure=lowerBreak&&!observations.some(({tf,b})=>tf===l.timeframe&&b.end>lowerBreak.b.end&&!broken(b,l,l.role))?lowerBreak:undefined;
 const origin=all[l.timeframe].bars.find(b=>b.end===l.confirmed_at);
 const reasons=[...provenance('EDGE.LEVEL_STATE.v2').counterarguments];
 if(!coverage.complete)reasons.push('UNOBSERVED_INTERVALS_CAN_HIDE_PRIOR_INTERACTIONS');
 if(!origin)reasons.push('ORIGIN_CONFIRMATION_NOT_IN_INPUT');
 if(!l.qualified)reasons.push('DETECTOR_CANDIDATE_NOT_QUALIFIED_KL');
 // Role reversal is a project evidence protocol, NOT a rename after a wick raid.
 // Same TF or X-1 closed break, then a later separate retest from the new side.
 const reversals:{role:Role;evidence:LevelEvidence[]}[]=[];let tests=0,lastTest:LevelEvidence|null=null,reaction:LevelEvidence|null=null;
 const coverageAt=new Map<string,boolean>();
 const continuousAt=(end:string)=>{if(!coverageAt.has(end))coverageAt.set(end,intervalCoverage(frames,l.confirmed_at,end).complete);return coverageAt.get(end)!;};
 for(const f of frames){let inside=false;for(const b of f.bars){const hit=intersects(b,l);if(hit&&!inside){tests++;if(!lastTest||b.end>lastTest.confirmed_at)lastTest=proof('TEST_EPISODE',f.timeframe,b);}inside=hit;
   if(TF_ORDER.indexOf(f.timeframe)<=rank+1&&hit&&(l.role==='support'?b.open>=l.upper&&b.close>l.upper:b.open<=l.lower&&b.close<l.lower)&&(!reaction||b.end>reaction.confirmed_at)&&continuousAt(b.end))reaction=proof('CLOSED_REJECTION',f.timeframe,b);
  }
  if(!isFractal||TF_ORDER.indexOf(f.timeframe)>rank+1)continue;
  let role:Role=l.role,pending:Bar|null=null,confirmed:LevelEvidence[]=[];
  for(const b of f.bars){if(!continuousAt(b.end)){pending=null;confirmed=[];continue;}
   if(broken(b,l,role)){if(!pending)pending=b;}
   else if(pending){pending=null;}
   if(pending&&b.time>=pending.end&&intersects(b,l)&&(role==='support'?b.open<l.lower&&b.close<l.lower:b.open>l.upper&&b.close>l.upper)){
    confirmed=[proof('CLOSED_ROLE_BREAK',f.timeframe,pending),proof('LATER_ROLE_RETEST',f.timeframe,b)];role=role==='support'?'resistance':'support';pending=null;
   }
  }
  if(confirmed.length&&!pending)reversals.push({role,evidence:confirmed});
 }
 const latest=reversals.sort((a,b)=>b.evidence[1].confirmed_at.localeCompare(a.evidence[1].confirmed_at))[0];
 const conflict=reversals.some(r=>r.role!==latest?.role);if(conflict)reasons.push('ROLE_TIMEFRAME_CONFLICT');
 const roleConfirmed=!!latest&&!conflict&&coverage.complete;
 const invalidated=isFvg&&!!ownBreak;
 if(isFvg&&lowerPressure)reasons.push('LOWER_TF_CLOSED_BREACH_REQUIRES_HTF_REVIEW');
 if(isFractal&&raid)reasons.push(roleConfirmed?'OLD_LIQUIDITY_CONSUMED_NEW_ROLE_RETESTED':'LIQUIDITY_CONSUMED_NOT_AUTOMATIC_ROLE_REVERSAL');
 const state=invalidated?'INVALIDATED':!coverage.complete||!origin||conflict?'UNVERIFIED':!l.qualified?'CANDIDATE':isFractal&&raid&&!roleConfirmed?'CONSUMED':'ACTIVE';
 return {id:l.id,kind:l.kind,timeframe:l.timeframe,lower:l.lower,upper:l.upper,initial_role:l.role,current_role:conflict?null:roleConfirmed?latest.role:l.role,
  as_of:asOf,evaluated_through:through,origin:l.source_finding.origin,confirmed_at:l.confirmed_at,invalidated_at:invalidated?ownBreak!.b.end:null,continuity_end:coverage.continuity_end,coverage:coverage.complete?'COMPLETE_OBSERVED_INTERVAL':'UNVERIFIED',coverage_gaps:coverage.gaps,state,role_status:roleConfirmed?'RETEST_CONFIRMED':isFractal&&raid||conflict?'UNVERIFIED':'ORIGINAL_GEOMETRY',age_days:Math.max(0,(Date.parse(asOf)-Date.parse(l.confirmed_at))/86400000),liquidity_consumed:!!raid,first_raid:raid?proof(coverage.complete?'STRICT_RAID':'CROSSING_WITH_UNOBSERVED_HISTORY',raid.tf,raid.b):null,last_test:lastTest,test_episodes:tests,reaction,role_evidence:roleConfirmed?latest.evidence:[],lower_tf_breach:lowerPressure?proof('LOWER_TF_CLOSE_BREACH',lowerPressure.tf,lowerPressure.b):null,
  ...provenance('EDGE.LEVEL_STATE.v2'),counterarguments:reasons,invalidation:'FVG: closed own-TF far-boundary breach. Fractal liquidity: strict observed crossing on admissible TF. Reversed role: new closed breach. Missing continuity invalidates claims of untouched status.'};
}
/** RB/SNR remain visible obstacles even while their execution boundaries are candidates. */
export function contextualLevels(findings:Finding[]):KeyLevel[]{return findings.flatMap(f=>{
 if(!['RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(f.kind))return [];
 const junction=f.kind==='RB_TWO_CANDLE'?f.facts.junction as {lower:number;upper:number}|undefined:{lower:Number(f.facts.lower),upper:Number(f.facts.upper)};
 if(!junction||!Number.isFinite(junction.lower)||!Number.isFinite(junction.upper))return [];
 return [{id:f.id,kind:f.kind==='RB_TWO_CANDLE'?'RB' as const:'SNR' as const,timeframe:f.timeframe,side:f.side,lower:junction.lower,upper:junction.upper,role:(f.kind==='RB_TWO_CANDLE'?f.facts.direction==='bullish':f.facts.proposed_role==='support')?'support' as const:'resistance' as const,confirmed_at:f.confirmed_at,source_finding:f,qualified:false}];
});}
