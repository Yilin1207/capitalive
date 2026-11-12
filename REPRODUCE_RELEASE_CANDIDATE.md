# Reproduce Capitalive 2.1 release candidate

This is an undeployed local candidate. Previous audited source checkpoint:
`5516a6fd8c02ad28fd0f054cf9026c42adecb416`
(`checkpoint/capitalive-2-1-before-bugfix`). It preserves the source from the
previous `CAPITALIVE_2_1_FINAL_REVIEW.zip`. No main merge or Vercel operation is needed.

## Install and verify

Verified environment: Node.js 24.15.0, Windows, Next.js 16.4.2. Dependencies and
lockfile are unchanged. In a fresh extracted directory:

```sh
npm ci
npx playwright install chromium
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:ui
node scripts/verify-rc-http.mjs
node --conditions=react-server --import tsx scripts/audit-release-candidate.ts
```

Installation requires package downloads. Tests use local fixtures and need no
private credentials or live market access. `lint` is the project's existing
TypeScript check, not ESLint. UI tests start the production build on port 3101.
`scripts/verify-release-candidate.mjs` runs all these checks (except installation)
and captures logs/exit codes; its npm-cli discovery targets the tested Windows
Node distribution. On other installations use the individual commands above.

## Actual HTTP integration

`scripts/verify-rc-http.mjs` starts a separate production Next server on loopback
port 3102 with the test-only `tests/rc-upstream-preload.mjs`. Application routes,
normalization, caching and rendering execute normally. Only the Capital transport
is replaced with recorded fixture responses; unexpected nonlocal fetches are
blocked. Synthetic authentication values are non-secret and never usable externally.

This checks all three instruments and BID/ASK, legacy JSON routes, new risk fields,
PNG signatures/decoding, snapshot page reconstruction/checksums and error statuses.
The test stops its own server afterward. Monthly aggregation has only the available
recorded D1 bars, so this transport test deliberately has less monthly history than
the six direct-service fixtures. It is not a fresh Capital.com or production check.

`audit-release-candidate.ts` separately evaluates the complete preserved MN1/W1/D1/H4
DEMO snapshots on six symbol/side combinations and writes exact full/priority sizes
and explained obstacles. These snapshots are historical, not current quotes.

## Read the evidence

- `CAPITALIVE_2_1_BUGFIX_AUDIT_RU.md`: findings and readiness limitations.
- `verification/capitalive-v2-1/rc/independent-audit-input.md`: supplied independent audit.
- `verification/capitalive-v2-1/rc/checks.json`: final command exit codes.
- `verification/capitalive-v2-1/rc/recorded-contracts.json`: all six complete snapshots.
- `verification/capitalive-v2-1/rc/http-contracts.json`: actual loopback HTTP results.
- `verification/capitalive-v2-1/rc/http-*.png`: decoded HTTP PNG examples.
- `tests/htf-risk-regression.test.ts`: scenario expectations and their business rationale.
- `tests/audit-snapshot.test.ts`: oversized snapshot, growth, byte integrity, expiry and errors.

Existing SNR/structure/FVG/range/archive/worker/EDGE regression tests are retained.
Previous-stage logs and charts remain historical evidence; `rc/` is authoritative
for this candidate. Own synthetic tests are not independent human market labels.

## Download a complete snapshot

```sh
node scripts/download-audit-snapshot.mjs "http://127.0.0.1:3000/api/htf-zones?symbol=NAS100&side=ask&include_candles=1&view=snapshot" audit.json
```

This requires a running, configured server; an unconfigured local installation
returns an explicit provider configuration error. The integration script supplies
its isolated fixture transport automatically and uses port 3102 instead.

`view=snapshot` returns a manifest. Each page is base64 of at most 512 KiB of the
original UTF-8 JSON bytes. Concatenate decoded chunks, verify byte count and SHA-256,
then parse JSON. Snapshot ID also binds route and exact canonical request parameters.
The supplied client verifies both hashes and retries 429 within the expiry window.
Full `htf-zones` snapshots intentionally contain the complete `market-audit` document;
this is declared in the manifest. Default/full and priority contracts retain their
existing shapes. The UI's audit link selects priority explicitly.

Storage is process-local: ten-minute TTL, 64 MiB maximum document, 96 MiB total.
Expired/evicted/restarted/other-instance snapshots return 410; parameter mismatches
return 409. Never mix pages or silently substitute a new snapshot. Distributed
persistence is not implemented and needs resolution before a serverless rollout.

## Package and integrity

`SOURCE_DIFF.patch` and `CHANGED_FILES.txt` compare source/tests/docs with the previous
checkpoint; generated evidence is inventoried separately in the complete SHA-256
manifest. No `.git` history, `.env*`, node_modules, databases or Vercel credentials
are included. Personal local paths are redacted in the review copy. The archive's
SHA-256 is supplied beside the ZIP; file-level hashes are inside
`REVIEW_PACKAGE_MANIFEST.json`. `SECURITY_REVIEW.json` records scan scope and limits.

From the original Git checkout, `node scripts/package-final-review.mjs --rc` prepares
an allowlisted staging directory. It requires the checkpoint branch and staged new
source files so the diff includes them; then compress that directory as ZIP. This
packaging step is not necessary to reproduce the tests in an extracted archive.
