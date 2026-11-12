# Reproduce Capitalive 2.1 final review

This package is a local review artifact, not a production deployment. Checkpoint:
`a07395ee73d4ecfdc0445109a66d2e4e2ac3193a`, branch
`checkpoint/capitalive-2-1-before-final-review`. The final source is identified by
`REVIEW_PACKAGE_MANIFEST.json` SHA-256 values inside the ZIP and the source diff.

## Requirements and installation

Use Node.js 24.x (verified with 24.15.0), npm, and a supported Windows/Linux/macOS
environment. Extract the ZIP into a new directory, then run:

```sh
npm ci
npx playwright install chromium
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:ui
```

No Capital.com, GitHub, database or Vercel credentials are required for these tests.
The ZIP deliberately excludes `.env*`, `.git`, `.vercel`, databases, node_modules,
build caches and private configuration. Never run deployment or archive ingestion
scripts as part of this audit. No additional dependencies were introduced by the
final refinement; use the included lockfile.

`npm run lint` is configured as `tsc --noEmit`, not ESLint. The separate TypeScript
command is recorded because it was requested. Playwright starts and stops the local
production server on port 3101 and uses fixture responses for successful data paths.

## Reproduce evidence offline

```sh
node --conditions=react-server --import tsx scripts/verify-htf-upgrade.ts
node --conditions=react-server --import tsx scripts/audit-final-contracts.ts
node --conditions=react-server --import tsx scripts/render-htf-review.ts
```

Open `verification/capitalive-v2-1/final-charts/index.html` locally. It contains 12
real historical charts, one focused NAS100 W1 chart and 11 predeclared synthetic
scenarios. Real fixtures retain capture time, provider/environment and source hash.
Synthetic expectations are in `tests/fixtures/htf-review-annotations.json`; they are
authored partial cases, not independent human expert labels. Precision/recall are
explicitly unknown. Refreshing network data is not needed for this review.

`scripts/verify-final-review.mjs` runs the five required checks and records UTF-8
logs. Its npm-cli discovery targets the verified Windows Node distribution; on
other installations run the five commands above directly.

## API and chart inspection

```text
/api/market-audit?symbol=NAS100
/api/htf-zones?symbol=NAS100&view=full
/api/htf-zones?symbol=NAS100&view=priority
/api/chart?symbol=NAS100&timeframe=W1&snr_mn1=1&snr_w1=1&snr_d1=1&snr_h4=1&snr_events=1
```

A normal local server without private Capital configuration cannot fetch live
prices. A configuration error is expected for those real-provider requests; the
automated HTTP service tests use preserved real OHLC to verify JSON and PNG success,
plus explicit error paths. Do not mistake fixture success for a published endpoint.

The full-catalog limit is 4,250,000 bytes; excess returns an explicit error, not a
truncated success. The compact priority view is around 100–119 KB on the recorded
set. Priority and image limits do not remove candidates from full evidence.

## Files for independent review

- `CAPITALIVE_2_1_FINAL_AUDIT_RU.md`: results and limitations.
- `SOURCE_DIFF.patch`: changes from the checkpoint, including new source/tests.
- `CHANGED_FILES.txt`: changed paths.
- `verification/capitalive-v2-1/final-checks.json`: command exit codes.
- `verification/capitalive-v2-1/final-contracts.json`: all symbols/sides, response
  sizes, snapshot consistency and risk geometry.
- `verification/capitalive-v2-1/final-charts/index.json`: image provenance.
- `SECURITY_REVIEW.json`: packaging exclusions, scanner scope and path redactions.
- `REVIEW_PACKAGE_MANIFEST.json`: hashes of packaged files (except itself).

Earlier/progress logs are retained for transparency. `final-*` logs and the final
report are authoritative for this refinement. Personal local paths in the review
copy are replaced with `<WORKSPACE>` / `<USER_HOME>`; failure details and outputs
are retained. Test-only fake authentication values are synthetic fixtures, not
usable credentials. Copyright notices of bundled dependencies/fonts are preserved.
