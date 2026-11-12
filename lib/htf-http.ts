import { marketAudit } from './market-audit';
import { historyJson } from './history-http';

/** Same loader, rate budget and snapshot as the existing audit; never self-fetch public APIs. */
export async function htfZones(request: Request, dependencies?: Parameters<typeof marketAudit>[1]) {
  if (new URL(request.url).searchParams.get('htf') === '0')
    return historyJson({ ok: false, error: { code: 'INVALID_HTF', message: 'htf-zones requires HTF analysis; use market-audit?htf=0 for legacy-only output' } }, 400);
  const response = await marketAudit(request, dependencies);
  if (!response.ok) return response;
  const body = await response.json();
  return historyJson({ ok: true, schema_version: '2.1', symbol: body.symbol, provider: body.provider, generated_at: body.generated_at,
    ...body.htf, charts: body.charts });
}
