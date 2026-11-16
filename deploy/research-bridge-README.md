# Capitalive V5 Research Bridge — PRIVATE

This repository stores compact technical evidence for EURUSD, NAS100 and JP225.
It is not an order executor. The engine lives in
[Yilin1207/capitalive](https://github.com/Yilin1207/capitalive).

## Release scope

V5 is prepared in PR #5. Main remains on the previous publisher until coordinated
merge. Verified V5 reports are on `verification/v5-current`, with a separate
operator recovery run on `verification/v5-recovery`.

Verified source: `https://capitalive-l2umiufiw-yilin1207s-projects.vercel.app`,
engine commit `cd4c746bda181aca0429faee16fdba4649b0e412`.
[Audit, tests, HTTP and publication evidence](https://github.com/Yilin1207/capitalive/blob/feature/v5-realtime-edge-only-20261116/CAPITALIVE_V5_AUDIT_RU.md).

## Reading in ChatGPT

Connect this private repository. Read `reports/latest/manifest.json` and
`EURUSD.json`, `NAS100.json`, `JP225.json` at the **same commit**. Check byte counts,
SHA-256, contract, environment, side, quote time, H4 close and expiry against the
current clock. A saved `fresh:true` describes generation time, not reading time.

The GitHub connector is read-only; it cannot refresh the source or dispatch an
Action automatically. Indexed content can lag. To request current research:

1. Open the protected source `/research`, refresh and attach downloaded JSON to ChatGPT; or
2. Run **Actions → Research Bridge → Run workflow**, wait for successful readback
   and use that immutable report commit. Before merge, select the V5 branch and
   provide the verified immutable Preview in `preview_url`; this publishes only
   to `verification/v5-current`. On main after merge the source is `BRIDGE_BASE_URL`.

Expired/unknown data must remain STALE/PARTIAL/ERROR. Never treat old files as a
fallback success. Candidate Narrative is not Confirmed; qualitative author
judgment, Macro-EDGE, final decisions and aggregate risk remain with the user.

## Publishing and recovery

Node 24 only; no npm install is required:

```sh
node --test tests/research-bridge-publisher.test.ts
```

Workflow credentials are the existing scoped GitHub token and Vercel protection
secret. Keep SSO and repository privacy. Never place keys in URLs, files or logs.
The hourly minute-7 schedule is best effort, not a two-minute quote SLA.

Operator recovery without GitHub Actions is implemented by
`scripts/refresh-research.ts`, using existing Git Credential Manager and Vercel
CLI login on the operator computer. Set `VERCEL_CLI_JS` and the nonsecret selector
`BRIDGE_BYPASS_CREATED_AT`; supply the existing project link via `--project`.
No new token or bypass is created. `--source` selects the verified Preview;
`--branch verification/v5-recovery` isolates a release check. Default destination
is main, so use it only after coordinated V5 activation. `--dispatch` merely
requests the main workflow, it does not prove publication succeeded.

## Coordinated activation

Merge the approved source chain and this PR; set `BRIDGE_BASE_URL` to the verified
immutable V5 Preview, then dispatch main and read all four published files again.
The previous main workflow hardcodes an old source and ignores that variable.
The strict V2 publisher rejects V1 payloads, so this is a coordinated migration.
No Production deployment or secret rotation is necessary.

Reports are capped at 65,536 bytes including newline. Manifest and all reports
use one non-forced Git commit and commit-pinned readback. Errors are sanitized.
No raw OHLC history, accounts, personal data, API keys or automatic trading.
