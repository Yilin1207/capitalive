import { NextResponse } from "next/server";
import { capitalSessionStatus } from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";
import { quoteProcessDiagnostics } from "@/lib/quote-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const diagnostics = quoteProcessDiagnostics();
  return NextResponse.json(
    {
      ok: true,
      service: "capitalive",
      capitalSession: capitalSessionStatus(),
      lastSuccessfulQuoteAt: diagnostics.lastSuccessfulQuoteAt,
      uptime: diagnostics.uptime,
    },
    { headers: PUBLIC_NO_STORE_HEADERS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...PUBLIC_NO_STORE_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
