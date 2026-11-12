// Read-only verification against existing public Capitalive history. Does not deploy or simulate a live provider.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
import assert from "node:assert/strict";
import { marketAudit } from "../lib/market-audit";
import { evaluateQuote } from "../lib/analysis-quote";
import { unavailable, type MarketQuote } from "../lib/quote-normalization";
import { ANALYSIS_SYMBOLS, ANALYSIS_TIMEFRAMES, analyzeSeries } from "../lib/technical-analysis";
import type { CandleResponse } from "../lib/candle-data";
import { chartSvg } from "../lib/chart-svg";

async function main() {
const replay = process.argv.includes("--recorded");
const base = new URL(process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "https://capitalive.vercel.app");
const output = "verification/capitalive-v2";
await mkdir(output, { recursive: true });
async function get(path: string) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Public data request failed: HTTP ${response.status} ${path}`);
  return response.json();
}
const results = [];
for (const symbol of ANALYSIS_SYMBOLS) {
  const raw = replay ? JSON.parse(await readFile(`${output}/public-${symbol}-structure.json`, "utf8"))
    : await get(`/api/structure?symbol=${symbol}&mn1=60&w1=120&d1=200&h4=240`);
  await writeFile(`${output}/public-${symbol}-structure.json`, JSON.stringify(raw, null, 2) + "\n");
  const previous = replay ? JSON.parse(await readFile(`${output}/${symbol}-audit.json`, "utf8")) : null;
  const quotes = replay ? null : await get("/api/quotes");
  const quote: MarketQuote = previous?.quote ?? quotes?.markets?.[symbol] ?? unavailable(symbol, null);
  const evaluatedAt = replay ? previous.quote.evaluated_at : new Date().toISOString();
  const series = Object.fromEntries(ANALYSIS_TIMEFRAMES.map(tf => [tf, {
    ok: true, symbol, epic: raw.epic, provider: raw.provider, environment: raw.environment, price_side: "bid_ask",
    timeframe: tf, fetched_at: raw.metadata[tf].fetched_at, candles: raw[tf], metadata: raw.metadata[tf],
  }])) as Record<typeof ANALYSIS_TIMEFRAMES[number], CandleResponse>;
  const response = await marketAudit(new Request(new URL(`/api/market-audit?symbol=${symbol}`, base)), {
    getCandles: async (_symbol, tf) => series[tf],
    getAnalysisQuote: async () => ({ ...evaluateQuote(quote, Date.parse(evaluatedAt)), cache_hit: false, evaluated_at: evaluatedAt }),
  });
  assert.equal(response.status, 200);
  const audit = await response.json();
  if (replay) { audit.generated_at = previous.generated_at; audit.verification_replay = true; }
  await writeFile(`${output}/${symbol}-audit.json`, JSON.stringify(audit, null, 2) + "\n");
  for (const tf of ANALYSIS_TIMEFRAMES) {
    const data = series[tf], analysis = analyzeSeries(data, symbol);
    const bytes = await sharp(Buffer.from(chartSvg(data, analysis, symbol, "bid"))).png().toBuffer();
    assert.equal((await sharp(bytes).metadata()).format, "png");
    await writeFile(`${output}/${symbol}-${tf}.png`, bytes);
    for (const fractal of analysis.fractals) {
      const window = data.candles.slice(fractal.index - 2, fractal.index + 3);
      assert.equal(window.length, 5); assert.ok(window.every(c => c.is_closed));
      assert.ok(window.filter((_, i) => i !== 2).every(c => fractal.kind === "high" ? c.high.bid! < fractal.price : c.low.bid! > fractal.price));
    }
    const range = analysis.ranges.selected;
    if (range.status === "confirmed") assert.equal(range.equilibrium, (range.high!.price + range.low!.price) / 2);
    results.push({ symbol, timeframe: tf, environment: data.environment, candles: data.candles.length,
      fetched_at: data.fetched_at, fractals: analysis.fractals.length, swept: analysis.swept_fractals.length,
      fvgs: analysis.fvgs.length, material_fvgs: analysis.fvgs.filter(g => g.material).length,
      warnings: analysis.warnings, png_verified: true, invariants_passed: true });
  }
  console.log(JSON.stringify({ symbol, ok: true, quote_fresh: audit.quote.fresh, consistency: audit.consistency.status, warnings: audit.warnings.length }));
}
await writeFile(`${output}/public-data-verification.json`, JSON.stringify({ checked_at: new Date().toISOString(), data_source: base.origin,
  verification_scope: `${replay ? "Recorded replay of" : "Downloaded"} real public Capitalive responses through new local analysis and PNG renderer. NOT a deployment or HTTP success check of new public routes.`,
  new_routes_deployed: false, results }, null, 2) + "\n");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Public data verification failed"); process.exitCode = 1; });
