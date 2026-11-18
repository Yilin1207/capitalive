import {paHttp as deskReportHttp} from '@/lib/pa-engine/http';
import {marketContextHttp} from '@/lib/context/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export function GET(request:Request){return new URL(request.url).searchParams.get('view')==='market-context'?marketContextHttp(request):deskReportHttp(request);}
export function POST(request:Request){return deskReportHttp(request);}
