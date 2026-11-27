import 'server-only';
import {createHash} from 'node:crypto';
import {getMarketSnapshot,getHistoricalPrices,VERIFIED_MARKETS,capitalEnvironment} from '../capital';
import {analysisParams} from '../analysis-http';
import {checkHistoryRequest,historyJson,historyFailure} from '../history-http';
import {HistoryError} from '../candles';
import {HistoryCache,WindowLimit} from '../history-cache';
import {parseCandleTime} from '../candle-data';
const cache=new HistoryCache<Record<string,unknown>>(300_000),budget=new WindowLimit(24,60_000);
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'?v as Record<string,unknown>:{};
const scalar=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const shortText=(v:unknown)=>typeof v==='string'?v.slice(0,512):null;
export function allowlistedPrices(payload:unknown){const rows=object(payload).prices;if(!Array.isArray(rows))throw new HistoryError('INVALID_SOURCE','Invalid provider prices',502);
 return {prices:rows.map(v=>{const r=object(v);return {snapshotTimeUTC:typeof r.snapshotTimeUTC==='string'&&r.snapshotTimeUTC.length<=30?r.snapshotTimeUTC:null,...Object.fromEntries(['openPrice','highPrice','lowPrice','closePrice'].map(k=>{const p=object(r[k]);return [k,{bid:scalar(p.bid),ask:scalar(p.ask)}];}))};})};}
export function allowlistedMarket(payload:unknown){const p=object(payload),i=object(p.instrument),s=object(p.snapshot),hours=object(i.openingHours),rules=object(p.dealingRules);
 return {instrument:{...Object.fromEntries(['epic','name','type','expiry','currency','unit','marginFactorUnit'].map(k=>[k,shortText(i[k])])),...Object.fromEntries(['lotSize','contractSize','pip','tickSize','decimalPlaces','scalingFactor','marginFactor'].map(k=>[k,scalar(i[k])])),openingHours:Object.fromEntries(['zone','mon','tue','wed','thu','fri','sat','sun'].filter(k=>k in hours).map(k=>[k,k==='zone'?shortText(hours[k]):Array.isArray(hours[k])?(hours[k] as unknown[]).filter(x=>typeof x==='string').slice(0,8).map(shortText):[]]))},
 dealingRules:Object.fromEntries(['minDealSize','maxDealSize','minSizeIncrement','minStepDistance'].filter(k=>k in rules).map(k=>{const r=object(rules[k]);return [k,{unit:shortText(r.unit),value:scalar(r.value)}];})),
 snapshot:Object.fromEntries(['bid','offer','decimalPlaces','scalingFactor','updateTimeUTC','marketStatus'].filter(k=>k in s).map(k=>[k,['bid','offer','decimalPlaces','scalingFactor'].includes(k)?scalar(s[k]):shortText(s[k])]))};}
export async function researchSourceHttp(request:Request,deps={getMarketSnapshot,getHistoricalPrices,capitalEnvironment}){try{
 checkHistoryRequest(request);const q=new URL(request.url).searchParams,{symbol}=analysisParams(new URLSearchParams({symbol:q.get('symbol')??'EURUSD'})),epic=VERIFIED_MARKETS[symbol].epic;
 const mode=q.get('mode')??'prices',tf=q.get('timeframe')??'D1';if(!['market','prices'].includes(mode)||!['W1','D1','H4'].includes(tf))throw new HistoryError('INVALID_RESEARCH_QUERY','Use mode=market|prices and timeframe=W1|D1|H4',400);
 const from=q.get('from'),to=q.get('to');if((from!==null||to!==null)&&(!from||!to||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(from)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(to)||!parseCandleTime(from)||!parseCandleTime(to)||Date.parse(from)<Date.UTC(2020,0,1)||Date.parse(to)>Date.now()||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>(tf==='H4'?90:900)*86400_000))throw new HistoryError('INVALID_RESEARCH_WINDOW','Provide a valid closed UTC window: up to 90 days H4 or 900 days D1/W1, since 2020',400);
 const environment=deps.capitalEnvironment(),resolution=tf==='W1'?'WEEK':tf==='D1'?'DAY':'HOUR_4';
 const scope=createHash('sha256').update([process.env.CAPITAL_API_BASE_URL,process.env.CAPITAL_IDENTIFIER,process.env.CAPITAL_API_KEY].join('\n')).digest('hex');
 const {value}=await cache.get(`${scope}:${symbol}:${mode}:${tf}:${from}:${to}`,async()=>{const wait=budget.take('research');if(wait)throw new HistoryError('RESEARCH_RATE_LIMIT','Research source budget reached',429,wait);
 const payload=mode==='market'?allowlistedMarket(await deps.getMarketSnapshot(epic)):allowlistedPrices(await deps.getHistoricalPrices(epic,resolution,1000,undefined,from&&to?{from,to}:undefined));
 return {ok:true,symbol,epic,environment,captured_at:new Date().toISOString(),source:`Capital.com /api/v1/${mode==='market'?'markets':'prices'}/${epic}`,request:{mode,timeframe:tf,resolution,from,to,max:1000},payload,payload_sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),usage:'Read-only source observations; raw invalid prices remain visible for diagnosis, not admitted as valid candles; no account data or orders'};});
 return historyJson(value);
 }catch(e){return historyFailure(e);}}
