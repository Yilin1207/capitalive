import { paHttp as intelligenceHttp } from "@/lib/pa-engine/http";
import { historyOptions } from "@/lib/history-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return intelligenceHttp(request);
}
export const POST=GET;
export function OPTIONS(){const r=historyOptions();r.headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');return r;}
