import {remainingBounds,FVG_LIFECYCLE_REVISION} from './fvg-remaining';
import type {Frame,Bar} from './data';
import {TF_ORDER,type KeyLevel,type Finding,type LevelMethod} from './detectors';
import type {Timeframe} from '../candle-data';
import {provenance} from './rules';
import {closedRegularInterval} from '../research/calendars';
export type Role='support'|'resistance';
export type LevelEvidence={kind:string;timeframe:Timeframe;time:string;confirmed_at:string;index:number;open:number;high:number;low:number;close:number};
export type LevelState={fill?:FvgFill|null;id:string;kind:KeyLevel['kind'];timeframe:Timeframe;lower:number;upper:number;initial_role:Role;current_role:Role|null;as_of:string;evaluated_through:string;origin:string;confirmed_at:string;invalidated_at:string|null;continuity_end:string;coverage:'COMPLETE_OBSERVED_INTERVAL'|'UNVERIFIED';coverage_gaps:{from:string;to:string}[];coverage_closures?:{from:string;to:string}[];state:'ACTIVE'|'TESTED'|'BROKEN'|'CONSUMED'|'INVALIDATED'|'UNVERIFIED'|'CANDIDATE';role_status:'ORIGINAL_GEOMETRY'|'RETEST_CONFIRMED'|'UNVERIFIED';age_days:number;liquidity_consumed:boolean;first_raid:LevelEvidence|null;last_test:LevelEvidence|null;test_episodes:number;reaction:LevelEvidence|null;role_evidence:LevelEvidence[];lower_tf_breach:LevelEvidence|null;counterarguments:string[];rule_id:string;rule_version:number;rule_status:string;specification:string;sources:ReturnType<typeof provenance>['sources'];invalidation:string};
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
 // Only a documented whole closed interval can fill the coverage timeline.
 // This does NOT join detector segments or manufacture a price observation.
 const symbol=frames[0]?.symbol;
 const scheduled_closures=gaps.filter(g=>frames.every(f=>f.symbol===symbol)&&closedRegularInterval(symbol,Date.parse(g.from),Date.parse(g.to)));
 const unresolved=gaps.filter(g=>!scheduled_closures.includes(g));
 return {complete:from<=to&&unresolved.length===0,gaps:unresolved,scheduled_closures,continuity_end:unresolved[0]?.from??to};
}
export type FvgFill={state:'UNKNOWN'|'UNTOUCHED'|'TOUCHED'|'PARTIAL'|'FILLED';max_observed_fraction:number;first_test_at:string|null;last_test_at:string|null;revision?:typeof FVG_LIFECYCLE_REVISION;remaining?:{lower:number;upper:number}|null;fully_tested_at?:string|null};
export function assessLevel(l:KeyLevel,all:Record<Timeframe,Frame>,asOf:string,through:string,method:LevelMethod='LEGACY'):LevelState & {fill:FvgFill|null}{
 const rank=TF_ORDER.indexOf(l.timeframe),eligible=TF_ORDER.slice(rank).map(tf=>all[tf]).filter(f=>f.side===l.side&&f.symbol===all[l.timeframe].symbol);
 const frames=eligible.map(f=>({...f,bars:f.bars.filter(b=>b.time>=l.confirmed_at&&b.end<=f.as_of&&b.end<=asOf&&b.end<=through)}));
 const coverage=intervalCoverage(frames,l.confirmed_at,through);
 const observed=frames.flatMap(f=>f.bars.map(b=>({tf:f.timeframe,b}))).sort((a,b)=>a.b.end.localeCompare(b.b.end)||TF_ORDER.indexOf(a.tf)-TF_ORDER.indexOf(b.tf));
 const isFractal=l.kind==='FRACTAL',isFvg=l.kind==='FVG';
 const rulebookZone=method==='PA_ONLY'&&(l.kind==='SNR'||l.kind==='RB');
 const ownBreak=observed.find(({tf,b})=>tf===l.timeframe&&broken(b,l,l.role));
 const fullDepth=({b}:{b:Bar})=>intersects(b,l)&&(l.role==='support'?b.low<=l.lower:b.high>=l.upper);
 const terminal=rulebookZone?ownBreak:isFvg?(method==='PA_ONLY'?observed.find(fullDepth):ownBreak):undefined;
 const observations=method==='PA_ONLY'&&terminal?observed.filter(({b})=>b.end<=terminal.b.end):observed;
 const raid=observations.find(({b})=>isFractal&&(l.role==='resistance'?b.high>l.upper:b.low<l.lower));
 const lowerBreak=observations.filter(({tf,b})=>tf!==l.timeframe&&broken(b,l,l.role)).at(-1);
 const lowerPressure=lowerBreak&&!observations.some(({tf,b})=>tf===l.timeframe&&b.end>lowerBreak.b.end&&!broken(b,l,l.role))?lowerBreak:undefined;
 const origin=all[l.timeframe].bars.find(b=>b.end===l.confirmed_at);
 const source=provenance(method==='PA_ONLY'?'EDGE.LEVEL_STATE.v4':'EDGE.LEVEL_STATE.v3');
 const reasons=[...source.counterarguments];
 if(!coverage.complete)reasons.push('UNOBSERVED_INTERVALS_CAN_HIDE_PRIOR_INTERACTIONS');
 if(!origin)reasons.push('ORIGIN_CONFIRMATION_NOT_IN_INPUT');
 if(!l.qualified&&!rulebookZone)reasons.push('DETECTOR_CANDIDATE_NOT_QUALIFIED_KL');
 // Observe tests/rejections. A generic break + retest must not turn a consumed
 // fractal into an automatically qualified opposite-side KL.
 let tests=0,lastTest:LevelEvidence|null=null,reaction:LevelEvidence|null=null;
 const coverageAt=new Map<string,boolean>();
 const continuousAt=(end:string)=>{if(!coverageAt.has(end))coverageAt.set(end,intervalCoverage(frames,l.confirmed_at,end).complete);return coverageAt.get(end)!;};
 for(const f of frames){let inside=false;for(const b of f.bars){
  if(method==='PA_ONLY'&&terminal&&b.end>terminal.b.end)break;
  const hit=intersects(b,l);
  if(hit&&!inside){tests++;if(!lastTest||b.end>lastTest.confirmed_at)lastTest=proof('TEST_EPISODE',f.timeframe,b);}inside=hit;
  if(TF_ORDER.indexOf(f.timeframe)<=rank+1&&hit&&(l.role==='support'?b.open>=l.upper&&b.close>l.upper:b.open<=l.lower&&b.close<l.lower)&&(!reaction||b.end>reaction.confirmed_at)&&continuousAt(b.end))reaction=proof('CLOSED_REJECTION',f.timeframe,b);
 }}
 const invalidated=!!terminal;
 const fillRows=isFvg?observations.filter(({b})=>(!terminal||b.end<=terminal.b.end)&&intersects(b,l)):[];
 const maxFill=fillRows.reduce((value,{b})=>Math.max(value,Math.max(0,Math.min(1,l.role==='support'?(l.upper-b.low)/(l.upper-l.lower):(b.high-l.lower)/(l.upper-l.lower)))),0);
 const observedPartial=method==='PA_ONLY'&&maxFill>0&&maxFill<1;
 let fillState:FvgFill['state']=fillRows.length?'TOUCHED':'UNTOUCHED';
 if(maxFill===1)fillState='FILLED';
 else if(!coverage.complete&&!observedPartial)fillState='UNKNOWN';
 else if(maxFill>0)fillState='PARTIAL';
 const fill:FvgFill|null=isFvg&&l.upper>l.lower?{state:fillState,max_observed_fraction:maxFill,first_test_at:fillRows[0]?.b.end??null,last_test_at:fillRows.at(-1)?.b.end??null,revision:FVG_LIFECYCLE_REVISION,remaining:invalidated?null:remainingBounds(l,maxFill),fully_tested_at:fillRows.find(fullDepth)?.b.end??null}:null;
 if(isFvg&&lowerPressure&&(method==='LEGACY'||!invalidated))reasons.push('LOWER_TF_CLOSED_BREACH_REQUIRES_HTF_REVIEW');
 if(isFractal&&raid)reasons.push('LIQUIDITY_CONSUMED_NOT_AUTOMATIC_ROLE_REVERSAL');
 let state:LevelState['state']='ACTIVE';
 if(invalidated)state=rulebookZone?'BROKEN':'INVALIDATED';
 else if(rulebookZone)state=lastTest?'TESTED':'ACTIVE';
 else if(fill?.state==='FILLED')state='TESTED';
 else if(!observedPartial&&(!coverage.complete||!origin))state='UNVERIFIED';
 else if(!l.qualified)state='CANDIDATE';
 else if(isFractal&&raid)state='CONSUMED';
 // A reaction after invalidation belongs to a different premise, never to this active FVG.
 if(terminal&&reaction&&reaction.confirmed_at>terminal.b.end)reaction=null;
 const currentRole=invalidated||state==='TESTED'&&!rulebookZone||state==='UNVERIFIED'||state==='CONSUMED'?null:l.role;
 return {id:l.id,kind:l.kind,timeframe:l.timeframe,lower:l.lower,upper:l.upper,initial_role:l.role,current_role:currentRole,fill,
  as_of:asOf,evaluated_through:through,origin:l.source_finding.origin,confirmed_at:l.confirmed_at,invalidated_at:terminal?.b.end??null,continuity_end:coverage.continuity_end,coverage:coverage.complete?'COMPLETE_OBSERVED_INTERVAL':'UNVERIFIED',coverage_gaps:coverage.gaps,coverage_closures:coverage.scheduled_closures,state,role_status:currentRole===null?'UNVERIFIED':'ORIGINAL_GEOMETRY',age_days:Math.max(0,(Date.parse(asOf)-Date.parse(l.confirmed_at))/86400000),liquidity_consumed:!!raid,first_raid:raid?proof(coverage.complete?'STRICT_RAID':'CROSSING_WITH_UNOBSERVED_HISTORY',raid.tf,raid.b):null,last_test:lastTest,test_episodes:tests,reaction,role_evidence:[],lower_tf_breach:lowerPressure?proof('LOWER_TF_CLOSE_BREACH',lowerPressure.tf,lowerPressure.b):null,
  ...source,counterarguments:reasons,invalidation:method==='PA_ONLY'?'SNR and RB break on a strict own-timeframe close beyond the far edge. Full-depth fills invalidate FVG. Strict crossings consume fractal liquidity.':'FVG: closed own-TF far-boundary breach. Fractal liquidity: strict observed crossing on admissible TF. Reversed role: new closed breach. Missing continuity invalidates claims of untouched status.'};
}
/** RB's first-close reference is established; trade eligibility and SNR boundaries still require review. */
export function contextualLevels(findings:Finding[]):KeyLevel[]{return findings.flatMap(f=>{
 if(!['RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(f.kind))return [];
 const junction=f.kind==='RB_TWO_CANDLE'?f.facts.junction as {lower:number;upper:number}|undefined:{lower:Number(f.facts.lower),upper:Number(f.facts.upper)};
 if(!junction||!Number.isFinite(junction.lower)||!Number.isFinite(junction.upper))return [];
 return [{id:f.id,kind:f.kind==='RB_TWO_CANDLE'?'RB' as const:'SNR' as const,timeframe:f.timeframe,side:f.side,lower:junction.lower,upper:junction.upper,role:(f.kind==='RB_TWO_CANDLE'?f.facts.direction==='bullish':f.facts.proposed_role==='support')?'support' as const:'resistance' as const,confirmed_at:f.confirmed_at,source_finding:f,qualified:false}];
});}
