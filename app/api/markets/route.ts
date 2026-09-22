import { NextResponse } from "next/server";
import {
  ensureCapitalSession,
  PUBLIC_SYMBOLS,
  resolveAllMarkets,
  type MarketMapping,
  type PublicSymbol,
} from "@/lib/capital";
import { PUBLIC_NO_STORE_HEADERS } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_NO_STORE_HEADERS });
}

export async function GET() {
  try {
    await ensureCapitalSession();
    const resolved = await resolveAllMarkets();
    if (PUBLIC_SYMBOLS.some((symbol) => resolved[symbol] === null)) {
      throw new Error("Market discovery incomplete");
    }

    const markets = {} as Record<PublicSymbol, MarketMapping>;
    for (const symbol of PUBLIC_SYMBOLS) {
      markets[symbol] = resolved[symbol] as MarketMapping;
    }
    return json(markets);
  } catch {
    return json(
      {
        server_time: new Date().toISOString(),
        source: "Capital.com Public API",
        error: "Capital.com upstream unavailable",
      },
      502,
    );
  }
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
