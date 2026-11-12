// Test-only preload for an actual local Next production server. Never imported by application code.
import {readFileSync} from 'node:fs';
if(process.env.CAPITALIVE_RC_TEST!=='1')throw new Error('RC transport preload is test-only');
const fixtures=Object.fromEntries(['EURUSD','NAS100','EU50'].map(s=>[s,JSON.parse(readFileSync(`tests/fixtures/htf-${s}.json`,'utf8'))]));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(['localhost','127.0.0.1'].includes(url.hostname))return originalFetch(input,init);
  if(url.hostname!=='demo-api-capital.backend-capital.com')throw new Error('Non-fixture outbound request blocked in RC test');
  if(url.pathname==='/api/v1/session')return Response.json({streamingHost:'wss://127.0.0.1:1'},{headers:{CST:'synthetic-test-cst','X-SECURITY-TOKEN':'synthetic-test-security'}});
  const epic=url.pathname.split('/').at(-1),symbol=epic==='US100'?'NAS100':epic,fixture=fixtures[symbol]??fixtures.NAS100;
  if(url.pathname.startsWith('/api/v1/prices/')){
    const tf=url.searchParams.get('resolution')==='HOUR_4'?'H4':url.searchParams.get('resolution')==='WEEK'?'W1':'D1';
    const from=Date.parse(url.searchParams.get('from')??''),to=Date.parse(url.searchParams.get('to')??'');
    // Monthly aggregation receives only recorded D1 history: incompleteness must remain explicit.
    const bars=fixture.data[tf].candles.filter(c=>(!Number.isFinite(from)||Date.parse(c.time)>=from)&&(!Number.isFinite(to)||Date.parse(c.time)<=to));
    return Response.json({prices:bars.map(c=>({snapshotTimeUTC:c.time.replace('.000Z',''),openPrice:c.open,highPrice:c.high,lowPrice:c.low,closePrice:c.close}))});
  }
  if(url.pathname==='/api/v1/markets')return Response.json({markets:(url.searchParams.get('epics')??'US100,EURUSD,EU50').split(',').map(epic=>({epic,delayTime:0,streamingPricesAvailable:false,marketStatus:'TRADEABLE'}))});
  if(url.pathname.startsWith('/api/v1/markets/'))return Response.json({instrument:{epic,name:'Recorded fixture transport'},snapshot:{bid:fixture.quote.bid,offer:fixture.quote.ask,marketStatus:'TRADEABLE',
    updateTimeUTC:process.env.CAPITALIVE_RC_FRESHNESS_SIMULATION==='1'?new Date(Date.now()-1000).toISOString():fixture.quote.quote_time?.replace('.000Z','')}});
  throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
};
