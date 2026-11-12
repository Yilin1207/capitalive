import { mkdir, writeFile } from "node:fs/promises";
import { capitalEnvironment, getMarketSummaries, VERIFIED_MARKETS } from "../lib/capital";
import { streamQuotes } from "../lib/capital-stream";
import { getCandles } from "../lib/candles";
import { quoteAt } from "../lib/quote-at";
import { closeArchive } from "../lib/archive";

async function main() {
  const symbols = ["BRENT", "NAS100", "JP225", "EURUSD", "GER40", "EU50", "UK100"] as const;
  const report: Record<string, unknown> = { checked_at: new Date().toISOString(), environment: capitalEnvironment(), mocked: false };
  const epics = symbols.map(symbol => VERIFIED_MARKETS[symbol].epic);
  const stream = await streamQuotes(epics, { durationMs: 20_000 });
  report.websocket = stream;
  console.info(JSON.stringify({ websocket: stream }, null, 2));
  const summaries = await getMarketSummaries(epics);
  report.rest = Object.fromEntries(symbols.map(symbol => {
    const row = summaries[VERIFIED_MARKETS[symbol].epic];
    return [symbol, { bid: row?.bid, ask: row?.offer, updateTimeUTC: row?.updateTimeUTC ?? null, market_status: row?.marketStatus }];
  }));
  const months: Record<string, unknown> = {};
  for (const symbol of symbols) {
    try {
      const result = await getCandles(symbol, "MN1", 60);
      months[symbol] = result;
      console.info(JSON.stringify({ symbol, months: result.candles.length, first: result.candles[0]?.time, last: result.candles.at(-1), metadata: result.metadata }));
    } catch (error) {
      months[symbol] = { error: error instanceof Error ? error.message : "unavailable" };
      console.info(JSON.stringify({ symbol, result: months[symbol] }));
    }
  }
  report.months = months;
  try { report.quote_at = await quoteAt("BRENT", "2026-11-05T21:21:30.000Z"); }
  catch { report.quote_at = { status: "upstream_unavailable", exact: false }; }
  console.info(JSON.stringify({ quote_at: report.quote_at }, null, 2));
  await mkdir("data", { recursive: true });
  await writeFile("data/capital-live-verification.json", JSON.stringify(report, null, 2));
  await closeArchive();
}
main().catch(() => { console.error("Live verification unavailable; check server configuration/upstream diagnostics."); process.exitCode = 1; });
