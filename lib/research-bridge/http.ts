import 'server-only';
import {getCandles} from '../candles';
import {getAnalysisQuote} from '../analysis-quote';
import {buildIntelligence,type IntelligenceOptions} from '../knowledge/intelligence';
import {HISTORY,type CandleResponse,type Timeframe} from '../candle-data';
import {checkHistoryRequest} from '../history-http';
import {buildDeskReport,errorReport,SYMBOLS,type BridgeSymbol} from './report';
import {CONTRACT_REVISION,classifyFailure,diagnostic,type FailureStage} from './contract';

export async function deskReportHttp(request:Request,deps={getCandles,getAnalysisQuote}){
  const params=new URL(request.url).searchParams,symbol=(params.get('symbol')??'EURUSD').toUpperCase();
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Desk-Contract':CONTRACT_REVISION}});
  if(!SYMBOLS.some(s=>s===symbol))return json({error:'INVALID_SYMBOL'},400);
  const safeSymbol=symbol as BridgeSymbol,side=params.get('side')??'bid';
  if(!['bid','ask'].includes(side))return json(errorReport(safeSymbol,'INVALID_REQUEST'),400);
  let stage:FailureStage='http';
  try{
    checkHistoryRequest(request);
    const ranges:NonNullable<IntelligenceOptions['ranges']>={};
    for(const tf of ['MN1','W1','D1','H4'] as const){const h=params.get(tf==='H4'?'high_id':`${tf.toLowerCase()}_high_id`),l=params.get(tf==='H4'?'low_id':`${tf.toLowerCase()}_low_id`);if(h!==null||l!==null){if(!h||!l||h.length>500||l.length>500)return json(errorReport(safeSymbol,'INVALID_REQUEST'),400);ranges[tf]={high_id:h,low_id:l};}}
    const data={} as Record<Timeframe,CandleResponse>;
    stage='provider';
    for(const tf of ['MN1','W1','D1','H4'] as const)data[tf]=await deps.getCandles(safeSymbol,tf,HISTORY[tf].limit);
    const quote=await deps.getAnalysisQuote(safeSymbol);stage='schema';
    const r=buildIntelligence(data,side as 'bid'|'ask',quote,{ranges});
    if(r.frames.some(f=>ranges[f.timeframe]&&f.range_blocker))return json(errorReport(safeSymbol,'INVALID_REQUEST'),400);
    return json(buildDeskReport(r,data,quote,new Date().toISOString(),process.env.VERCEL_GIT_COMMIT_SHA??null));
  }catch(e){
    const errorCode=e&&typeof e==='object'&&'code'in e?String(e.code):'';
    const d=stage==='provider'?diagnostic('provider',errorCode.startsWith('CAPITAL_')?errorCode:'UPSTREAM_UNAVAILABLE'):classifyFailure(e,stage);
    const code=d.stage==='size'?'REPORT_TOO_LARGE':d.stage==='schema'?'INVALID_EVIDENCE':'UPSTREAM_UNAVAILABLE';
    // No upstream message, stack, request URL or credentials leave this boundary.
    console.warn(JSON.stringify({event:'desk_report_failure',symbol:safeSymbol,...d}));
    return json({...errorReport(safeSymbol,code),diagnostic:d},503);
  }
}
