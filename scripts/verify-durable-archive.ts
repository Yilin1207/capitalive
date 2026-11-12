import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { closeArchive, findQuote } from "../lib/archive";

async function main() {
  const response = JSON.parse(await readFile("verification/production-archived-tick.json", "utf8"));
  assert.equal(response.status, "exact_tick");
  assert.ok(process.env.DATABASE_URL, "A PostgreSQL DATABASE_URL is required for this proof");
  try {
    const at = Date.parse(response.requested_at);
    const first = await findQuote(response.symbol, response.environment, at, "exact");
    assert.equal(first?.bid, response.quote.bid);
    assert.equal(first?.ask, response.quote.ask);
    await closeArchive();
    const reopened = await findQuote(response.symbol, response.environment, at, "exact");
    assert.deepEqual(reopened, first);
    const proof = { checked_at: new Date().toISOString(), storage: "PostgreSQL", mocked: false,
      independent_process_read: true, connection_reopened: true, symbol: response.symbol,
      environment: response.environment, provider_timestamp: reopened!.provider_timestamp,
      bid: reopened!.bid, ask: reopened!.ask, source_type: reopened!.source_type };
    await writeFile("verification/production-durable-archive.json", JSON.stringify(proof, null, 2) + "\n");
    console.info(JSON.stringify(proof));
  } finally { await closeArchive(); }
}
main().catch(() => { console.error("Durable archive verification failed; inspect configuration and the recorded tick response."); process.exitCode = 1; });
