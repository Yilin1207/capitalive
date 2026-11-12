// Unauthenticated production audit. Prints market data diagnostics, never credentials.
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
const base = process.argv[2] ?? "https://capitalive.vercel.app";
for (const query of ["symbol=NAS100", "symbol=NAS100&w1=20&d1=30&h4=40", "symbol=EU50&w1=2&d1=2&h4=8"]) {
  const response = await fetch(`${base}/api/structure?${query}`, { signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 250));
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  console.log(JSON.stringify({ query, environment: body.environment, decoded_json_bytes: Buffer.byteLength(text),
    gzip_estimated_bytes: gzipSync(text).byteLength,
    frames: Object.fromEntries(["W1", "D1", "H4"].map(tf => [tf, {
      count: body[tf].length, fetched_at: body.metadata[tf].fetched_at,
      latest: body[tf].at(-1), diagnostics: body.metadata[tf].diagnostics,
    }])),
  }));
}
process.exit(0);
