// Freeze gate and scoring are independent of detector execution.
import {createHash} from 'node:crypto';
import {canonical,frozenPayload,type BlindCase,type FrozenLabels,type BlindLabel,type Annotation} from './blind';
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function verifyFrozen(value:unknown,pack:{pack_id:string;cases:BlindCase[]},now=Date.now()):FrozenLabels{
 if(!value||typeof value!=='object')throw Error('Frozen labels required');const b=value as FrozenLabels;
 if(b.schema!=='capitalive-blind-labels-1'||b.status!=='FROZEN'||b.pack_id!==pack.pack_id||b.independence!=='USER_BLIND_TO_ALGORITHM_NOT_EXPERT_ADJUDICATED'||!Array.isArray(b.labels)||!Number.isFinite(Date.parse(b.frozen_at))||Date.parse(b.frozen_at)>now)throw Error('Invalid or unfrozen benchmark');
 const {sha256,...payload}=b;if(hash(payload)!==sha256)throw Error('Label checksum mismatch');
 if(hash(pack.cases.map(c=>({id:c.id,hash:c.case_sha256})))!==pack.pack_id)throw Error('Pack checksum mismatch');
 for(const c of pack.cases){const {case_sha256,...data}=c;if(hash(data)!==case_sha256)throw Error('Candle checksum mismatch');}
 frozenPayload(pack.pack_id,b.labels,pack.cases,b.frozen_at);return structuredClone(b);
}
export type BenchmarkEvent=Pick<Annotation,'timeframe'|'kind'|'origin'|'confirmed_at'> & {id:string;lower:number|null;upper:number|null};
const key=(v:Pick<BenchmarkEvent,'timeframe'|'kind'|'origin'|'confirmed_at'>)=>`${v.timeframe}:${v.kind}:${new Date(v.origin).toISOString()}:${new Date(v.confirmed_at).toISOString()}`;
export function scoreEvents(label:BlindLabel,events:BenchmarkEvent[]){
 const scope=new Set(label.complete_concepts),relevant=(e:{timeframe:string;kind:string})=>scope.has(`${e.timeframe}:${e.kind}`),uncertain=new Set(label.annotations.filter(a=>a.validity==='UNCERTAIN').map(key));
 const positives=label.annotations.filter(a=>a.validity==='VALID'&&relevant(a)),predicted=events.filter(e=>relevant(e)&&!uncertain.has(key(e))),used=new Set<string>(),matches:{manual:string;prediction:string;bounds_exact:boolean|null}[]=[],falsePositives:string[]=[];
 for(const p of predicted){const m=positives.find(m=>!used.has(m.id)&&key(m)===key(p));if(!m)falsePositives.push(p.id);else{used.add(m.id);matches.push({manual:m.id,prediction:p.id,bounds_exact:p.lower===null||p.upper===null?null:p.lower===m.lower&&p.upper===m.upper});}}
 const falseNegatives=positives.filter(m=>!used.has(m.id)).map(m=>m.id),tp=matches.length,fp=falsePositives.length,fn=falseNegatives.length;
 return {scope:[...scope],matching_policy:'Exact TF, concept, first construction candle and confirmation close; one-to-one; bounds assessed separately, no fitted tolerance',tp,fp,fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,matches,false_positives:falsePositives,false_negatives:falseNegatives,excluded_uncertain:uncertain.size,unscored_predictions:events.length-predicted.length};
}
