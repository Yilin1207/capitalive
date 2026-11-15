import {deskReportHttp} from '@/lib/research-bridge/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export function GET(request:Request){return deskReportHttp(request);}
