import {llmsText} from '@/lib/agent-index';
import {PUBLIC_NO_STORE_HEADERS} from '@/lib/http';
export const dynamic='force-dynamic';
export function GET(request:Request){return new Response(llmsText(new URL(request.url).origin),{headers:{...PUBLIC_NO_STORE_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});}
