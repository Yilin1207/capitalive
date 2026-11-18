import 'server-only';
import {unstable_cache} from 'next/cache';
import {ACTIVE_RESEARCH_SYMBOLS} from '../active-research-markets';
import {capitalEnvironment,getClientSentiments,getHistoricalPrices,getMarketSummaries,VERIFIED_MARKETS} from '../capital';
import {getCandles} from '../candles';
import {HISTORY,normalizeCandles,type PriceSide} from '../candle-data';
import {HistoryCache} from '../history-cache';
import {checkHistoryRequest,historyFailure} from '../history-http';
import {providerTime} from '../tick-data';
import {realized,sentimentRow} from './metrics';

type SymbolName=typeof ACTIVE_RESEARCH_SYMBOLS[number];
type Sentiment=NonNullable<ReturnType<typeof sentimentRow>>;
type Sample=Sentiment & {timestamp:string};
const epics=ACTIVE_RESEARCH_SYMBOLS.map(s=>VERIFIED_MARKETS[s].epic);
const sentimentCache=new HistoryCache<{payload:unknown;observed_at:string}>(60_000,2);
const vixQuoteCache=new HistoryCache<Awaited<ReturnType<typeof getMarketSummaries>>>(30_000,2);
const dailyCache=new HistoryCache<{timestamp:string;close_bid:number}[]>(600_000,2);
const source='Capital.com /api/v1/clientsentiment';
const vixSource='Capital.com VIX CFD';
const hour=3600_000;

function unavailable(source:string,why:string){
  return {source,timestamp:null,status:'UNAVAILABLE',value:null,history:[],limitations:[why]};
}

// One real observation per UTC hour on requested markets. An unread historical
// bucket stays empty. Never call today's provider to fill yesterday's bucket.
async function sentimentHistory(epic:string,env:string,current:Sample|null,now:number){
  const latest=Math.floor(now/hour);
  const samples=await Promise.all(Array.from({length:8},(_,i)=>{
    const bucket=latest-7+i;
    if(bucket===latest&&!current)return null;
    return unstable_cache(async()=>current&&Math.floor(Date.parse(current.timestamp)/hour)===bucket?current:null,
      ['capitalive-public-sentiment-v1',env,epic,String(bucket)],{revalidate:86400})().catch(()=>null);
  }));
  return samples.filter((v):v is Sample=>!!v);
}
async function sentiment(epic:string,env:string){
  const result=await sentimentCache.get(env,async()=>({payload:await getClientSentiments(epics),observed_at:new Date().toISOString()})).catch(()=>null);
  const value=sentimentRow(result?.value.payload,epic);
  const current=value&&result?{...value,timestamp:result.value.observed_at}:null;
  const now=Date.now();
  const history=await sentimentHistory(epic,env,current,now);
  const sample=current??history.at(-1);
  return {source,market_id:epic,timestamp:sample?.timestamp??null,provider_timestamp:null,timestamp_basis:'API_OBSERVATION_UTC',
    status:!sample?'UNAVAILABLE':current&&now-Date.parse(sample.timestamp)<=120_000?'FRESH':'STALE',
    value:sample?{long_pct:sample.long_pct,short_pct:sample.short_pct}:null,history,
    limitations:['Capital.com client positioning only. Provider calculation time is undisclosed. Freshness refers to retrieval.',
      'At most one observed sample per UTC hour over eight hours. Unobserved or evicted cache buckets are absent.']};
}
async function vix(env:string){
  const [quote,daily]=await Promise.allSettled([
    vixQuoteCache.get(env,()=>getMarketSummaries(['VIX'])),
    dailyCache.get(env,async()=>{
      const raw=await getHistoricalPrices('VIX','DAY',24);
      const now=Date.now();
      return normalizeCandles(raw,'D1',now).candles.filter(c=>c.is_closed&&c.close.bid!==null&&Date.parse(c.time)+86400_000<=now)
        .slice(-16).map(c=>({timestamp:new Date(Date.parse(c.time)+86400_000).toISOString(),close_bid:c.close.bid!}));
    })
  ]);
  const row=quote.status==='fulfilled'?quote.value.value.VIX:undefined;
  const bid=row?.bid,ask=row?.offer,timestamp=providerTime(row?.updateTimeUTC);
  const valid=row?.epic==='VIX'&&typeof bid==='number'&&Number.isFinite(bid)&&bid>0&&typeof ask==='number'&&Number.isFinite(ask)&&ask>=bid;
  const age=timestamp?(Date.now()-Date.parse(timestamp))/1000:null;
  return {source:vixSource,epic:'VIX',representation:'BROKER_CFD',timestamp:valid&&age!==null&&age>=0?timestamp:null,timestamp_basis:'PROVIDER_QUOTE_UTC',
    status:!valid?'UNAVAILABLE':age!==null&&age>=0&&age<=120&&row.delayTime===0&&row.marketStatus==='TRADEABLE'?'FRESH':'STALE',
    value:valid?{bid,ask}:null,history:daily.status==='fulfilled'?daily.value.value:[],
    limitations:['US equity volatility proxy. CFD prices can diverge from the official Cboe spot VIX and from local EU or FX volatility.',
      'History contains closed daily CFD Bid prices.']};
}
const references={
  VXN:{...unavailable('Cboe Nasdaq-100 Volatility Index','FREE_PUBLIC_REDISTRIBUTION_NOT_VERIFIED'),official_history:'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv'},
  VSTOXX:{...unavailable('STOXX EURO STOXX 50 Volatility Index','FREE_PUBLIC_REDISTRIBUTION_NOT_VERIFIED'),official_history:'https://www.stoxx.com/document/Indices/Current/HistoricalData/h_v2tx.txt'}
};

