import { chartResponse } from '@/lib/chart-http';
import { historyOptions } from '@/lib/history-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) { return chartResponse(request); }
export const OPTIONS = historyOptions;
