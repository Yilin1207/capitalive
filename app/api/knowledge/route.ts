import { searchKnowledge } from "@/lib/knowledge/rules";
export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length > 200)
    return Response.json(
      { ok: false, error: "QUERY_TOO_LONG" },
      { status: 400 },
    );
  return Response.json(
    { ok: true, ...searchKnowledge(q) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
