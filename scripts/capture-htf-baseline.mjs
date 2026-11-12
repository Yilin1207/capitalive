import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = 'verification/capitalive-v2-1';
await mkdir(root, { recursive: true });
const results = [];
for (const [name, path] of [
  ...['NAS100', 'EURUSD', 'EU50'].map(s => [`${s}-audit`, `/api/market-audit?symbol=${s}&include_candles=1`]),
  ['structure', '/api/structure?symbol=EURUSD&mn1=60&w1=20&d1=30&h4=40'],
  ['quotes', '/api/quotes'], ['chart', '/api/chart?symbol=EURUSD&timeframe=H4'],
]) {
  const url = `https://capitalive.vercel.app${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type');
  const extension = type?.includes('image/png') ? 'png' : 'json';
  await writeFile(`${root}/baseline-${name}.${extension}`, bytes);
  const result = { name, url, checked_at: new Date().toISOString(), status: response.status, type,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  if (extension === 'png' && response.ok) {
    const info = await sharp(bytes).metadata(); result.dimensions = [info.width, info.height];
  } else if (response.ok) {
    const json = JSON.parse(bytes); result.ok = json.ok; result.schema = json.schema_version;
  }
  results.push(result); console.log(JSON.stringify(result));
  await writeFile(`${root}/baseline-http.json`, JSON.stringify(results, null, 2));
}
