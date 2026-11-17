import type {Frame,Bar} from './data';
import {TF_ORDER,type Finding,type KeyLevel,type Range} from './detectors';
import type {LevelState} from './level-state';
import {intervalCoverage} from './level-state';
import {currentBounds,levelAt} from './fvg-remaining';

export const NARRATIVE_METHOD_REVISION='narrative-method-1';
type TF=Frame['timeframe'];
type Direction='Bullish'|'Bearish';
export type MethodRange={timeframe:TF;range:Range|null;active:boolean};
const rank=(tf:TF)=>TF_ORDER.indexOf(tf);
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b),n=s.length;return n?n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2:0;};
const intersects=(b:Bar,l:{lower:number;upper:number})=>b.low<=l.upper&&b.high>=l.lower;
const pd=(price:number|null,q:Range|null)=>!q||price===null?'UNVERIFIED':price<q.lower||price>q.upper?'OUTSIDE':price<q.equilibrium?'DISCOUNT':price>q.equilibrium?'PREMIUM':'EQUILIBRIUM';
const clamp=(n:number)=>Math.max(1,Math.min(5,n));
const closed=(frame:Frame)=>frame.bars.filter(b=>b.end<=frame.as_of);

/** User-approved last-two confirmed highs/lows; never a mutation of DR or IDM. */
export function fractalTrend(frame:Frame,findings:Finding[]){
 const last=closed(frame).at(-1),pivots=findings.filter(f=>f.kind==='FRACTAL'&&f.facts.variant===3&&f.timeframe===frame.timeframe&&f.confirmed_at<=frame.as_of&&f.candle_evidence.every(c=>c.closed_at<=f.confirmed_at)&&f.candle_evidence.every(c=>frame.bars.some(b=>b.time===c.time&&b.segment===last?.segment))).sort((a,b)=>a.origin.localeCompare(b.origin)||a.id.localeCompare(b.id));
 const highs=pivots.filter(f=>f.facts.polarity==='high').slice(-2),lows=pivots.filter(f=>f.facts.polarity==='low').slice(-2);
 const compare=(xs:Finding[],up:string,down:string)=>xs.length!==2?'UNKNOWN':Number(xs[1].facts.price)>Number(xs[0].facts.price)?up:Number(xs[1].facts.price)<Number(xs[0].facts.price)?down:'EQUAL';
 const high=compare(highs,'HH','LH'),low=compare(lows,'HL','LL'),known=high!=='UNKNOWN'&&low!=='UNKNOWN';
 return {timeframe:frame.timeframe,bias:high==='HH'&&low==='HL'?'Bullish':high==='LH'&&low==='LL'?'Bearish':'Neutral',status:known?'OBSERVED_FRACTAL_SEQUENCE':'INSUFFICIENT_CONFIRMED_PIVOTS',high,low,evidence_ids:[...highs,...lows].map(x=>x.id),confirmed_at:known?[...highs,...lows].map(x=>x.confirmed_at).sort().at(-1)!:null,dr_override:false};
}

export function deliveryScore(frame:Frame,l:KeyLevel,findings:Finding[]){
 const bars=closed(frame).filter(b=>b.time>=l.confirmed_at),episodes:number[]=[];let touching=false;
 for(let i=0;i<bars.length;i++){const known=levelAt(l,bars[i].time),hit=!!known&&intersects(bars[i],known);if(hit&&(!touching||i>0&&bars[i].segment!==bars[i-1].segment))episodes.push(i);touching=hit;}
 const contact=episodes.at(-1),end=contact===undefined?bars.length:contact,available=bars.slice(0,end),segment=available.at(-1)?.segment,window=available.filter(b=>b.segment===segment).slice(-6),start=window[0],last=window.at(-1);
 const baseline=start?closed(frame).filter(b=>b.segment===segment&&b.end<=start.time).slice(-20):[];
 const empty={score:null as number|null,timeframe:frame.timeframe,from:start?.time??null,through:last?.end??null,contact_at:contact===undefined?null:bars[contact].time,bars:window.length,efficiency:null as number|null,body_ratio:null as number|null,opposing_ids:[] as string[],reason:'INSUFFICIENT_APPROACH_HISTORY'};
 if(window.length<3||baseline.length<5||!start||!last)return empty;
 const sign=l.role==='support'?-1:1,net=(last.close-start.open)*sign,travel=window.reduce((n,b)=>n+Math.abs(b.close-b.open),0),efficiency=Math.min(1,Math.abs(last.close-start.open)/Math.max(travel,Number.EPSILON)),base=median(baseline.map(b=>Math.abs(b.close-b.open))),bodyRatio=base>0?median(window.map(b=>Math.abs(b.close-b.open)))/base:null;
 const opposing=findings.filter(f=>f.timeframe===frame.timeframe&&['FVG','RB_TWO_CANDLE','SNR_CLOSED_BREAK'].includes(f.kind)&&f.confirmed_at>start.time&&f.confirmed_at<=last.end&&f.candle_evidence.every(c=>c.closed_at<=f.confirmed_at)&&f.facts.direction===(l.role==='support'?'bearish':'bullish')).map(f=>f.id);
 const measured={...empty,efficiency,body_ratio:bodyRatio,opposing_ids:opposing};
 if(net<=0)return {...measured,reason:'NOT_APPROACHING_POI'};
 if(bodyRatio===null)return measured;
 const strong=efficiency>=0.7&&bodyRatio>=1.5,weak=efficiency<=0.35&&bodyRatio<=1;
 const score=strong?(opposing.length?1:2):opposing.length?2:weak?5:bodyRatio<=1?4:3;
 return {...measured,score,reason:strong?'IMPULSIVE_APPROACH':opposing.length?'OPPOSING_PA_ON_APPROACH':weak?'WEAK_APPROACH':'MIXED_APPROACH'};
}

