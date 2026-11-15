import { intelligenceHttp } from "@/lib/knowledge/http";
import { historyOptions } from "@/lib/history-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return intelligenceHttp(request);
}
export const OPTIONS = historyOptions;
