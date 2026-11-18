import {researchSourceHttp} from '@/lib/research/source-http';
import {historyOptions} from '@/lib/history-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return researchSourceHttp(request);}
export const OPTIONS=historyOptions;