/** Separate observed wick breach and own-TF close breach after a boundary became known. */
export function boundaryObservation(frames:Record<TF,Frame>,tf:TF,price:number,side:Direction,knownAt:string){
 const eligible=TF_ORDER.slice(rank(tf)).map(t=>frames[t]),asOf=closed(frames.H4).at(-1)?.end??frames.H4.as_of;
 const rows=eligible.flatMap(f=>closed(f).filter(b=>b.time>=knownAt&&b.end<=asOf).map(b=>({tf:f.timeframe,b}))).sort((a,b)=>a.b.end.localeCompare(b.b.end));
 const wick=rows.find(({b})=>side==='Bullish'?b.low<price:b.high>price),close=rows.find(({tf:t,b})=>t===tf&&(side==='Bullish'?b.close<price:b.close>price));
 const coverage=intervalCoverage(eligible,knownAt,asOf).complete;
 return {evaluated_through:asOf,wick_breached:wick?true:coverage?false:null,wick_at:wick?.b.end??null,close_breached:close?true:coverage?false:null,close_at:close?.b.end??null,coverage:coverage?'COMPLETE':'UNVERIFIED'};
}

export function riskReward(entry:number,target:number|null,stop:number|null,side:Direction){
 if(target===null||stop===null)return null;
 const risk=side==='Bullish'?entry-stop:stop-entry,reward=side==='Bullish'?target-entry:entry-target;
 return risk>0&&reward>0?{risk,reward,ratio:reward/risk,costs_included:false,minimum_required:null}:null;
}

