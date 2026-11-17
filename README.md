# Capitalive V5 — THE EDGE Research

Technical research for **EURUSD / NAS100 / JP225**, with explicit Capital.com
Demo/Live environment and timestamps. No order execution. Macro-EDGE, final
decisions and aggregate risk remain with the user and ChatGPT.

V5.1 with sequential DR and first-close RB is active on the public Production
site. Private Bridge main uses the same immutable Production deployment.
See [current activation audit](RB_PRODUCTION_ACTIVATION_RU.md) for runtime,
publication/readback, timestamps and remaining access limitations. Earlier V5
activation audits describe historical deployments.

## Public access — updated 17 November 2026

The user explicitly requested public website/API access for ChatGPT. Project-level
Vercel Authentication is now disabled (`ssoProtection: null`). This supersedes
earlier instructions in historical audits to retain SSO; do not re-enable login
for research routes without a new user instruction. GitHub report storage remains
private, and server credentials and authenticated ingestion remain protected.

Stable public site: https://capitalive.vercel.app/research . Direct research JSON:
`https://capitalive.vercel.app/api/desk-report?symbol=EURUSD&side=bid`
(also NAS100 and JP225). Unauthenticated HTTP checks returned 200 HTML/JSON/PNG,
without a login redirect. The stable domain returned no `X-Robots-Tag: noindex`;
`robots.txt` returned 404, not a robots exclusion policy.

Production now includes DR and RB from `2e7a442`; the user explicitly authorized
activation on 17 November 2026. Use the stable public URL above for current
research. Historical Preview links are release evidence, not the current source.
The built-in web retrieval tool returned an internal accessibility error despite
successful unauthenticated HTTP checks; actual search-tool retrieval/indexing is
not claimed verified. User-Agent-only probes are not proof of OpenAI network access.
Existing provider rate limits still apply. See
[HTTP evidence](verification/public-access/http.json).

## Current contracts

**V5.1 is activated in Production and the working Bridge.**
See [V5.1 audit](CAPITALIVE_V5_1_AUDIT_RU.md) and
[compatibility notes](BRIDGE_V5_1_COMPATIBILITY.md): context/lifecycle review,
lossless full inspection, `desk-report-v2.3` header and `context-5.1`.
The [DR sequence update](DR_SEQUENCE_AUDIT_RU.md) implements chronological
Fractal 3 ranges, retained parent ranges, KL-linked local origins and MN1→H4 fallback.
The [RB v2 update](RB_V2_AUDIT_RU.md) uses the first candle close, permits weaker
FVG-only interactions and keeps liquidity-raid evidence and quality distinct.
The source and companion publisher now both use the following contracts.

- `/api/intelligence`: `edge-knowledge-5`; author Fractal 3, FVG, contextual
  RB/SNR, Raid/IDM, explicit DR, candidate Narrative and evidence IDs.
- `/api/desk-report?symbol=EURUSD&side=bid`: `desk-report-v2`, header
  `X-Desk-Contract: desk-report-v2.3`, maximum 65,536 UTF-8 bytes including newline.
- `POST /api/desk-report?symbol=EURUSD&side=bid&refresh=1`: new provider request,
  separate quote and closed-candle analysis. Browser refresh is same-origin;
  automation uses the existing Vercel protection header, never a URL secret.
- `/research`: public on-demand reports with timestamps and JSON download.
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

For current research, fetch the public `/api/desk-report?symbol=EURUSD&side=bid`
URL (also NAS100 and JP225). No login, cookie or token is required. The endpoint
re-evaluates freshness on every request; HTTP responses are `private, no-store`.
Provider quote cache is 5 seconds and candle cache is 30 seconds. Check
`quote.provider_timestamp`, `freshness.quote_status`, `expires_at`, last closed
H4 and error/STALE fields. A fresh retrieval time does not make old provider data
fresh. Rate limits may return 429 with Retry-After; respect that delay.

For stored publication, connect the private `Yilin1207/capitalive-research-bridge`
repository. Read
`reports/latest/manifest.json` and all three reports at the **same commit**.
Check byte sizes/SHA-256, expiry and provider times against the current clock.
Stored `fresh:true` means fresh at generation, not at reading. Expiry requires
refresh; it must never become a current-market claim.

The [ChatGPT GitHub app is read-only](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt-deep-resear).
Public web research does not require that connector or access to GitHub Actions.

1. Open public `/research`, refresh and attach downloaded compact JSON if web
   retrieval is unavailable in the current ChatGPT session.
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
Production has been explicitly activated; public access remains enabled.

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
