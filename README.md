# Capitalive V6 - PA Only Engine

Technical evidence for EURUSD, NAS100 and EU50, MN1/W1/D1/H4, Bid/Ask.
Capitalive detects closed-candle PA and lifecycle. ChatGPT interprets it; the user decides.
No automatic Narrative, A/B/C, entry/stop/target selection, R:R, scoring or trading.

Implementation and verified release status: [V6 audit](PA_ENGINE_V6_AUDIT_RU.md).
Primary-source definitions and unresolved rules: [Notion audit](PA_ENGINE_V6_SOURCES_RU.md).
Prior V5/V5.1 audits describe historical releases, not the active methodology.

## Market Context
Open `/api/desk-report?symbol=NAS100&side=bid&view=market-context` for the separate public context view. EURUSD and EU50 support the same arguments. Each PA report links to it under `details.market_context`. Context is calculated on demand, separately from PA. The response gives broker CFD quotes, observed client positioning, rolling H4/D1 volatility, and source and freshness metadata. Sentiment history accumulates on requests in hourly cache buckets.

## Public access and API

Public site: https://capitalive.vercel.app/research . No SSO, password or cookie is required.
Credentials and ingestion remain protected; the report repository remains private.

- /api/desk-report?symbol=NAS100&side=bid: pa-engine-v6, header pa-engine-v6.1; maximum 65,536 bytes.
- /api/intelligence: compatibility address returning the same PA_ONLY contract; forecast parameters disabled.
- /api/pa-evidence: filter by timeframe, kind, lifecycle and price; exact id returns candle proof and interactions.
- /api/pa-evidence?view=structure: fractal sequences, established/pending DR and history.
- /api/pa-evidence?view=interactions: paginated cross-timeframe links; id selects closed contact history.
- `grid=ny|utc` (all PA endpoints; default `ny`): H4/D1 по закрытию Нью-Йорка 17:00 America/New_York (DST), собираются из HOUR Capital.com; `grid=utc` — прежняя UTC-сетка провайдера. W1 — неделя от воскресного открытия до пятничного закрытия, MN1 — календарный месяц UTC на обеих сетках. Фактическая сетка по TF — `grid.by_tf` в каждом ответе.
- /api/pa-candles: closed OHLC, timeframe, from/to UTC, offset/limit or latest=N (last N closed candles). Subsequent pages require snapshot_sha256.
- /api/chart, /api/market-audit and /api/candles: retained technical routes; knowledge=1 uses V6.

`nearby_levels` in the desk-report lists, per timeframe (MN1/W1/D1/H4), up to 3 levels above,
3 below and 3 containing the last closed H4 close (`reference`). Candidates are FRACTAL, FVG, RB and
SNR evidence whose `lifecycle.state` is not INVALIDATED. A raided FRACTAL stays listed with
`state: CONSUMED` (its liquidity is taken; the zone remains, per the Notion "Fractal Raid" source as
relayed by the user); CONSUMED RB/FVG/SNR are excluded (`excluded_states`: INVALIDATED, FVG_FILLED,
CONSUMED_NON_FRACTAL). Fully filled FVG are excluded and
partially tested FVG show the remaining zone (`bounds_basis: FVG_REMAINING`). `distance` is in price
units (not pips); ordering is distance then id, never significance. `eligible` counts all matching
levels; `omitted.nearby_levels` counts those not shown, and `size_trimmed` those dropped for the byte
limit (farthest first). Under size pressure the evidence tail is trimmed before `nearby_levels`.
The block is `null` when the report is STALE or ERROR. Full detail: `/api/pa-evidence?id=...`.

One formation (same kind, timeframe, formation candles `origin`/`confirmed_at` and bounds) observed at
several known KL is emitted by the engine once per KL. `nearby_levels` shows it as one row
(`grouping: KIND_TIMEFRAME_FORMATION_CANDLES_BOUNDS`): `ids` lists every evidence id (sorted; `id` =
`ids[0]`), `contexts` the related KL (`id`, fact `relationships` such as `kl_id`/`rb_fvg_id`, and the
`evidence_ids` that reference it), plus `formation_status`. Rows that differ in lifecycle state or
formation status are never merged. Per-side limits and `eligible` count grouped rows. Reports built
before grouping (rows without `ids`) remain valid under the contract. On archived fixtures the larger
rows leave 2 fewer recent findings in the compact report (12 -> 10; all remain paginated).

