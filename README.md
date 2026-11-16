# Capitalive V5 — THE EDGE Research

Technical research for **EURUSD / NAS100 / JP225**, with explicit Capital.com
Demo/Live environment and timestamps. No order execution. Macro-EDGE, final
decisions and aggregate risk remain with the user and ChatGPT.

V5 is active in the private Bridge main, using the protected immutable Preview.
See [final activation audit](CAPITALIVE_V5_FINAL_ACTIVATION_RU.md) for merged
commits, real publication/readback, quote timestamps and freshness limits.

## Current contracts

This branch also contains **V5.1 Preview**, not activated in the working Bridge.
See [V5.1 audit](CAPITALIVE_V5_1_AUDIT_RU.md) and
[compatibility notes](BRIDGE_V5_1_COMPATIBILITY.md): context/lifecycle review,
lossless full inspection, `desk-report-v2.1` header and `context-5.1`.
The V5 contracts below describe the active Bridge source; do not point its old
publisher at V5.1 without a coordinated, separately authorized upgrade.

- `/api/intelligence`: `edge-knowledge-5`; author Fractal 3, FVG, contextual
  RB/SNR, Raid/IDM, explicit DR, candidate Narrative and evidence IDs.
- `/api/desk-report?symbol=EURUSD&side=bid`: `desk-report-v2`, header
  `X-Desk-Contract: desk-report-v2.0`, maximum 65,536 UTF-8 bytes including newline.
- `POST /api/desk-report?symbol=EURUSD&side=bid&refresh=1`: new provider request,
  separate quote and closed-candle analysis. Browser refresh is same-origin;
  automation uses the existing Vercel protection header, never a URL secret.
- `/research`: protected on-demand reports with timestamps and JSON download.
- `/api/chart`, `/api/market-audit`, `/api/candles`: retained. Old ATR-SNR,
  generic structure/OB/breaker/priority fields are explicitly disabled. Author
  analysis is `/api/intelligence` or `knowledge=1` in market-audit.

Current fractals use three closed consecutive candles, confirming at the third
close. Equal extrema do not establish a strict pivot. Session boundaries remain
separated; no invented candles or pattern stitching.

## Methodology

Current user instruction > THE EDGE article > rules map > implementation.
See [rules map](https://app.notion.com/p/419e05dadd188118ba32fc9f0f146cc4) and
[author's system](https://app.notion.com/p/02de05dadd188371823c01c1f58aacc1).
FVG geometry, session gaps, fill and invalidation are separate. SNR requires its
own two-candle origin, KL delivery and closed breakout; FVG does not manufacture
SNR. Rejection alone is not a two-candle RB.

Qualitative significance, SOF, Compression/LRL and Strong High/Low boundaries
remain review/specification questions. Generic BOS/CHOCH, ATR-cluster SNR, Order
Blocks, Breakers and automatic fractal role flips do not supply evidence.
Range candidates do not prove significance. Candidate Narrative never becomes
Confirmed without attributable human review.

## Freshness

`provider_timestamp` is quote time; `quote.retrieved_at` and
`freshness.quote_retrieved_at` are retrieval times. `generated_at`, analysis
`as_of`, per-frame `last_closed_at`, `published_at` and `expires_at` are separate.
`published_at` is atomic commit preparation time, not a market timestamp;
readback records the actual commit and read time.

Defaults: quote <=120 seconds while open, missing new H4 <=600 seconds after
expected close, delivery <=120 seconds. Configure downward through
`BRIDGE_QUOTE_MAX_SECONDS` (60–120), `BRIDGE_H4_MAX_DELAY_SECONDS` (60–600),
`BRIDGE_DELIVERY_MAX_SECONDS` (30–120). These are measured technical targets,
not guarantees. Missing or old data stays STALE/PARTIAL/ERROR.

Closed PA is cached by closed OHLC, validation, side, environment, selection and
source revisions. Original analysis `as_of` stays unchanged. New/revised closed
candles invalidate the cache. Quotes are never closed-candle evidence. No old
success is substituted for a provider failure.

Private workflow template: [deploy/research-bridge.yml](deploy/research-bridge.yml).
Hourly minute-7 recovery is best effort. GitHub may delay/drop scheduled jobs;
two-minute freshness requires on-demand. Vercel Hobby cron is daily, so it does
not solve intraday freshness.

## ChatGPT and recovery

Connect the private `Yilin1207/capitalive-research-bridge` repository. Read
`reports/latest/manifest.json` and all three reports at the **same commit**.
Check byte sizes/SHA-256, expiry and provider times against the current clock.
Stored `fresh:true` means fresh at generation, not at reading. Expiry requires
refresh; it must never become a current-market claim.

The [ChatGPT GitHub app is read-only](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt-deep-resear).
It cannot invoke workflow_dispatch or the protected Preview automatically.

1. Open protected `/research`, refresh and attach downloaded compact JSON.
2. Run the private workflow manually, wait for publication/readback, then ask
   ChatGPT to read that commit. This still requires Actions availability.
3. Operator recovery without Actions: Node 24 plus existing Git Credential
   Manager and Vercel CLI login; run `node scripts/refresh-research.ts`.
   Set `VERCEL_CLI_JS` to the installed CLI JS path and
   `BRIDGE_BYPASS_CREATED_AT` to the existing dedicated bypass creation timestamp.
   Use linked `.vercel/project.json` or `--project <path>`. No token is passed in
   arguments or printed. `--dispatch` only requests the workflow.
   `--source <immutable-preview> --branch verification/v5-<name>` verifies a release.

No new secret or paid service is required. Existing credentials stay in their
services; no account data, raw OHLC or personal data enters compact/public files.
Production and SSO are unchanged.

## Validation and migration

Run `npm ci`, `npm test`, `npm run lint`, `npm run build`,
`npm run knowledge:replay`, `npm run knowledge:replay:v2`,
`npm run knowledge:replay:v4`, `npm run test:ui`.

The V2 compact publisher rejects old payloads. Coordinate its approved upgrade
with `BRIDGE_BASE_URL` pointing at a verified immutable V5 Preview. Never relabel
V1 archives. All four latest files publish in one non-forced commit; readback is
pinned to that commit.

Old design/tests under `docs/archive` and `tests/historical-v4` are historical
records, not active methodology. Actual results and release scope:
[CAPITALIVE_V5_AUDIT_RU.md](CAPITALIVE_V5_AUDIT_RU.md).
