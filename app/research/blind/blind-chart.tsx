"use client";
import {useEffect,useRef,useState} from 'react';
import {createChart,CandlestickSeries,ColorType,type UTCTimestamp} from 'lightweight-charts';
import type {CandleResponse,PriceSide} from '@/lib/candle-data';
import type {Annotation} from '@/lib/research/blind';
export default function BlindChart({data,side,annotations,onPoint}:{data:CandleResponse;side:PriceSide;annotations:Annotation[];onPoint:(time:string,price:number)=>void}){
 const host=useRef<HTMLDivElement>(null),pick=useRef(onPoint);pick.current=onPoint;
 const [selected,setSelected]=useState('Наведите курсор для OHLC; щёлкните для времени и цены разметки.');
 useEffect(()=>{if(!host.current)return;const chart=createChart(host.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#111a29'},textColor:'#c8d6e8'},timeScale:{timeVisible:true},localization:{locale:'en-GB'},grid:{vertLines:{color:'#243247'},horzLines:{color:'#243247'}}});
 const series=chart.addSeries(CandlestickSeries,{upColor:'#43d8b0',downColor:'#f37f89',wickUpColor:'#43d8b0',wickDownColor:'#f37f89',borderVisible:false,priceFormat:{type:'price',precision:data.symbol==='EURUSD'?5:2,minMove:data.symbol==='EURUSD'?0.00001:0.01}});
 const bars=data.candles.filter(c=>c.is_closed&&(c.history_completeness_by_side?.[side]??c.history_completeness)!=='partial_validation'&&[c.open[side],c.high[side],c.low[side],c.close[side]].every(x=>x!==null&&Number.isFinite(x)));
 series.setData(bars.map(c=>({time:Date.parse(c.time)/1000 as UTCTimestamp,open:c.open[side]!,high:c.high[side]!,low:c.low[side]!,close:c.close[side]!})));
 for(const a of annotations.filter(a=>a.timeframe===data.timeframe)){for(const price of new Set([a.lower,a.upper]))series.createPriceLine({price,color:a.validity==='INVALID'?'#e49090':'#e5c76b',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:`Моя ${a.id}: ${a.kind}`});}
 chart.subscribeCrosshairMove(p=>{if(typeof p.time!=='number')return;const c=bars.find(c=>Date.parse(c.time)/1000===p.time);if(c)setSelected(`${c.time} · O ${c.open[side]} H ${c.high[side]} L ${c.low[side]} C ${c.close[side]}`);});
 chart.subscribeClick(p=>{if(typeof p.time==='number'&&p.point){const price=series.coordinateToPrice(p.point.y);if(price!==null)pick.current(new Date(p.time*1000).toISOString(),Number(price.toFixed(data.symbol==='EURUSD'?5:2)));}});
 chart.timeScale().fitContent();return()=>chart.remove();},[data,side,annotations]);
 return <><div ref={host} style={{height:420}} aria-label={`Свечной график ${data.timeframe}`}/><p aria-live="polite">{selected}</p></>;
}
