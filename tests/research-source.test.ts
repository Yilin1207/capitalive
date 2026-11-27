import test from 'node:test';
import assert from 'node:assert/strict';
import {allowlistedPrices,allowlistedMarket,researchSourceHttp} from '../lib/research/source-http';
test('Research source persists only market fields and diagnoses rather than fixes crossed prices',()=>{
 const r=allowlistedPrices({account:'private',prices:[{snapshotTimeUTC:'2026-01-01T00:00:00',secret:'private',openPrice:{bid:3,ask:2,token:'private'},highPrice:{bid:4,ask:5},lowPrice:{bid:1,ask:1},closePrice:{bid:2,ask:3}}]});
 assert.equal(JSON.stringify(r).includes('private'),false);assert.deepEqual((r.prices[0] as Record<string,unknown>).openPrice,{bid:3,ask:2});
});
test('Research window rejects future, oversize and unsupported inputs before contacting provider',async()=>{
 for(const query of ['symbol=UNKNOWN','timeframe=MINUTE','from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z','from=2026-01-01T00:00:00Z&to=2099-01-01T00:00:00Z','from=2026-02-30T00:00:00Z&to=2026-03-01T00:00:00Z','from=&to=']){const r=await researchSourceHttp(new Request(`http://local/api/research-source?${query}`));assert.equal(r.status,400);}
 const m=allowlistedMarket({account:'private',instrument:{name:'EURUSD',password:'private',openingHours:{zone:'UTC',mon:['00:00 - 21:59'],secret:'private'}},snapshot:{bid:1,offer:2,accountId:'private'}});assert.ok(!JSON.stringify(m).includes('private'));
});

test('market specs for position-size arithmetic: margin factor and size increment are allowlisted, account data is not',()=>{
 const m=allowlistedMarket({accountId:'private',instrument:{epic:'US100',currency:'USD',lotSize:1,marginFactor:5,marginFactorUnit:'PERCENTAGE',balance:'private'},
  dealingRules:{minDealSize:{unit:'POINTS',value:0.001},minSizeIncrement:{unit:'POINTS',value:0.001},maxDealSize:{unit:'POINTS',value:1250},accountRule:{unit:'x',value:'private'}},snapshot:{bid:1,offer:2}});
 const i=m.instrument as Record<string,unknown>;assert.equal(i.marginFactor,5);assert.equal(i.marginFactorUnit,'PERCENTAGE');assert.equal(i.lotSize,1);
 assert.deepEqual(m.dealingRules.minSizeIncrement,{unit:'POINTS',value:0.001});assert.ok(!JSON.stringify(m).includes('private'));
});
