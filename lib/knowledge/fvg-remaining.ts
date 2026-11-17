import type {KeyLevel} from './detectors';
import type {Frame} from './data';
export const FVG_LIFECYCLE_REVISION='fvg-unfilled-1';
export type FvgTestStep={at:string;fraction:number};
const order=['MN1','W1','D1','H4'];
export function remainingBounds(l:Pick<KeyLevel,'lower'|'upper'|'role'>,fraction:number){
  if(fraction>=1)return null;
  return l.role==='support'?{lower:l.lower,upper:l.upper-(l.upper-l.lower)*fraction}:{lower:l.lower+(l.upper-l.lower)*fraction,upper:l.upper};
}
/** Monotonic wick-depth observations, only after formation and on closed candles.
 * A gap with no range intersection is not evidence of a traded fill. */
export function fvgTestTimeline(l:KeyLevel,frames:Frame[]):FvgTestStep[]{
  if(l.kind!=='FVG')return [];
  const bars=frames.filter(f=>f.side===l.side&&f.symbol===frames.find(x=>x.timeframe===l.timeframe)?.symbol&&order.indexOf(f.timeframe)>=order.indexOf(l.timeframe))
    .flatMap(f=>f.bars.filter(b=>b.time>=l.confirmed_at&&b.end<=f.as_of&&(!l.invalidated_at||b.end<=l.invalidated_at))).sort((a,b)=>a.end.localeCompare(b.end));
  let max=0;const steps:FvgTestStep[]=[];
  for(const b of bars){if(b.high<l.lower||b.low>l.upper)continue;const fraction=Math.max(0,Math.min(1,l.role==='support'?(l.upper-b.low)/(l.upper-l.lower):(b.high-l.lower)/(l.upper-l.lower)));
    if(fraction>max){max=fraction;steps.push({at:b.end,fraction});}if(max===1)break;
  }
  return steps;
}
/** Freeze the residual available BEFORE an observation. No mutation or future fill. */
export function levelAt(l:KeyLevel,at:string):KeyLevel|null{
  if(l.kind!=='FVG'||!l.fvg_test_steps)return l;
  const fraction=l.fvg_test_steps.filter(s=>s.at<=at).at(-1)?.fraction??0,bounds=remainingBounds(l,fraction);
  if(!bounds)return null;const {fvg_test_steps,...rest}=l;return {...rest,...bounds};
}
export function currentBounds<T extends {lower:number;upper:number}>(l:T,state?:{fill?:{remaining?:{lower:number;upper:number}|null}|null}):T{
  return state?.fill?.remaining?{...l,...state.fill.remaining}:l;
}
