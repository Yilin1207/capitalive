# Capitalive 2.1 RC2: contact coverage and snapshot availability

The previous audited candidate is preserved at Git checkpoint
`fd09b847d56d1a424e3f9bf6fc71aa04584b4c77`, branch
`checkpoint/capitalive-2-1-before-contact-fix`. Existing ZIPs remain unchanged.
This candidate has not been deployed. See `CAPITALIVE_2_1_RC2_CONTACT_AUDIT_RU.md`.

## Reproduce

Use Node.js 24.15.0 (tested Windows installation). Extract the ZIP, then:

```sh
npm ci
npx playwright install chromium
node scripts/verify-release-candidate.mjs --rc2
```

The runner executes npm test, lint (TypeScript), separate tsc, production build,
Playwright, real loopback Next HTTP tests, all six recorded symbol/side contracts,
the two-process/restart snapshot test and recorded contact coverage. Logs and exit
codes are in `verification/capitalive-v2-1/rc2/`. As before, npm-cli path discovery
in the runner targets Windows; individual commands work on other Node installs.
Dependencies/lockfile are unchanged; installation needs package downloads.

Targeted reproduction:

```sh
node --conditions=react-server --import tsx --test tests/htf-contact.test.ts
node --conditions=react-server --import tsx scripts/audit-contact-coverage.ts
npm run build
node scripts/verify-snapshot-processes.mjs
```

Full checks also run `node scripts/verify-rc-http.mjs` and
`node --conditions=react-server --import tsx scripts/audit-release-candidate.ts`.
By default those two earlier scripts write into `rc/`; the RC2 runner directs them
into `rc2/`. Historical `rc/` evidence describes the previous candidate.

## Contact scenario

The original `tests/fixtures/htf-NAS100.json` prices/OHLC are unchanged. Only quote
freshness metadata is simulated in the contact tests. For BID and ASK the expected
source dates are MN1 2026-06-01 low, W1 2026-06-08 low and D1 2026-06-09 low.
The D1 candidate is not in top-20 priority but must appear in contact hits.
This is a controlled regression, not evidence of a current real-time contact.

Tests also preserve 31 overlapping contacts with unique IDs, check deterministic
ordering, inclusive boundaries, explicit watch/unverified/gap filters and stale,
future, missing timestamp/invalid price suppression. Full and compact HTTP service
responses retain all three hits, metadata and the response budget.

`rc2/contact-before-fix.txt` records the two genuine failures (2 instead of 3) before
the fix. `rc2/contact-coverage.json` records the corrected BID/ASK hits and stale/
future counterexamples. `rc2/independent-audit-input.md` is the supplied external audit.

## Runtime availability experiment

`verify-snapshot-processes.mjs` launches actual production Next builds on loopback
ports 3103 and 3104, then restarts 3103. Test-only upstream responses come from the
same fixtures. Freshness is explicitly simulated so contact coverage is exercised
through real Next routes; production code has no freshness override. MN1 in this
transport is aggregated only from available recorded D1 data, with incomplete
history still disclosed. No genuine Capital.com live call is made.

Expected results: page on owning instance 200; same ID on another instance 410;
same ID after process restart 410; priority API 200 on both. A temporary loopback
proxy routes the downloader's manifest/first page to A and second page to B. The
client must discard partial pages, exit 3, print a priority URL and preserve the
existing output file. The test closes its own servers. Port 3101 is used by UI tests,
3102 by the separate full HTTP integration suite.

This verifies **lack of distributed persistence**, not availability on Vercel.
No Vercel preview/production deployment is performed. Snapshot manifests explicitly
declare best-effort process-local storage. Shared storage remains unimplemented;
the priority API is the ordinary UI entry point. Explicit full downloads may need
to restart from a new ID after 410; pages must never be mixed.

## Artifact integrity

`SOURCE_DIFF.patch` and `CHANGED_FILES.txt` compare with the previous audited RC.
The complete manifest inventories source, fixtures, tests and evidence. The ZIP
excludes env files, credentials, node_modules, databases, build caches and nested
ZIPs. Personal paths are sanitized in the review copy. Synthetic auth fixtures are
not usable secrets. See `SECURITY_REVIEW.json` and verify the ZIP's adjacent SHA-256.

In the original Git checkout, stage new source files and run
`node scripts/package-final-review.mjs --rc2` to prepare an allowlisted staging tree.
Compress that tree as `CAPITALIVE_2_1_RELEASE_CANDIDATE_2.zip`. Packaging requires
the checkpoint branch; it is not needed to run tests from an extracted ZIP.
