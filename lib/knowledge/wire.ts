// Lossless JSON dictionary encoding of repeated rule provenance. No findings are truncated.
// Shared by server and browser; no Node or algorithm imports.
const fields=['sources','rule_version','rule_status','specification','basis','counterarguments'] as const;
type JsonObject=Record<string,unknown>;
export function encodeIntelligence(input:unknown){
 const contextStrings:string[]=[],contextIndexes=new Map<string,number>();
 function encodeContext(value:unknown):unknown{if(typeof value==='string'&&value.length>24){let i=contextIndexes.get(value);if(i===undefined){i=contextStrings.length;contextIndexes.set(value,i);contextStrings.push(value);}return {context_string_ref:i};}
  if(Array.isArray(value))return value.map(encodeContext);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeContext(v)]));return value;}
 const catalog:Record<string,JsonObject>={},seen=new Map<string,string>(),levelIds:string[]=[],idIndex=new Map<string,number>();
 function visit(value:unknown):unknown{if(Array.isArray(value))return value.map(visit);if(!value||typeof value!=='object')return value;
  const original=value as JsonObject,copy:JsonObject={...original};
  if(typeof copy.rule_id==='string'&&(Array.isArray(copy.sources)||Array.isArray(copy.counterarguments))){const shared:JsonObject={};for(const k of fields)if(copy[k]!==undefined){shared[k]=copy[k];delete copy[k];}const key=JSON.stringify(shared);let ref=seen.get(key);if(!ref){ref=`p${seen.size}`;seen.set(key,ref);catalog[ref]=shared;}copy.provenance_ref=ref;}
  if(Array.isArray(copy.path_obstacle_ids)){copy.path_obstacle_refs=copy.path_obstacle_ids.map(id=>{if(typeof id!=='string')throw Error('Invalid obstacle ID');let index=idIndex.get(id);if(index===undefined){index=levelIds.length;idIndex.set(id,index);levelIds.push(id);}return index;});delete copy.path_obstacle_ids;}
  return Object.fromEntries(Object.entries(copy).map(([k,v])=>[k,visit(v)]));
 }
 let body=encodeContext(visit(input)) as JsonObject;const contextObjects:unknown[]=[],objectIndexes=new Map<string,number>(),counts=new Map<string,number>();
 function count(v:unknown){if(!v||typeof v!=='object')return;const key=JSON.stringify(v);if(key.length>60)counts.set(key,(counts.get(key)??0)+1);Object.values(v).forEach(count);}count(body);
 function pack(v:unknown):unknown{if(!v||typeof v!=='object')return v;const key=JSON.stringify(v);if((counts.get(key)??0)>1){let i=objectIndexes.get(key);if(i===undefined){const value=Array.isArray(v)?v.map(pack):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)]));i=contextObjects.length;objectIndexes.set(key,i);contextObjects.push(value);}return {context_object_ref:i};}return Array.isArray(v)?v.map(pack):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)]));}
 body=pack(body) as JsonObject;
 return {...body,wire_format:'evidence-dictionary-2',provenance_catalog:catalog,path_level_catalog:levelIds,...(contextStrings.length?{context_string_catalog:contextStrings,context_object_catalog:contextObjects}:{})};
}
export function decodeIntelligence<T>(input:unknown):T{
 if(!input||typeof input!=='object'||!['evidence-dictionary-1','evidence-dictionary-2'].includes(String((input as JsonObject).wire_format)))return input as T;
 const {wire_format,provenance_catalog,path_level_catalog,context_string_catalog,context_object_catalog,...body}=input as JsonObject,catalog=provenance_catalog as Record<string,JsonObject>,levelIds=path_level_catalog as string[];
 if(!catalog||typeof catalog!=='object')throw Error('Missing provenance catalog');
 const activeRefs=new Set<number>();
 function visit(value:unknown):unknown{if(Array.isArray(value))return value.map(visit);if(!value||typeof value!=='object')return value;
  if(Object.hasOwn(value,'context_object_ref')){const i=(value as JsonObject).context_object_ref as number;if(Object.keys(value).length!==1||!Number.isSafeInteger(i)||i<0||!Array.isArray(context_object_catalog)||i>=context_object_catalog.length||activeRefs.has(i))throw Error('Unknown context object reference');activeRefs.add(i);const result=visit(context_object_catalog[i]);activeRefs.delete(i);return result;}
  if(Object.hasOwn(value,'context_string_ref')){const index=(value as JsonObject).context_string_ref;if(Object.keys(value).length!==1||!Number.isSafeInteger(index)||!Array.isArray(context_string_catalog)||typeof context_string_catalog[index as number]!=='string')throw Error('Unknown context string reference');return context_string_catalog[index as number];}
  const copy=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));if(Array.isArray(copy.path_obstacle_refs)){copy.path_obstacle_ids=copy.path_obstacle_refs.map(index=>{if(!Number.isInteger(index)||!Array.isArray(levelIds)||typeof levelIds[index]!=='string')throw Error('Unknown path level reference');return levelIds[index];});delete copy.path_obstacle_refs;}if('provenance_ref' in copy){const ref=copy.provenance_ref;if(typeof ref!=='string'||!Object.prototype.hasOwnProperty.call(catalog,ref))throw Error('Unknown provenance reference');delete copy.provenance_ref;return {...catalog[ref],...copy};}return copy;
 }
 return visit(body) as T;
}
