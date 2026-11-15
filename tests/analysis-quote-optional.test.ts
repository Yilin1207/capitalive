import test from 'node:test';import assert from 'node:assert/strict';
import {getAnalysisQuote} from '../lib/analysis-quote';
test('markets_batch schema failure is optional: single-market quote survives without invented provider time',async()=>{
  const log:string[]=[],warn=console.warn;console.warn=(value:unknown)=>{log.push(String(value));};
  const names=['CAPITAL_API_KEY','CAPITAL_IDENTIFIER','CAPITAL_API_PASSWORD','CAPITAL_API_BASE_URL'] as const;
  const saved=names.map(name=>process.env[name]);
  Object.assign(process.env,{CAPITAL_API_KEY:'test-key',CAPITAL_IDENTIFIER:'test-identifier',CAPITAL_API_PASSWORD:'test-password',CAPITAL_API_BASE_URL:'https://demo-api-capital.backend-capital.com'});
  try{
    const q=await getAnalysisQuote('EURUSD',{
      getMarketSnapshot:async()=>({snapshot:{bid:1.1,offer:1.1001,marketStatus:'CLOSED'}}),
      getMarketSummaries:async()=>{throw Error('private-account-raw-body Invalid response schema');},
      liveQuotes:async()=>({quotes:{},diagnostics:{}}),
    } as never);
    assert.equal(q.bid,1.1);assert.equal(q.ask,1.1001);assert.equal(q.source_type,'REST');assert.equal(q.provider_timestamp,null);assert.equal(q.fresh,false);
    assert.ok(log.some(s=>s.includes('MARKETS_BATCH_UNAVAILABLE')&&s.includes('"critical":false')));assert.ok(!log.join('').includes('private-account'));
  }finally{console.warn=warn;names.forEach((name,i)=>{if(saved[i]===undefined)delete process.env[name];else process.env[name]=saved[i];});}
});
