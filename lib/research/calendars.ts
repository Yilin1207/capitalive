// Broker CFD regular sessions, not Nasdaq cash / CME / Eurex futures calendars.
// Holiday exceptions and historical provider revisions are deliberately not inferred.
import {HISTORY,type CandleResponse,type Timeframe} from '../candle-data';
const et=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const CALENDAR_SOURCES=[
 'https://help.capital.com/hc/en-us/articles/27299104990482-Trading-hours-extended-on-key-indices',
 'https://open-api.capital.com/',
];
export function regularSession(symbol:string,utc:number):'OPEN_OR_HOLIDAY'|'SCHEDULED_CLOSED'|'UNKNOWN'{
 if(!['NAS100','EU50','EURUSD'].includes(symbol)||!Number.isFinite(utc))return 'UNKNOWN';
 const p=Object.fromEntries(et.formatToParts(utc).map(p=>[p.type,p.value])),minute=Number(p.hour)*60+Number(p.minute);
 const indices=symbol!=='EURUSD';
 // Friday 17:00 ET to Sunday 18:00 ET (indices) / 17:00 ET (FX).
 // Only weekend closures are used for FX; its historical maintenance schedule is not established.
 if(p.weekday==='Sat'||p.weekday==='Fri'&&minute>=17*60||p.weekday==='Sun'&&minute<(indices?18:17)*60)return 'SCHEDULED_CLOSED';
 if(!indices)return 'OPEN_OR_HOLIDAY';
 // Source explicitly dates shortened index maintenance from 2025-06-01.
 if(utc<Date.UTC(2025,5,1))return 'UNKNOWN';
 if(p.weekday!=='Sun'&&minute>=17*60&&minute<17*60+5)return 'SCHEDULED_CLOSED';
 return 'OPEN_OR_HOLIDAY';
}
const intervalMemo=new Map<string,boolean>();
export function closedRegularInterval(symbol:string,from:number,to:number):boolean{
 const key=symbol+':'+from+':'+to,cached=intervalMemo.get(key);if(cached!==undefined)return cached;
 const result=checkClosedRegularInterval(symbol,from,to);
 if(intervalMemo.size>=8192)intervalMemo.delete(intervalMemo.keys().next().value!);
 intervalMemo.set(key,result);return result;
}
function checkClosedRegularInterval(symbol:string,from:number,to:number):boolean{
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>10*86400_000)return false;
 // All bucket minutes must fall in a known closure. No interpolation of prices.
 for(let t=from;t<to;t+=60_000)if(regularSession(symbol,t)!=='SCHEDULED_CLOSED')return false;
 return regularSession(symbol,to-1)==='SCHEDULED_CLOSED';
}
export function calendarDiagnostics(data:CandleResponse){
 const tf=data.timeframe,rows=data.candles,closed:{from:string;to:string}[]=[],unresolved:{from:string;to:string}[]=[];
 if(tf!=='MN1')for(let i=1;i<rows.length;i++){const from=Date.parse(rows[i-1].time)+HISTORY[tf].seconds*1000,to=Date.parse(rows[i].time);if(to>from){const entry={from:new Date(from).toISOString(),to:new Date(to).toISOString()};(closedRegularInterval(data.symbol,from,to)?closed:unresolved).push(entry);}}
 return {profile:data.symbol==='JP225'?'JP225_CFD_HISTORICAL_SESSIONS_UNVERIFIED':'CAPITAL_CFD_REGULAR_SESSIONS_v1',instrument_class:data.symbol==='EURUSD'?'OTC_FX_CFD':'BROKER_CASH_INDEX_CFD',timezone:data.symbol==='JP225'?'UTC':'America/New_York',bar_grid:'PROVIDER_UTC_START',dst:data.symbol==='JP225'?'NOT_VERIFIED':'IANA America/New_York',scheduled_closures:closed,unresolved_gaps:unresolved,holiday_calendar:'NOT_VERIFIED',continuity_policy:'DIAGNOSTIC_ONLY_NO_PATTERN_STITCHING',sources:data.symbol==='JP225'?['Capital.com /api/v1/markets/J225']:CALENDAR_SOURCES,limitations:data.symbol==='JP225'?['Current broker openingHours do not establish historical sessions or holidays.','No EU50, Nasdaq, Tokyo cash or futures session calendar is substituted.']:['Provider UTC bucket can include a partial session (e.g. Sunday H4).','Current openingHours does not prove historical holiday exceptions.','Pre-June-2025 index maintenance remains UNKNOWN; no futures exchange calendar substitution.']};
}
