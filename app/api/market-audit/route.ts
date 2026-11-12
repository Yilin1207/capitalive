import { marketAudit } from "@/lib/market-audit";
import { historyOptions } from "@/lib/history-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) { return marketAudit(request); }
export const OPTIONS = historyOptions;
