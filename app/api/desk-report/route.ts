import {paHttp as deskReportHttp} from '@/lib/pa-engine/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export function GET(request:Request){return deskReportHttp(request);}
export function POST(request:Request){return deskReportHttp(request);}
