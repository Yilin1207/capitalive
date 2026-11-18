import {HISTORY,type CandleResponse,type PriceSide} from '../candle-data';
import {closedFrame,type Bar} from '../knowledge/data';
import {closedRegularInterval} from '../research/calendars';

const period=14;
const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
const rounded=(n:number)=>Number(n.toPrecision(9));

/** Fourteen completed returns/true ranges require fifteen observed closes. */
export function rangeSeries(bars:Bar[], symbol:string){
  const points=[];
  let window:Bar[]=[];
  for(const bar of bars){
    const prev=window.at(-1);
    if(prev && prev.segment!==bar.segment && !closedRegularInterval(symbol,Date.parse(prev.end),Date.parse(bar.time)))window=[];
    window.push(bar);
    if(window.length>period+1)window.shift();
    if(window.length!==period+1)continue;
    const ranges=window.map(b=>b.high-b.low);
    const trueRanges=window.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-window[i].close),Math.abs(b.low-window[i].close)));
    const squared=window.slice(1).map((b,i)=>Math.log(b.close/window[i].close)**2);
    const amplitude=bar.high-bar.low,baseline=mean(ranges.slice(0,-1));
    points.push({timestamp:bar.end,amplitude:rounded(amplitude),atr14:rounded(mean(trueRanges)),
      realized_volatility_14_pct:rounded(100*Math.sqrt(squared.reduce((a,b)=>a+b,0))),
      range_ratio:baseline>0?rounded(amplitude/baseline):null,
      range_change:baseline===0?'UNDEFINED':amplitude>baseline?'EXPANSION':amplitude<baseline?'CONTRACTION':'UNCHANGED'});
  }
  return points.slice(-16);
}

export function realized(data:CandleResponse,side:PriceSide,now:number){
  if(data.timeframe!=='H4'&&data.timeframe!=='D1')throw Error('Unexpected timeframe');
  const frame=closedFrame(data,side,new Date(Math.min(now,Date.parse(data.fetched_at))).toISOString());
  const history=rangeSeries(frame.bars,data.symbol),latest=history.at(-1)??null;
  const interval=HISTORY[data.timeframe].seconds*1000;
  const onTime=latest && now-Date.parse(latest.timestamp)<interval+600_000;
  return {source:'Capital.com '+data.timeframe+' closed OHLC',price_side:side,timestamp:latest?.timestamp??null,
    timestamp_basis:'BAR_END_UTC',status:latest?(onTime?'FRESH':'STALE'):'UNAVAILABLE',value:latest,history,
    limitations:[...frame.warnings,'AVAILABLE_PROVIDER_WINDOW_ONLY']};
}

export function sentimentRow(payload:unknown,epic:string){
  const rows=(payload as {clientSentiments?:unknown}|null)?.clientSentiments;
  if(!Array.isArray(rows))return null;
  const matches=rows.filter(row=>row?.marketId===epic);
  if(matches.length!==1)return null;
  const {longPositionPercentage:long,shortPositionPercentage:short}=matches[0];
  if(![long,short].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100)||Math.abs(long+short-100)>0.021)return null;
  return {long_pct:long as number,short_pct:short as number};
}
