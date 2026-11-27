# Capitalive Research Bridge V1

Private research delivery repository. Read `reports/latest/manifest.json`, then only
the requested asset in `reports/latest/EURUSD.json`, `NAS100.json`, or `EU50.json`.
Reports use `desk-report-v1`; each is at most 65,536 UTF-8 bytes including its final newline.
The publisher checks repository privacy and writes all three assets plus the manifest
in a single commit. No Capital.com credentials, account records, personal review text,
full candle histories, trading instructions or automatic orders are published here.

## How to read a report

1. Check `generated_at`, `as_of`, `expires_at`, `status`, quote timestamps and market
   status against the current UTC time. An expired report is STALE even if its stored
   status has not changed. `generated_at` is not the quote's provider timestamp.
2. `STALE` preserves historical observations but must not be described as current
   executable market data. Unknown provider time stays null. A weekend does not
   grant freshness. `ERROR` replaces an unavailable asset; no last-good data is
   silently substituted. If GitHub itself is unavailable, use manifest expiry to
   detect that the last committed batch is old.
3. Read `frames` (MN1, W1, D1, H4), then `scenario`. Candidate Narrative is a candidate;
   neither ChatGPT nor this projection may promote it to Confirmed. No probabilities
   or profitability claims are supplied. `trading_enabled` is always false.
4. References such as `e0` resolve in `evidence`. Each record keeps its original
   engine ID, origin and `confirmed_at`. `rule` resolves in `rules`, with source
   revisions and documented versus project-hypothesis provenance. `candle_refs`
   and lifecycle interaction `candle` are indices into `candle_windows`, whose rows
   are `[open_time_utc, close_time_utc]`. These are timestamps, not OHLC arrays.
   SHA-256 binds the original selected candle proof; it is not an independent
   certification of the trading interpretation.
5. The display policy is fixed: latest 3/5-bar high/low per timeframe, latest
   structure event, SNR, RB, FVG and raid, plus selected/alternative HTF A, up to three
   engine B candidates, C and referenced dependencies. Display recency does not
   select a trading target. Counts expose omitted findings. iFVG/IDM/Strong counts
   are included but their extra examples are not expanded by default.
6. A/B paths show up to four obstacles per candidate. `PARTIAL` or `UNASSESSED`
   paths never establish a clear route to the target. An unselected DR remains
   null with `EXPLICIT_SELECTION_REQUIRED`. Do not invent ranges or invalidations.
   Range selection is available through the protected API's explicit pivot IDs.

## ChatGPT connection

In ChatGPT, open **Settings → Plugins → GitHub**, authorize the GitHub app and select
only this private repository. Availability depends on plan/workspace/surface; GitHub
may be available in deep research or an agent surface rather than ordinary chat.
Ask ChatGPT to retrieve the files live from this repository; attaching an old download
does not create automatic refresh. No GitHub token or Vercel secret belongs in a prompt.

Suggested prompt:

> Open Yilin1207/capitalive-research-bridge, read reports/latest/manifest.json and
> reports/latest/EURUSD.json from the current default branch. State the file commit,
> generated_at, as_of, status and quote provider timestamp before analysis. Check
> expiry against current UTC. Explain MN1 → W1 → D1 → H4, candidate A/B/C, obstacles
> and invalidations. Resolve cited e-references to original IDs and confirmation
> times. Distinguish missing/omitted evidence, hypotheses and confirmed observations.
> Do not promote Candidate Narrative, assume freshness or issue automated orders.

Official connection guide:
https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt
GitHub content is retrieved on demand; this is not a guaranteed synced ChatGPT index.

## Operation

`Research Bridge` runs at 00:17, 04:17, 08:17, 12:17, 16:17 and 20:17 UTC, after nominal
UTC H4 closes. GitHub schedules are best effort and can be delayed/dropped; check
timestamps. Manual refresh: Actions → Research Bridge → Run workflow → main.
The schedule is on this repository's default branch, independent of Capitalive's
production deployment. Bot report commits do not recursively trigger the workflow.

`BRIDGE_BASE_URL` is a repository Actions variable containing an approved immutable
Capitalive Preview URL. `VERCEL_AUTOMATION_BYPASS_SECRET` is an encrypted Actions
secret. Capital.com secrets stay in Vercel. Vercel SSO stays enabled for unauthenticated
visitors. Its automation bypass is project-scoped, not endpoint-scoped: restrict
repository write/Actions permissions and revoke/rotate that secret if compromised.
Fork/PR tests never receive the bypass secret. GitHub writes use the job's ephemeral
`GITHUB_TOKEN` with contents permission only, not a stored personal token.

To stop updates, disable this workflow; to revoke Vercel access, delete its dedicated
automation bypass and remove the Actions secret. No paid plan or billing change is
required by this setup; exhaustion of existing Actions quotas stops automation.

Implementation is reviewed in Yilin1207/capitalive, branch feature/the-edge-knowledge,
PR #2. THE EDGE detector and trading logic are unchanged by the bridge.
