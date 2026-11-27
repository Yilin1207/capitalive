import pack from '@/knowledge/research/blind-pack.json';
import {historyJson,historyOptions} from '@/lib/history-http';
export const dynamic='force-dynamic';
export function GET(request:Request){const id=new URL(request.url).searchParams.get('case_id');if(id){const item=pack.cases.find(c=>c.id===id);return item?historyJson(item):historyJson({ok:false,error:{code:'UNKNOWN_CASE',message:'Unknown blind case'}},404);}return historyJson({ok:true,pack_id:pack.pack_id,schema:pack.schema,cases:pack.cases.map(c=>({id:c.id,symbol:c.symbol,as_of:c.as_of,case_sha256:c.case_sha256,price_side:c.price_side}))});}
export const OPTIONS=historyOptions;
