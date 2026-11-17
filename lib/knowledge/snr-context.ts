import {levelAt} from './fvg-remaining';
import type {Bar,Frame} from './data';
import type {KeyLevel} from './detectors';

export const SNR_REVISION='snr-formation-context-2';
const order=['MN1','W1','D1','H4'];
/** Measurements stop at the FIRST closed break. Later retests never strengthen
 * the historical formation. These are author-method observations, not odds. */
export function snrFormationContext(frame:Frame,origin:Bar,second:Bar,delivery:Bar,breakout:Bar,level:number,bullish:boolean,context:KeyLevel[],lowerLevels:KeyLevel[]){
  const waiting=frame.bars.filter(c=>c.segment===origin.segment&&c.index>second.index&&c.index<breakout.index&&c.end<=breakout.end);
  const tests=waiting.filter(c=>c.low<=level&&c.high>=level&&(bullish?c.close<=level:c.close>=level));
  let episodes=0,previous=-2;for(const c of tests){if(c.index!==previous+1)episodes++;previous=c.index;}
  const bodies=frame.bars.filter(c=>c.segment===origin.segment&&c.index<breakout.index).slice(-20).map(c=>Math.abs(c.close-c.open)).sort((a,b)=>a-b);
  const median=bodies.length?(bodies[Math.floor((bodies.length-1)/2)]+bodies[Math.floor(bodies.length/2)])/2:null;
  const body=Math.abs(breakout.close-breakout.open),span=breakout.high-breakout.low;
  const start=tests.at(-1)?.end??delivery.time;
  const leg:Bar[]=[];
  for(const c of frame.bars.filter(c=>c.segment===origin.segment&&c.index>second.index&&c.index<=breakout.index&&c.time>=start).reverse()){
    if(bullish?c.close<=c.open:c.close>=c.open)break;leg.unshift(c);
  }
  const legBody=leg.reduce((sum,c)=>sum+Math.abs(c.close-c.open),0),legSpan=leg.length?Math.max(...leg.map(c=>c.high))-Math.min(...leg.map(c=>c.low)):0;
  const legMove=leg.length?Math.abs(breakout.close-leg[0].open):0;
  const expansion=median&&median>0?legBody/median:null,efficiency=legSpan>0?Math.min(1,legMove/legSpan):0;
  // Explicit implementation proxy, not a numeric threshold stated by the author.
  // FVG is an optional additional observation, never a mandatory strength gate.
  const measuredImpulse=bodies.length>=5&&expansion!==null&&expansion>=2&&efficiency>=0.6&&leg.length>0;
  const admissible=(l:KeyLevel)=>l.qualified&&l.side===frame.side&&l.confirmed_at<=breakout.end&&(!l.invalidated_at||l.invalidated_at>breakout.end)&&(!l.continuity_end||l.continuity_end>=breakout.end);
  const sort=(a:KeyLevel,b:KeyLevel)=>order.indexOf(a.timeframe)-order.indexOf(b.timeframe)||b.confirmed_at.localeCompare(a.confirmed_at)||a.id.localeCompare(b.id);
  const x1=lowerLevels.filter(l=>l.kind==='FVG'&&l.timeframe===order[order.indexOf(frame.timeframe)+1]&&admissible(l)&&l.role===(bullish?'support':'resistance')&&l.source_finding.origin>=start&&l.confirmed_at>=breakout.time&&l.lower<=level&&l.upper>=level).sort(sort)[0]??null;
  // A strong-looking break INTO an opposing known HTF zone is not an automatic
  // strong continuation. Only overlap is defined; arbitrary "near" is not used.
  const opposing=context.map(l=>levelAt(l,breakout.time)).filter((l):l is KeyLevel=>!!l).filter(l=>admissible(l)&&order.indexOf(l.timeframe)<=order.indexOf(frame.timeframe)&&l.confirmed_at<=breakout.time&&l.role===(bullish?'resistance':'support')&&(bullish?l.lower>level:l.upper<level)&&breakout.low<=l.upper&&breakout.high>=l.lower).sort(sort)[0]??null;
  return {revision:SNR_REVISION,level_policy:'FIRST_CANDLE_CLOSE' as const,level_price:level,
    formation_confirmed:true as const,origin_confirmed_at:second.end,delivery_at:delivery.end,breakout_at:breakout.end,
    waiting_bars:waiting.length,formation_seconds:(Date.parse(breakout.end)-Date.parse(second.end))/1000,
    failed_test_bars:tests.length,failed_test_episodes:episodes,
    failed_tests:tests.map(c=>({time:c.time,closed_at:c.end,index:c.index,kind:c.high===level||c.low===level?'TOUCH':'REJECTED_CROSS'})),
    breakout_body:body,breakout_body_fraction:span>0?body/span:0,prior_body_sample:bodies.length,body_to_prior_median:median&&median>0?body/median:null,
    impulse_leg_bars:leg.length,impulse_leg_body_to_median:expansion,impulse_leg_efficiency:efficiency,
    x1_fvg_id:x1?.id??null,opposing_kl_id:opposing?.id??null,opposing_bounds:opposing?{lower:opposing.lower,upper:opposing.upper}:null,
    impulse_detected:measuredImpulse||!!x1,impulse_evidence:measuredImpulse?(x1?'MEASURED_EXPANSION_AND_X1_FVG':'MEASURED_EXPANSION'):x1?'X1_FVG_AT_BREAK':'BODY_METRICS_ONLY',
    relative_strength:opposing?'CONTEXT_CONFLICT':episodes>=2&&(measuredImpulse||x1)?'VERY_STRONG_FORMATION_CANDIDATE':'REVIEW_REQUIRED',
    strength_policy:'REPEATED_EPISODES_AND_IMPULSE_FVG_OPTIONAL',impulse_policy:'PRIOR20_MEDIAN_2X_LEG_EFFICIENCY_060_MIN5_OR_X1_FVG',probability:null,review_required:true as const,
    history_scope:'OBSERVED_CONTIGUOUS_ORIGIN_TO_FIRST_BREAK',
  };
}
