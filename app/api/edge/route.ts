import { timingSafeEqual } from "node:crypto";
import { archiveConfigured } from "@/lib/archive";
import { capitalEnvironment, PUBLIC_SYMBOLS, type PublicSymbol } from "@/lib/capital";
import { captureEdge } from "@/lib/edge-archive";
import { providerTime } from "@/lib/tick-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  const token = process.env.EDGE_INGEST_TOKEN;
  if (!token || !archiveConfigured()) return json({ ok: false, error: "EDGE_ARCHIVE_NOT_CONFIGURED" }, 503);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "INVALID_EDGE" }, 400);
  const originalTime = providerTime(body.original_time);
  if (!originalTime || !body.original_time.endsWith("Z") || Date.parse(originalTime) > Date.now()
    || !PUBLIC_SYMBOLS.includes(body.symbol as PublicSymbol)
    || typeof body.edge !== "number" || !Number.isFinite(body.edge)
    || [body.id, body.direction, body.source].some(value => typeof value !== "string" || !value.trim() || value.length > 200)) {
    return json({ ok: false, error: "INVALID_EDGE" }, 400);
  }
  try {
    const result = await captureEdge({ id: body.id, symbol: body.symbol, original_time: originalTime,
      direction: body.direction, edge: body.edge, source: body.source }, capitalEnvironment());
    return json({ ok: !result.conflict, ...result }, result.conflict ? 409 : 200);
  } catch { return json({ ok: false, error: "EDGE_ARCHIVE_UNAVAILABLE" }, 503); }
}
