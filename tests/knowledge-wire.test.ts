import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {encodeIntelligence,decodeIntelligence} from '../lib/knowledge/wire';
test('V3 wire dictionary round-trips complete real analysis without dropping rule provenance or evidence',()=>{const r=JSON.parse(readFileSync('verification/capitalive-v3/after/EURUSD-bid.json','utf8')).response;const wire=encodeIntelligence(r),copy=decodeIntelligence(JSON.parse(JSON.stringify(wire)));assert.deepEqual(copy,r);assert.ok(Buffer.byteLength(JSON.stringify(wire))<Buffer.byteLength(JSON.stringify(r))*0.8);assert.equal((copy as typeof r).frames.flatMap((f:{findings:unknown[]})=>f.findings).length,r.frames.flatMap((f:{findings:unknown[]})=>f.findings).length);assert.deepEqual(decodeIntelligence(r),r);});
test('Unknown provenance reference is rejected, not silently replaced by empty evidence',()=>{assert.throws(()=>decodeIntelligence({wire_format:'evidence-dictionary-1',provenance_catalog:{},x:{provenance_ref:'missing'}}));assert.throws(()=>decodeIntelligence({wire_format:'evidence-dictionary-1',provenance_catalog:{},path_level_catalog:[],x:{path_obstacle_refs:[99]}}));});

test('dictionary shares recurring status fields between distinct records while retaining arrays and optional fields',()=>{
 const records=Array.from({length:100},(_,i)=>({
  price:100+i,formation:'CONFIRMED',current_role:null,role_status:'UNVERIFIED',
  review_required:true,liquidity_consumed:false,lifecycle:i%2?'ACTIVE':'TESTED',
  ...(i%3===0?{last_contact_at:null}:{})
 }));
 const original={frames:[records.slice(0,50),records.slice(50)]};
 const encoded=JSON.stringify(encodeIntelligence(original));
 assert.deepEqual(decodeIntelligence(JSON.parse(encoded)),original);
 assert.ok(encoded.length<JSON.stringify(original).length*.8);
});

test('repeated numeric arrays can use object references without a long-string catalog',()=>{
 const candles=Array.from({length:25},(_,i)=>1000+i),original={bars:[candles,candles]};
 const encoded=encodeIntelligence(original);
 assert.deepEqual(decodeIntelligence(JSON.parse(JSON.stringify(encoded))),original);
});
