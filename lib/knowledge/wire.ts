// Lossless JSON dictionary encoding of repeated rule provenance. No findings are truncated.
// Shared by server and browser; no Node or algorithm imports.
const fields=['sources','rule_version','rule_status','specification','basis','counterarguments'] as const;
type JsonObject=Record<string,unknown>;
export function encodeIntelligence(input:unknown){
 const catalog:Record<string,JsonObject>={},seen=new Map<string,string>(),levelIds:string[]=[],idIndex=new Map<string,number>();
 function visit(value:unknown):unknown{if(Array.isArray(value))return value.map(visit);if(!value||typeof value!=='object')return value;
  const original=value as JsonObject,copy:JsonObject={...original};
  if(typeof copy.rule_id==='string'&&(Array.isArray(copy.sources)||Array.isArray(copy.counterarguments))){const shared:JsonObject={};for(const k of fields)if(copy[k]!==undefined){shared[k]=copy[k];delete copy[k];}const key=JSON.stringify(shared);let ref=seen.get(key);if(!ref){ref=`p${seen.size}`;seen.set(key,ref);catalog[ref]=shared;}copy.provenance_ref=ref;}
  if(Array.isArray(copy.path_obstacle_ids)){copy.path_obstacle_refs=copy.path_obstacle_ids.map(id=>{if(typeof id!=='string')throw Error('Invalid obstacle ID');let index=idIndex.get(id);if(index===undefined){index=levelIds.length;idIndex.set(id,index);levelIds.push(id);}return index;});delete copy.path_obstacle_ids;}
  return Object.fromEntries(Object.entries(copy).map(([k,v])=>[k,visit(v)]));
 }
 const body=visit(input) as JsonObject;return {...body,wire_format:'evidence-dictionary-1',provenance_catalog:catalog,path_level_catalog:levelIds};
}
export function decodeIntelligence<T>(input:unknown):T{
 if(!input||typeof input!=='object'||(input as JsonObject).wire_format!=='evidence-dictionary-1')return input as T;
 const {wire_format,provenance_catalog,path_level_catalog,...body}=input as JsonObject,catalog=provenance_catalog as Record<string,JsonObject>,levelIds=path_level_catalog as string[];
 if(!catalog||typeof catalog!=='object')throw Error('Missing provenance catalog');
 function visit(value:unknown):unknown{if(Array.isArray(value))return value.map(visit);if(!value||typeof value!=='object')return value;
  const copy=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));if(Array.isArray(copy.path_obstacle_refs)){copy.path_obstacle_ids=copy.path_obstacle_refs.map(index=>{if(!Number.isInteger(index)||!Array.isArray(levelIds)||typeof levelIds[index]!=='string')throw Error('Unknown path level reference');return levelIds[index];});delete copy.path_obstacle_refs;}if('provenance_ref' in copy){const ref=copy.provenance_ref;if(typeof ref!=='string'||!Object.prototype.hasOwnProperty.call(catalog,ref))throw Error('Unknown provenance reference');delete copy.provenance_ref;return {...catalog[ref],...copy};}return copy;
 }
 return visit(body) as T;
}