### Access for AI agents

- /llms.txt (text) and /api (JSON): entry point with absolute URLs for every market and endpoint.
  Give an AI client the single link `https://capitalive.vercel.app/llms.txt`.
- /api/brief?symbol=NAS100[&side=ask] (`pa-brief-v1`): built from the same snapshot as the desk-report.
  Per timeframe: last 5 closed candles, dealing range, up to 5 nearest grouped levels per side (same
  rules and grouping as `nearby_levels`), last 6 confirmed fractals and finding counts by kind. Levels
  carry `urls` (one per id in `ids`), fractals and pages an absolute `url`/`links`, all pinned to
  `snapshot_sha256`. Levels/ranges/fractals are `null` when STALE or ERROR. `validatePaBrief`
  (lib/pa-engine/contract.ts) runs before every response: forbidden keys as in the desk-report, 65,536-byte
  cap, withheld observations, grouping and absolute links. Above the cap the farthest levels are dropped
  and counted in `omitted.levels_size_trimmed`. On archived fixtures it is 45-58 KB, with no trimming.
- pa-evidence and pa-candles pages include `links.self/first/next` (absolute, pinned).
- Errors include `diagnostic.message` (what to fix) and `diagnostic.docs`.
- `side` is case-insensitive; `from`/`to`/`as_of` also accept `2026-11-01` and `...T10:00Z` (UTC only).
- /robots.txt allows all agents.

All compact omissions are explicit. A displayed subset is not a complete market survey.
A 409 snapshot change requires restarting pagination. Available history is finite.
Fractals use only three closed candles. No stitching across unexplained gaps.
Consumed liquidity and filled FVG are not fresh levels; ACTIVE does not prove a support role.

Session-aware candles (lib/session-candles.ts): Capital.com's separate Sunday-evening DAY bar is merged
into the following Monday (Sunday open, combined high/low, Monday close); a Sunday bar without its
Monday yet is not closed. W1 is built from these DAY bars, Sunday 00:00 UTC to Sunday 00:00 UTC, so the
weekly close is Friday's close and the bar is marked closed at Sunday 00:00 UTC; this costs one extra
DAY request window per W1 fetch. MN1 aggregates the merged days. On D1 only a regular weekend closure
(Fri/Sat end to Sun/Mon start, at most 50 h) is continuous; any other missing day still splits the
segment. H4 is unchanged (weekends still split H4 segments).
Compression/LRL and unformalized significance remain NEEDS_SPECIFICATION.
OHLC arithmetic is checked, but independent second-provider accuracy and historical sessions
are not established. PARTIAL limitations remain visible; STALE/ERROR suppress current observations.

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
URL (also NAS100 and EU50). No login, cookie or token is required. The endpoint
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
services; no account data or personal data is published. Full closed OHLC is available through the paginated public API; compact GitHub reports contain only selected formation evidence.
Production has been explicitly activated; public access remains enabled.

## Validation and migration

Run `npm ci`, `npm test`, `npm run lint`, `npm run build`,
`npm run knowledge:replay`, `npm run knowledge:replay:v2`,
`npm run knowledge:replay:v4`, `npm run test:ui`.

The V2 compact publisher rejects old payloads. Coordinate its approved upgrade
with `BRIDGE_BASE_URL` pointing at the verified immutable V6 deployment. Never relabel
V1 archives. All four latest files publish in one non-forced commit; readback is
pinned to that commit.

Old design/tests under `docs/archive` and `tests/historical-v4` are historical
records, not active methodology. Actual results and release scope:
[PA_ENGINE_V6_AUDIT_RU.md](PA_ENGINE_V6_AUDIT_RU.md).
