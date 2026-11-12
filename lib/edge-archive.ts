import "server-only";
import { createHash } from "node:crypto";
import { findQuote, saveEdgeOnce } from "./archive";
import { type PublicSymbol } from "./capital";

export type EdgeInput = { id: string; symbol: PublicSymbol; original_time: string; direction: string; edge: number; source: string };
export async function captureEdge(input: EdgeInput, environment: "demo" | "live", receivedAt = Date.now()) {
  const at = Date.parse(input.original_time);
  // Prefer what was actually known then. Late-arriving observations are labelled explicitly.
  const known = await findQuote(input.symbol, environment, at, "known_before");
  const quote = known ?? await findQuote(input.symbol, environment, at, "before");
  const deviation = quote?.provider_timestamp ? (Date.parse(quote.provider_timestamp) - at) / 1000 : null;
  const receiptDeviation = quote ? (Date.parse(quote.received_at_utc) - at) / 1000 : null;
  const event = { ...input, environment, received_at_utc: new Date(receivedAt).toISOString(),
    price: quote, price_source: quote?.source_type ?? null, tick_age_seconds: deviation === null ? null : -deviation,
    temporal_deviation_seconds: deviation, received_after_signal_seconds: receiptDeviation,
    data_quality: !quote ? "no_data" : !known ? "received_after_signal" : deviation === 0 ? "exact_tick" : "last_known_before_signal",
    exact_at_signal: deviation === 0 && known !== null,
    price_known_at_signal: known !== null,
  };
  const key = createHash("sha256").update(JSON.stringify([environment, input.source, input.id])).digest("hex");
  const saved = await saveEdgeOnce(key, event);
  const conflict = (Object.keys(input) as (keyof EdgeInput)[]).some(key => input[key] !== saved[key]);
  return { event: saved, conflict };
}
