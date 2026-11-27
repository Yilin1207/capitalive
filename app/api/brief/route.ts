import {paHttp} from '@/lib/pa-engine/http';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export function GET(request:Request){return paHttp(request,'brief');}
