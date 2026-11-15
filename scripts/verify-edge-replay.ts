import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildIntelligence } from "../lib/knowledge/intelligence";
import type { CandleResponse, Timeframe } from "../lib/candle-data";
import type { MarketQuote } from "../lib/quote-normalization";
const rows = [];
for (const symbol of ["EURUSD", "NAS100", "EU50"]) {
  const path = `tests/fixtures/htf-${symbol}.json`,
    raw = readFileSync(path, "utf8");
  const fixture = JSON.parse(raw) as {
    provenance: unknown;
    data: Record<Timeframe, CandleResponse>;
    quote: MarketQuote;
  };
  for (const side of ["bid", "ask"] as const) {
    const started = performance.now(),
      result = buildIntelligence(fixture.data, side, fixture.quote);
    const events = result.frames.flatMap((f) => f.findings),
      bytes = Buffer.byteLength(JSON.stringify(result));
    if (
      events.some(
        (e) =>
          e.confirmed_at > result.as_of ||
          e.candle_evidence.some((c) => c.closed_at > e.confirmed_at),
      )
    )
      throw new Error("Future evidence");
    if (new Set(events.map((e) => e.id)).size !== events.length)
      throw new Error("Duplicate finding IDs");
    if (bytes > 4_250_000) throw new Error("Response budget exceeded");
    rows.push({
      symbol,
      side,
      input_kind: "RECORDED_PROVIDER_DEMO_NOT_LIVE",
      fixture: path,
      sha256: createHash("sha256").update(raw).digest("hex"),
      provenance: fixture.provenance,
      as_of: result.as_of,
      bytes,
      duration_ms: Math.round(performance.now() - started),
      findings: events.length,
      frames: result.frames.map((f) => ({
        tf: f.timeframe,
        closed: f.closed_candles,
        findings: f.findings.length,
        status: f.data_status,
      })),
      narrative: result.narrative.bias,
      verdict: result.verdict.status,
      risk: result.risk.status,
      probability: result.assessment.probability_tp,
    });
  }
}
console.log(
  JSON.stringify(
    { validation: "DETECTOR_REPLAY_ONLY_NO_PROFITABILITY_CLAIM", rows },
    null,
    2,
  ),
);
