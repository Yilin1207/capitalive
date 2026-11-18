# Capitalive V5 Research Bridge — PRIVATE

This repository stores compact technical evidence for EURUSD, NAS100 and JP225.
It is not an order executor. The engine lives in
[Yilin1207/capitalive](https://github.com/Yilin1207/capitalive).

## Active release

V5 is integrated into main through PR #5. The working publisher uses
`desk-report-v2` / `edge-knowledge-5` and publishes to `reports/latest` on main.
Previous verification branches and archived reports remain historical evidence.

Verified source: `https://capitalive-iyzyi4yo2-yilin1207s-projects.vercel.app`,
engine commit `a78e5d89ef2c6666ec7cbdb9332918ddd320cbe1`.
[Implementation audit](https://github.com/Yilin1207/capitalive/blob/feature/the-edge-knowledge/CAPITALIVE_V5_AUDIT_RU.md).
Final activation evidence: `CAPITALIVE_V5_FINAL_ACTIVATION_RU.md` in the engine repository.

## Reading in ChatGPT

Connect this private repository. Read `reports/latest/manifest.json` and
`EURUSD.json`, `NAS100.json`, `JP225.json` at the **same commit**. Check byte counts,
SHA-256, contract, environment, side, quote time, H4 close and expiry against the
current clock. A saved `fresh:true` describes generation time, not reading time.

The GitHub connector is read-only; it cannot refresh the source or dispatch an
Action automatically. Indexed content can lag. To request current research:

1. Open the protected source `/research`, refresh and attach downloaded JSON to ChatGPT; or
2. Run **Actions → Research Bridge → Run workflow**, wait for successful readback
   and use that immutable report commit. Select **main**; leave `preview_url`
   empty. The source is the repository variable `BRIDGE_BASE_URL`. Branch-only
   verification still publishes to `verification/v5-current` when explicitly selected.

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

## Active configuration

`BRIDGE_BASE_URL` points to the verified immutable V5 Preview above. The active
workflow reads this variable; the old hardcoded source was removed. The strict
V2 publisher rejects V1 payloads. Always read all four files at the commit named
by the workflow's `bridge_readback` event, not a mix of changing main refs.
No Production deployment, SSO weakening or secret rotation was required.

Reports are capped at 65,536 bytes including newline. Manifest and all reports
use one non-forced Git commit and commit-pinned readback. Errors are sanitized.
No raw OHLC history, accounts, personal data, API keys or automatic trading.