export function buildNarrativeMethod(frames:Record<TF,Frame>,findings:Finding[],levels:KeyLevel[],states:LevelState[],ranges:MethodRange[],reference:number|null){
 const stateById=new Map(states.map(s=>[s.id,s])),byId=new Map(findings.map(f=>[f.id,f]));
 const validRanges=TF_ORDER.map(tf=>ranges.find(q=>q.timeframe===tf&&q.active&&q.range&&q.range.confirmed_at<=frames[tf].as_of)?.range??null);
 const contexts=TF_ORDER.map((timeframe,i)=>({timeframe,range:validRanges[i],position:pd(reference,validRanges[i])}));
 const primary=contexts.slice(0,3).find(c=>c.range)??null;
 const conflict=!!primary&&primary.timeframe==='MN1'&&['PREMIUM','DISCOUNT'].includes(primary.position)&&['PREMIUM','DISCOUNT'].includes(contexts[1].position)&&primary.position!==contexts[1].position;
 const trends=TF_ORDER.map(tf=>fractalTrend(frames[tf],findings));
 const eligible=levels.filter(l=>{const s=stateById.get(l.id);return !!s&&l.confirmed_at<=frames[l.timeframe].as_of&&s.coverage==='COMPLETE_OBSERVED_INTERVAL'&&(l.kind==='FVG'?s.state==='ACTIVE':l.kind==='FRACTAL'?['ACTIVE','CONSUMED'].includes(s.state):['ACTIVE','CANDIDATE'].includes(s.state))&&!closed(frames[l.timeframe]).some(b=>b.time>=l.confirmed_at&&(l.role==='support'?b.close<l.lower:b.close>l.upper));});
 type Anchor={id:string;kind:string;timeframe:TF;lower:number;upper:number;confirmed_at:string;source_ids:string[];side:Direction;level:KeyLevel|null};
 const anchors:Anchor[]=eligible.map(l=>{const q=currentBounds(l,stateById.get(l.id));return {id:l.id,kind:l.kind,timeframe:l.timeframe,lower:q.lower,upper:q.upper,confirmed_at:l.confirmed_at,source_ids:[l.id],side:l.role==='support'?'Bullish':'Bearish',level:l};});
 const h4=validRanges[3],h4Trend=trends[3].bias;
 if(h4&&!anchors.some(a=>a.timeframe==='H4'&&a.lower>h4.lower&&a.upper<h4.upper)&&h4Trend!=='Neutral')anchors.push({id:`${frames.H4.symbol}:H4:${frames.H4.side}:DR_EQ:${h4.confirmed_at}`,kind:'DR_EQ',timeframe:'H4',lower:h4.equilibrium,upper:h4.equilibrium,confirmed_at:h4.confirmed_at,source_ids:[h4.high_id,h4.low_id],side:h4Trend as Direction,level:null});
 const candidates=anchors.map(a=>{
  const l=a.level,s=l?stateById.get(l.id):null,own=closed(frames[a.timeframe]),up=a.side==='Bullish',entry=up?a.upper:a.lower;
  let holding=false,holds=0;const holdTimes:string[]=[];
  if(l)for(const b of own.filter(b=>b.time>=a.confirmed_at)){const k=levelAt(l,b.time),hit=!!k&&intersects(b,k);if(hit&&!holding&&(up?b.close>k!.upper:b.close<k!.lower)){holds++;holdTimes.push(b.end);}holding=hit;}
  const anchorPosition=pd(entry,primary?.range??null),favorable=up?anchorPosition==='DISCOUNT':anchorPosition==='PREMIUM',unfavorable=up?anchorPosition==='PREMIUM':anchorPosition==='DISCOUNT';
  const opposed=eligible.filter(o=>o.id!==a.id&&rank(o.timeframe)<=rank(a.timeframe)&&(o.role==='support')!==up&&intersects({low:a.lower,high:a.upper} as Bar,currentBounds(o,stateById.get(o.id))));
  const trendConflict=trends.some(t=>rank(t.timeframe)<=rank(a.timeframe)&&t.bias!=='Neutral'&&t.bias!==a.side);
  const factors=[{code:'BASE',delta:2},{code:'HTF_PRIORITY',delta:rank(a.timeframe)<=1?1:0},{code:'FAVORABLE_LOCATION',delta:favorable?1:unfavorable?-1:0},{code:'REPEATED_HOLDS',delta:holds>=2?1:0},{code:'RAID_BACKED',delta:s?.first_raid?1:0}];
  const score=primary&&['DISCOUNT','PREMIUM','EQUILIBRIUM'].includes(anchorPosition)?clamp(clamp(factors.reduce((n,f)=>n+f.delta,0))-(conflict?1:0)-(trendConflict?1:0)-(opposed.length?1:0)):null;
  factors.push({code:'MN1_W1_CONFLICT',delta:conflict?-1:0},{code:'TREND_CONFLICT',delta:trendConflict?-1:0},{code:'OPPOSING_HTF_POI',delta:opposed.length?-1:0});
  const approach=l?deliveryScore(frames[TF_ORDER[rank(a.timeframe)+1]??a.timeframe],l,findings):null;
  const ownRange=validRanges[rank(a.timeframe)];
  const makeBoundary=(price:number,tf:TF,sourceIds:string[],confirmed:string,kind:string)=>({price,timeframe:tf,source_ids:sourceIds,known_at:[a.confirmed_at,confirmed].sort().at(-1)!,kind,...boundaryObservation(frames,tf,price,a.side,[a.confirmed_at,confirmed].sort().at(-1)!)});
  const structural=ownRange&&entry>ownRange.lower&&entry<ownRange.upper?makeBoundary(up?ownRange.lower:ownRange.upper,a.timeframe,[ownRange.high_id,ownRange.low_id],ownRange.confirmed_at,'DR_BOUNDARY'):l?.kind==='FVG'?makeBoundary(up?l.lower:l.upper,a.timeframe,[l.id],l.confirmed_at,'FVG_FAR_BOUNDARY'):null;
  const strongOptions=eligible.filter(p=>['RB','SNR'].includes(p.kind)&&TF_ORDER.slice(rank(a.timeframe),rank(a.timeframe)+2).includes(p.timeframe)&&(p.role==='support')===up&&
   (p.id===a.id||[p.source_finding.facts.kl_id,p.source_finding.facts.rb_fvg_id,p.source_finding.facts.rb_liquidity_id].includes(a.id))).flatMap(p=>{
    const id=p.source_finding.facts.rb_liquidity_id??p.source_finding.facts.kl_id,raid=typeof id==='string'?byId.get(id):null;
    if(!raid||raid.kind!=='FRACTAL'||raid.facts.polarity!==(up?'low':'high')||!p.source_finding.candle_evidence.some(b=>b.time>=raid.confirmed_at&&(up?b.low<Number(raid.facts.price):b.high>Number(raid.facts.price))))return [];
    const price=up?Math.min(...p.source_finding.candle_evidence.map(c=>c.low)):Math.max(...p.source_finding.candle_evidence.map(c=>c.high));
    return [makeBoundary(price,p.timeframe,[p.id,raid.id],p.confirmed_at,'RAID_BACKED_PA_EXTREME')];
   }).sort((a,b)=>b.known_at.localeCompare(a.known_at)||a.source_ids[0].localeCompare(b.source_ids[0]));
  const strong=strongOptions.find(x=>(up?x.price<entry:x.price>entry)&&x.wick_breached===false)??null;
  const local=h4&&entry>h4.lower&&entry<h4.upper?makeBoundary(up?h4.lower:h4.upper,'H4',[h4.high_id,h4.low_id],h4.confirmed_at,'H4_DR_BOUNDARY'):null;
  const stop=[strong,local,structural].find(x=>x&&(up?x.price<entry:x.price>entry)&&x.wick_breached===false)??null;
  const c=structural??strongOptions.find(x=>x.timeframe===a.timeframe&&x.close_breached===false)??null;
  const targetOptions=levels.filter(t=>t.id!==a.id&&t.confirmed_at<=frames[t.timeframe].as_of&&['FRACTAL','FVG'].includes(t.kind)&&TF_ORDER.slice(rank(a.timeframe),rank(a.timeframe)+2).includes(t.timeframe)).flatMap(t=>{const st=stateById.get(t.id),q=currentBounds(t,st),price=up?q.lower:q.upper;if(st?.state!=='ACTIVE'||st.liquidity_consumed||st.coverage!=='COMPLETE_OBSERVED_INTERVAL'||st.current_role!==(up?'resistance':'support')||st.lower_tf_breach||!(up?price>Math.max(entry,reference??entry):price<Math.min(entry,reference??entry)))return [];return [{id:t.id,timeframe:t.timeframe,price,confirmed_at:t.confirmed_at}];}).sort((x,y)=>rank(x.timeframe)-rank(y.timeframe)||Math.abs(x.price-entry)-Math.abs(y.price-entry)||x.id.localeCompare(y.id));
  const target=targetOptions[0]??null;
  const obstacles=target?eligible.filter(o=>o.id!==a.id&&o.id!==target.id&&(o.role==='support')!==up).filter(o=>{const q=currentBounds(o,stateById.get(o.id));return up?q.upper>entry&&q.lower<target.price:q.lower<entry&&q.upper>target.price;}).map(o=>o.id):[];
  const last=closed(frames.H4).at(-1),current=reference!==null&&reference>=a.lower&&reference<=a.upper||!!last&&last.time>=a.confirmed_at&&intersects(last,a);
  return {id:a.id,A:{kind:a.kind,timeframe:a.timeframe,lower:a.lower,upper:a.upper,entry,confirmed_at:a.confirmed_at,source_ids:a.source_ids},direction:a.side,current_reaction:current,quality:{score,factors,hold_episodes:holds,hold_times:holdTimes,anchor_position:anchorPosition,opposing_ids:opposed.map(x=>x.id)},delivery:approach,B:target,target_count:targetOptions.length,obstacle_ids:obstacles,C:c,entry_stop:stop,rr:c?.close_breached===false?riskReward(entry,target?.price??null,stop?.price??null,a.side):null,entry_status:'NOT_ENTERED',narrative_status:'CANDIDATE',confirmed_narrative:null,review_required:true};
 });
 const ranked=candidates.filter(c=>c.current_reaction&&c.quality.score!==null&&c.C?.close_breached!==true).sort((a,b)=>(b.quality.score??0)-(a.quality.score??0)||(b.delivery?.score??0)-(a.delivery?.score??0)||rank(a.A.timeframe)-rank(b.A.timeframe)||a.id.localeCompare(b.id));
 const best=ranked[0],second=ranked[1],tied=best&&second&&best.quality.score===second.quality.score&&best.delivery?.score===second.delivery?.score&&best.A.timeframe===second.A.timeframe;
 return {revision:NARRATIVE_METHOD_REVISION,as_of:frames.H4.as_of,contexts,primary_context:primary?.timeframe??null,mn1_w1_conflict:conflict,trends,candidates,ranked_ids:ranked.map(c=>c.id),selected_id:best&&!tied?best.id:null,selection_status:tied?'AMBIGUOUS_TOP_SCORE':best?'CANDIDATE_SELECTED':'NO_CURRENT_SCORED_REACTION',score_policy:'QUALITY_1_TO_5_NOT_PROBABILITY',delivery_policy:'PRECONTACT_LAST6_PRIOR20_MIN5_EFF035_070_BODY1_15',target_policy:'X_OR_X_MINUS_1_SAME_TF_THEN_FIRST_TARGET_ON_PATH',automatic_confirmation:false,probability:null};
}