export async function marketContextHttp(request:Request){
  const q=new URL(request.url).searchParams,symbol=(q.get('symbol')??'EURUSD').toUpperCase() as SymbolName,side=q.get('side')??'bid';
  const json=(b:unknown,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'private, no-store','Access-Control-Allow-Origin':'*'}});
  if(!ACTIVE_RESEARCH_SYMBOLS.includes(symbol)||!['bid','ask'].includes(side)||[...q.keys()].some(k=>!['symbol','side','view'].includes(k)))return json({error:'INVALID_CONTEXT_REQUEST'},400);
  try{checkHistoryRequest(request);}catch(e){return historyFailure(e);}
  let env: ReturnType<typeof capitalEnvironment>;
  try { env=capitalEnvironment(); }
  catch {
    const missing=(name:string)=>unavailable(name,'BROKER_CONFIGURATION_UNAVAILABLE');
    return json({schema_version:'market-context-v1',symbol,price_side:side,environment:null,generated_at:new Date().toISOString(),
      vix:missing(vixSource),client_sentiment:missing(source),realized_volatility:{H4:missing('Capital.com H4 closed OHLC'),D1:missing('Capital.com D1 closed OHLC')},reference_indices:references},503);
  }
  const epic=VERIFIED_MARKETS[symbol].epic;
  const [fear,clients,...vol]=await Promise.allSettled([vix(env),sentiment(epic,env),...(['H4','D1'] as const).map(async tf=>{
    const data=await getCandles(symbol,tf,HISTORY[tf].limit);
    return realized(data,side as PriceSide,Date.now());
  })]);
  const result=(r:PromiseSettledResult<unknown>,name:string)=>r.status==='fulfilled'?r.value:unavailable(name,'SOURCE_UNAVAILABLE');
  return json({schema_version:'market-context-v1',symbol,price_side:side,environment:env,generated_at:new Date().toISOString(),
    vix:result(fear,vixSource),client_sentiment:result(clients,source),
    realized_volatility:{H4:result(vol[0],'Capital.com H4 closed OHLC'),D1:result(vol[1],'Capital.com D1 closed OHLC')},
    reference_indices:references,definitions:{amplitude:'High minus Low in price units',atr14:'Simple mean of 14 True Ranges using previous close',
      realized_volatility_14_pct:'100 * sqrt(sum of 14 squared close-to-close log returns), unannualized',
      range_ratio:'Current amplitude divided by mean amplitude of the preceding 14 bars. Above/below 1 denotes expansion/contraction.'}});
}
