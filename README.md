# Capital.com Market Feed

## Capitalive 2.0: technical analysis

**Production release verified 2026-11-10:**
[`/api/market-audit?symbol=EURUSD`](https://capitalive.vercel.app/api/market-audit?symbol=EURUSD)
returns HTTP 200 JSON and
[`/api/chart?symbol=EURUSD&timeframe=H4`](https://capitalive.vercel.app/api/chart?symbol=EURUSD&timeframe=H4)
returns HTTP 200 PNG (1400×1000), checked anonymously after deployment.
Deployment: `dpl_8J4UM2UtAGDzfoMF3NcVnD7V3g98`.
See [release evidence and explicit H4 range example](CAPITALIVE_2_RELEASE_RU.md).

Implemented in the existing Next.js application. New analysis is limited to **EURUSD,
NAS100 and EU50**; older quote/history/archive endpoints retain their instruments and
contracts. See [Russian implementation and verification report](CAPITALIVE_2_AUDIT_RU.md).

```text
GET /api/market-audit?symbol=EURUSD
GET /api/market-audit?symbol=NAS100&side=ask&timeframe=H4
GET /api/market-audit?symbol=EU50&include_candles=1
GET /api/chart?symbol=EURUSD&timeframe=H4
GET /api/chart?symbol=EURUSD&timeframe=D1&side=bid&fractals=1&fvg=1&ranges=1&eq=1&bars=120
```

Audit loads MN1/W1/D1/H4 (60/120/200/240 requested bars), returns quote freshness,
confirmed/provisional/swept fractals, fractal-bounded ranges, EQ/Premium/Discount,
all detected FVGs with residual bounds and materiality, nearest D1+ observed targets,
intermediate H4 obstacles, consistency checks, diagnostics and four PNG URLs.
It emits no trade signal, EDGE or success probability. Missing/unverified quote time
is explicitly degraded; HTTP retrieval time is never substituted for tick time.
Missing history fails the whole audit instead of returning a complete-looking subset.

Raw candles are linked through `structure[timeframe].candles_url`; add
`include_candles=1` to embed them. `timeframe=H4` (or MN1/W1/D1) narrows the response's
structure, but targets still use all four frames. This helps clients with response-size
limits without removing small or filled FVGs from analysis data.

Rules and defaults are explicit and deterministic:

- Strict five-bar fractals; all five bars closed, two closed bars to the right.
  Equal extrema reject the pivot. A later equal extreme is `touched`; a strict move
  beyond the level is `swept`, including a forming bar. No close back is required for
  this sweep definition. Touch/sweep timestamps and `status` are separate fields.
- Known rejected observations cannot be bridged into a pattern. Partial-validation
  monthly candles and missing calendar months cannot confirm a pattern. Unknown
  session completeness remains a warning, not a claim of complete history.
- The selected range uses the latest valid opposite confirmed pivot pair in time
  order. Up to 12 alternatives and provisional ranges include provenance and reasons.
  A swept boundary does not erase a historical range; check `boundaries_swept`.
  No BOS/CHOCH gate or reaction-strength score is applied.
  For a specific H4 range, pass both `range_high` and `range_low` with confirmed IDs
  from `structure.H4.fractals`. Example: build a URL using `URLSearchParams` so IDs
  are encoded correctly. Both audit and PNG routes accept this selection; audit's
  H4 chart URL preserves it. The UI also has High/Low selectors. Invalid, missing,
  wrong-side or provisional IDs return HTTP 400, without an automatic replacement.
- Three closed candle wick gaps are confirmed FVGs; an open third bar is provisional.
  Fill is maximum subsequent wick penetration, including the forming candle. This is
  a price-interval measure, **not traded volume**. Filled gaps remain in JSON.
- Materiality uses the residual, not the original size. Threshold is
  `max(min_remaining_units, ATR14 * atr_fraction / unit_size)`. Defaults: EURUSD 0.5 pip,
  NAS100/EU50 1 index point; ATR fraction 0.02. ATR is the simple mean of up to 14 closed
  true ranges, with sample count disclosed. Both endpoints accept
  `min_remaining_units=0..10000` and `atr_fraction=0..1`. They are heuristics, not
  statistical confidence. EURUSD 1 pip = 0.0001; an index point = 1 price unit.
- BID and ASK are analyzed separately (`side=bid` default). No synthetic midpoint
  OHLC. Quotes and histories are separate observations; inspect their timestamps.

PNG is rendered deterministically from Capital.com OHLC with SVG + resvg, without a
browser process or AI image generation. The browser uses the same SVG renderer and
analysis module. OFL-licensed Noto Sans is bundled; the server renderer disables system
fonts, so Vercel does not turn labels into missing-glyph boxes. Dates are UTC; bars have equal visual spacing. API images show up to
`bars=20..240` (default 120); calculations use the full loaded history. To keep charts
readable, at most eight active visible FVGs are drawn, each with residual/fill details;
all gaps remain in audit JSON. Layers `fractals`, `fvg`, `ranges`, `eq` accept `0` or `1`.

Both routes are public, read-only, CORS-enabled and `no-store`, like existing history
routes. They reuse its 30-second cache, coalescing, upstream pacing and rate limits.
PNG caching is bounded to 24 entries / 30 seconds, with at most two active renders
per process. The selected instrument's quote cache lasts five seconds and age is
re-evaluated on every use. No secret is put in a URL, image, or client bundle.
Vercel limits/cache remain per instance; a deployment-wide quota needs platform controls.
If Vercel Deployment Protection restricts a deployment, an external image client still
needs access through the owner's configured public deployment; this code does not bypass it.
PNG URLs are independently fetched snapshots, not immutable copies of an audit response.

Verification:

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:ui
# Read-only actual public data retrieval; no deployment:
npm run test:analysis-public -- https://capitalive.vercel.app
# Offline replay of the recorded public verification artifacts:
npm run test:analysis-public -- --recorded
```

Unit fixtures are actual saved DEMO monthly data plus synthetic edge cases. Browser
tests replay those saved responses and never claim a live connection. Production now
uses the existing Vercel project's private provider variables and was independently
verified through anonymous HTTP requests. Local real provider requests still need
private `CAPITAL_*` variables; this workspace's `.env.local` has none. No production
secrets were exported to solve that local limitation. Initial implementation evidence
is in `verification/capitalive-v2/`; current release proof is in
`verification/capitalive-v2-release/`.

Read-only Next.js API for current Capital.com CFD quotes. The project contains no trading,
account-changing, or preference-changing endpoints.

## Endpoints

- `GET /api/quotes` — live WebSocket quotes with REST fallback. Optional cache-busting
  parameters such as `?cb=1727000000000` are ignored safely.
- `GET /api/markets` — verified public-symbol to Capital.com EPIC mappings.

Tracked symbols: `NAS100`, `JP225`, `USDJPY`, `EURUSD`, `XAUUSD`, `GER40`,
`EU50`, `US500`, `XAGUSD`, `UK100`, `US10Y`, `BRENT`, and `GBPUSD`.

`/api/quotes` keeps those 13 instruments in `markets`/`quotes` and adds optional
macro context in `context_markets`: `VIX` -> Volatility Index (`VIX`).

The existing `US10Y` value is a bond CFD price, not a sovereign yield. Its metadata
therefore uses `representation: "bond_price"` and `inverse_to_yield: true`. The API deliberately
does not calculate yield spreads from differences between bond prices. Requested
`US2Y`, `DE2Y`, `DE10Y`, `UK2Y`, `UK10Y`, `JP2Y`, and `JP10Y` instruments remain
explicitly listed as unavailable. German Schatz, German Bund, and UK Long Gilt
December-2026 contracts were visible in Capital.com's public catalogue but did not
return quotes through the configured authenticated Demo API, so they are not exposed
as live context data.

The response also includes `metadata`, `relationships`, and `derived`.
- `GET /api/health` — active Capital.com REST/WebSocket self-check without credentials.

Quote responses retain the original `server_time` and `markets` fields and also expose
`ok`, `serverTime`, `fetchedAt`, and `quotes` aliases. Upstream calls use bounded timeout,
transient retries, and a single automatic session refresh for expired credentials.

When Capital.com is unavailable, `/api/quotes` may include a best-effort `lastGood`
snapshot. Every saved quote is explicitly marked `stale: true` and `fresh: false`.
It is also marked `actionable_live: false` and `live_retrieval: false`.
This cache is process-local only: Vercel may recycle an instance or route a request to a
different instance, so `lastGood` is not guaranteed to persist.

`actionable_live` is true only when `market_status` is `TRADEABLE` and the quote is
provider-fresh. A successful REST retrieval without a provider timestamp remains
`fresh: false`; `retrieved_at` and `live_retrieval: true` show that it was fetched in
the current request without incorrectly calling it a fresh market tick.

`quote_quality` makes that distinction explicit: `provider_timestamp_verified`,
`provider_timestamp_outside_freshness_window`, `live_rest_unverified_timestamp`,
`stale_last_good`, or `unavailable`.

Health does not report process uptime or rely on process-local quote state, because
Vercel may execute `/api/health` and `/api/quotes` in different serverless instances.
Instead it actively probes a known Capital.com market and reports `serviceStatus`
separately from `capitalStatus`. A reachable endpoint with an unavailable upstream is
therefore service `ready` and Capital `degraded`.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the four `CAPITAL_*` variables. `CAPITAL_API_PASSWORD` is the custom password
   created with the Capital.com API key.
3. Run `npm install`, `npm test`, and `npm run dev`.
4. Open `http://localhost:3000/api/quotes`.

## Vercel

Add `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER`, `CAPITAL_API_PASSWORD`, and
`CAPITAL_API_BASE_URL` in **Project Settings → Environment Variables**, then deploy.

## Historical candles and chart

The home page contains a Lightweight Charts candlestick chart for the same 13 public
symbols as `/api/quotes`. Select MN1, W1, D1 or H4, and BID or ASK. Zoom with the mouse wheel,
drag to pan, and move the crosshair to inspect OHLC and the UTC bar start. The chart
refreshes every minute. Amber bars are still forming as of their retrieval time.

Public, unauthenticated, CORS-enabled, market-data-only GET endpoints:

```text
/api/candles?symbol=NAS100&timeframe=H4&limit=200
/api/structure?symbol=NAS100&w1=20&d1=30&h4=40
```

`symbol` defaults to NAS100. `/api/candles` defaults to H4. Limits are positive integers,
at most 1000 per timeframe. Defaults: W1 = 120, D1 = 200, H4 = 240. `/api/structure`
accepts `w1`, `d1`, `h4` independently and returns top-level `W1`, `D1`, `H4` arrays.
The symbol-to-epic mapping is **VERIFIED_MARKETS**, exactly as used by `/api/quotes`;
no separate discovery or alternative instrument substitution is used.

Both endpoints return `ok`, `symbol`, `epic`, `provider: "Capital.com"`,
`environment: "demo" | "live"`, `price_side: "bid_ask"`, and `fetched_at`.
`/api/candles` additionally returns `timeframe`, `candles`, and `metadata`.
Each candle has:

| Field | Meaning |
| --- | --- |
| `time` | Provider `snapshotTimeUTC`, normalized to UTC ISO 8601; the bar start, never retrieval time |
| `open`, `high`, `low`, `close` | Each is `{ "bid": number or null, "ask": number or null }`; no mid-price calculation |
| `is_closed` | Inferred as of `fetched_at` from a successor bar or elapsed nominal interval; not a provider confirmation flag |

A side is usable only when all four prices are finite and low ≤ open/close ≤ high.
If only one side passes validation, the other side is entirely null. Crossed bid/ask,
invalid or future timestamps, and bars with neither side usable are discarded.
Bars are sorted oldest first; the last valid duplicate at a timestamp wins.
Missing history, session gaps and invalid rows are never filled with generated prices.

Metadata includes requested/returned counts, `insufficient_history`, discarded row/side
counts, `discarded_reasons` (invalid/future timestamps, invalid sides, crossed sides),
duplicate counts, time/closure semantics, cache TTL and cache-hit status.
For structure, each timeframe has its own metadata and `fetched_at`; the top-level
`fetched_at` is the newest of those fetch times, not a claim of simultaneous snapshots.
Cached forming bars are not reclassified as final merely because the wall clock advances.
Weekly/daily closure uses nominal periods; market session boundaries and holidays may
make that estimate conservative. Use the documented closure basis when analyzing bars.

## History load control and failures

History reuses the existing server-only Capital.com session, GET pacing, bounded retries,
and one session refresh on authentication failure. Official resolutions are `WEEK`,
`DAY`, `HOUR_4`; the provider query uses `max` (up to 1000).
See [Capital.com REST documentation](https://open-api.capital.com/).

History has a 30-second, bounded in-memory cache scoped to configuration, environment,
symbol, timeframe and fetch-size bucket. Concurrent identical requests share a fetch.
Requests up to the default size reuse that default history; larger requests use bounded
250-bar buckets up to 1000, then return only the requested most recent bars.
Provider fetches include up to 10 extra real bars as a validation reserve (still at
most 1000 total); discarded rows can thus be replaced with older valid provider bars.
Errors and stale data are not cached as successes. HTTP responses use `no-store` so
clients always receive explicit retrieval metadata and never an implicit stale CDN copy.

Per running instance: 60 public requests/minute per client, 240 total/minute, 24 new
history loads/minute, and at most 3 simultaneous history loads. Both routes share these
limits when executing in the same process. Vercel's forwarded client address is hashed;
outside Vercel, callers share a local bucket. History 429 responses include `Retry-After`.
Upstream 429 starts a cooldown of at least 60 seconds, extended by the provider's
`Retry-After`. Long provider delays return immediately instead of occupying a function.

**Vercel scaling limitation:** memory cache, coalescing and application limits are
per instance, not a distributed quota. Instances may restart or scale independently.
For a hard deployment-wide quota, configure Vercel Firewall rate limiting for
`/api/candles` and `/api/structure`, or add a shared rate-limit store. The existing quotes
flow and its limits are unchanged; history's local budget reduces additional load but
cannot guarantee a provider-wide quota across multiple instances.

Errors use `ok: false` and a sanitized `error: { code, message }`: 400 invalid parameters,
404 unavailable/empty history, 429 load/provider limit, 502 upstream/auth/invalid data,
503 missing server configuration, 504 upstream timeout. Structure is all-or-error if a
timeframe fails; it does not present a partial response as a complete market structure.
No provider credentials, session tokens, account data or trading actions are exposed.

## Verification and deployment

```sh
npm test
npm run lint
npm run build
# After deploying to the existing Vercel project:
npm run test:public -- https://capitalive.vercel.app
```

Unit and route tests use an explicitly mocked upstream and cover NAS100, EURUSD, XAUUSD,
EU50 × all three timeframes, DEMO/LIVE separation, UTC/OHLC/bid-ask validation, limits,
cache, session expiry, rate limits, failure responses and the existing quotes contract.
They are not evidence of real Capital.com history availability. `test:public` performs
unauthenticated external HTTP checks of the 12 candle combinations, structure and quotes;
it exits nonzero on a failed check. Live DEMO/LIVE validation requires separately
configured real deployments for those environments.

Deploy only to the existing `capitalive` project, preserving its Capital.com environment
variables, then run the public checks. A local build is not a deployment verification.

## Missing bars and current-period diagnostics

Both history endpoints include `metadata.diagnostics` (per timeframe in structure).
`insufficient_history: false` only confirms the requested number of valid bars; older
bars can fill that count even when a more recent bar is missing. It does not prove
continuity or the presence of the forming candle.

- `latest_provider_bar_time` and `latest_returned_bar_time` distinguish the newest
  timestamp supplied by Capital.com from the newest accepted bar.
- `current_period` uses the nominal UTC grid (Monday for W1, midnight for D1, 00/04/08/
  12/16/20 for H4). Its status is `present`, `filtered_by_validation`,
  `not_in_provider_response`, or `not_yet_fetched` if a cached fetch predates the period.
- `current_period.rejected` and `rejected_rows` include a timestamp and reason;
  crossed-side rejections identify the exact OHLC field and original BID/ASK values.
  These are rejected market observations, not usable replacement candles.
- `missing_filtered_times` lists rejected timestamps absent from the returned window.
  A rejected duplicate does not count as missing when another valid row was accepted.
- `provider_gaps` groups nominal intervals absent from the provider timestamp list.
  **Trading hours, weekends and holidays are not checked:** these gaps are observations,
  not proof of a provider outage or a promise that a candle should exist.
- `retrieval_age_seconds` and `retrieval_status` describe the server fetch only.
  `price_update_freshness: "unknown_bar_start_is_not_last_tick"` explicitly prevents
  treating a bar start or a fresh HTTP request as proof of a fresh market tick.
- Lists are capped at 20 entries (4 rejection details for the current period), with
  totals/omission counts. Details are scoped to the returned window; existing quality
  counters describe the whole provider fetch. Even an all-rejected/empty 404 includes
  diagnostics. No full raw provider response or account/session fields are exposed.

The chart warns when the nominal current period is absent. Existing strict OHLC and
crossed-side validation remains in place; missing prices are never reconstructed.

For a smaller analytical response, use
`/api/structure?symbol=NAS100&w1=20&d1=30&h4=40` (90 candles rather than 560 by default).
Run `node scripts/audit-history.mjs https://capitalive.vercel.app` to measure exact
decoded UTF-8 JSON sizes and inspect current W1/D1/H4 data for NAS100 and EU50.
The gzip figure from that script is a local compression estimate, not measured wire
traffic or an LLM token count.

## Tick archive, MN1 and original EDGE observations

New additive endpoints and fields preserve the old quote aliases and native candle arrays:

```text
/api/structure?symbol=BRENT&mn1=60&w1=52&d1=180&h4=120
/api/candles?symbol=BRENT&timeframe=MN1&limit=60
/api/quote-at?symbol=BRENT&at=2026-11-05T21:21:30Z
```

`mn1` is opt-in on structure, so existing clients keep their previous response and latency.
MN1 accepts 1–60 months (default 60). It aggregates only Capital.com DAY bars, using UTC
calendar months, not WEEK bars or 30-day intervals. Up to 60 recent calendar months are
requested in bounded ranges of at most 900 calendar days / 1000 provider rows per request.
No missing month/session is invented. Open/close use the first/last available daily bar;
high/low use all daily bars, independently for BID and ASK. An invalid side anywhere in
a month makes that entire monthly side null. `start_time` is inclusive, `end_time` is the
exclusive next-month boundary. `is_closed` means that boundary elapsed at retrieval;
it does not certify that every trading session is present.

Each MN1 includes `source`, first/last daily timestamps, daily count and
`history_completeness`. Without an exchange session calendar, completeness remains
`unknown_sessions_not_verified`, or `partial_validation` when daily observations were
rejected/incomplete. Metadata records requested coverage, pages and missing monthly
periods. Having 60 monthly bars alone is not proof of full session coverage.

Quotes add `provider_timestamp`, `received_at_utc`, `fetched_at_utc`, `environment`
and `rest_fallback_reason`. Provider time is accepted only with a full date and time
belonging to the same price observation. A separate REST response's timestamp is never
attached to a snapshot. Time-of-day-only / missing timestamps give `age_seconds: null`.
HTTP fetch/receipt time is never treated as tick time. Crossed BID/ASK is rejected.
`diagnostics.websocket` reports connection state, individual subscription acknowledgements,
last actual ticks, validation failures, REST fallback reasons and the worker heartbeat.
An acknowledgement alone does not prove a tick arrived. Worker heartbeat freshness is
evaluated independently from the last tick (a closed market may have no new ticks).

`quote-at` returns `status: exact_tick` only for a saved observation whose provider
timestamp exactly matches `at`. It never returns the current quote as a historical one.
Otherwise it requests Capital.com MINUTE data for the containing minute. If available,
`status: interval_estimate`, `exact: false`, `quote: null` and explicit interval/OHLC
identify that estimate; the minute's close can include prices after the requested time.
With neither exact tick nor minute data it returns `status: no_data`. A prior archived
observation is separately labelled with its temporal deviation, never silently promoted
to exact. Network/authentication failures remain HTTP errors, not a claim of no history.
The archive's absence/failure is explicit in `archive_status`. Historical data cannot
recover ticks that were never recorded, and data availability depends on Capital.com.

### Permanent storage and continuous worker

Use Node 24. Set a durable **PostgreSQL** `DATABASE_URL` on both the web deployment and a
separate continuously running worker. Tables/indexes are created idempotently on first
use. The database role needs CREATE/SELECT/INSERT/UPDATE; configure TLS through the
connection string as required by your database service. DEMO and LIVE records are isolated.
Back up this database; no retention deletion runs automatically.

```sh
npm ci
npm run worker
# Bounded operational probe, using the same environment:
npm run worker -- --seconds=30
```

The worker subscribes continuously to NAS100, JP225, EURUSD, GER40, EU50, UK100 and BRENT.
It persists every valid received tick, pings the Capital.com application protocol each
minute, watches heartbeat timeouts, reconnects with bounded backoff, and refreshes REST
context each minute. It publishes a durable heartbeat every five seconds. Failed archive
writes/backpressure cause a visible failure and process exit for supervisor restart;
continuous coverage is not claimed across outages. Diagnostics include last ticks and
connection reasons. Logs intentionally omit credentials and raw upstream responses.

`Dockerfile.worker` and `deploy/capital-worker.service` are deployment templates. Run one
worker replica per environment on an always-on host; use restart supervision and monitor
heartbeat age, archive failures and collection gaps. Do not run it as a Vercel function
or intermittent cron job. Vercel only serves HTTP requests and reads/writes the shared DB.
Request-time short WebSocket collection remains a fallback and is not a 24/7 archive.

For local/self-hosted operation only, `ARCHIVE_SQLITE_PATH=/persistent/path/ticks.sqlite`
selects SQLite WAL with synchronous durable commits. The web process and worker must
share that same persistent local disk. SQLite is explicitly disallowed on Vercel; `/tmp`
or an unmounted container filesystem cannot provide permanent storage. PostgreSQL takes
precedence when both settings exist. Database URLs/credentials never reach the browser.
If storage is not configured the existing quote API stays available and reports that
archiving is not configured; it does not silently claim persistence.

### Recording EDGE from ChatGPT

This repository has no original EDGE generator. ChatGPT/integration must explicitly call
`POST /api/edge` with `Authorization: Bearer <EDGE_INGEST_TOKEN>` (server-side secret).
New chat messages are not observed automatically. Payload example:

```json
{
  "id": "chatgpt-edge-20261105-212130-brent",
  "source": "ChatGPT",
  "symbol": "BRENT",
  "original_time": "2026-11-05T21:21:30Z",
  "direction": "LONG",
  "edge": 0.72
}
```

The original direction and numeric EDGE are stored without recalculation or trading
actions. Time is the signal's actual source time, not the later API invocation time.
The immutable record includes ingestion time, archived BID/ASK, price source, tick age
at the signal, temporal/receipt deviations and data quality. Prefer observations whose
provider AND receipt times are at/before the signal. If only a delayed receipt exists,
label it `received_after_signal` and `exact_at_signal: false`. Prices with provider times
after the signal are never selected. No archive price yields `no_data`; future prices
are not retroactively inserted. The same environment/source/id is idempotent; conflicting
replays return 409 and the original record. Replaying later cannot revise the snapshot.
Missing token or storage returns 503, unauthorized requests 401. No alert/trading rule or
original EDGE score is modified by this endpoint.

### Verification

`npm test` covers daily aggregation, year/leap boundaries, incomplete months and missing
sessions, all seven MN1 API symbols, separate BID/ASK, stream acknowledgements, invalid
ticks, receipt time and out-of-order events, durable SQLite reopening, environment
isolation, exact/prior/minute/no-data history, delayed receipts and immutable EDGE replay.
PostgreSQL production connectivity and real provider availability require configured
infrastructure; passing fixtures does not certify those external dependencies.

With real Capital.com variables configured locally, run:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/verify-capital-live.ts
```

This reads actual WebSocket/REST data, all seven MN1 series and the requested historical
BRENT time; it writes only market-data verification output to ignored
`data/capital-live-verification.json`. It does not submit orders or change account settings.
Protocol and historical range semantics follow the
[official Capital.com API documentation](https://open-api.capital.com/).

Actual DEMO verification on 2026-11-06 is recorded in
[`verification/capital-demo-2026-11-06.json`](verification/capital-demo-2026-11-06.json).
It confirms seven real WebSocket subscriptions/ticks, 60 monthly bars per requested
instrument, six closed-month comparisons against separately retrieved DAY data for
BRENT/NAS100, and structure counts 60/52/180/120. The requested historical BRENT timestamp
returns only a minute interval estimate (21:21–21:22 UTC), not an exact tick.
Rejected daily rows are disclosed in the report and affected months are flagged partial.
This checks the configured DEMO account, not a LIVE account. The separate Vercel
deployment was created with `--skip-domain`; the public site domain was not promoted.
The shared database and continuously running worker remain unconfigured, so this report
does not certify continuous collection. `node scripts/verify-recorded-data.mjs` replays
the assertions against the downloaded `data/staged-*.json` files in this workspace.

For release verification against the actual public domain (not a staged deployment):

```sh
npm run test:release -- https://capitalive.vercel.app
```

This checks all seven MN1 series, the structure counts, explicit HTTP 400 errors for
unsupported/empty timeframes, the requested historical BRENT time, and quote timestamp
semantics. It writes the unedited BRENT responses to `verification/production-mn1.json`
and `verification/production-quote-at.json`, plus `verification/production-release.json`.
When the database is ready, it also retrieves a newly archived tick by its exact provider
timestamp. API success and complete infrastructure readiness are reported separately;
`all_requested_capabilities_verified` remains false without a verified archive/worker.
Initialize a newly configured database with `npm run archive:init` before starting the
continuous worker. Neon provisioning through Vercel can require the account owner to
accept marketplace terms; no database exists until that step and provisioning complete.

The update was subsequently published to **https://capitalive.vercel.app** on
2026-11-06 (deployment `dpl_E3DJV9JsfHetja8pQ7s2EG6D3tjf`). Public, unauthenticated
release verification confirmed 60 MN1 bars for all seven requested symbols, structure
counts 60/52/180/120, HTTP 400 `INVALID_TIMEFRAME` for unsupported/empty intervals,
and the historical BRENT minute estimate. The real JSON examples and request IDs are
in `verification/production-*.json`. At this check the database was not connected:
`archive_status: not_configured`. The account owner subsequently accepted the Neon
marketplace terms; the `capital-live-archive` PostgreSQL resource (Free plan) was
provisioned, connected to production, and its schema initialized. A subsequent deployment
and release report verify actual tick persistence with that database.
The historical interval response must not be interpreted as an exact saved tick or
proof that a continuous archive is already running.

Continuous collection still requires deploying `npm run worker` on an always-on host
with Capital.com credentials and the shared database URL. The HTTP service durably saves
the observations it receives during requests; without a running worker it cannot promise
coverage between requests. The free database plan has finite storage/compute quotas;
monitor usage before continuous collection and retain backups. No automatic archive
deletion or paid plan upgrade is enabled.

`railway.json` selects `Dockerfile.worker` and `npm run worker`, one US East replica,
automatic restarts and a 30-second shutdown drain. Keep Railway serverless sleeping
disabled for this service, and do not expose a public HTTP domain for the worker.
Set the four `CAPITAL_*` variables and the same production `DATABASE_URL` in its private
variables. Protected Capital.com secrets cannot be exported by `vercel env pull`; those
must be supplied by the account owner through Railway's private variables interface.
The configuration is ready but does not itself connect or deploy a Railway account.

After `test:release` records an exact archived tick, verify it independently of the web
function and after reopening the database connection:

```sh
node --env-file=.env.archive-setup --conditions=react-server --import tsx scripts/verify-durable-archive.ts
```

The proof is written to `verification/production-durable-archive.json`, containing only
market data and test outcomes. The environment file must remain private/ignored and
should be removed after setup; it must never be committed or uploaded in a build context.

Current production deployment after database connection:
`dpl_Dr9kN1L7c2EgPUW8cyRWzq1C3fpA` (2026-11-06). Release verification reports
`archive_status: ready` and successfully recovers the real BRENT WebSocket tick at
`2026-11-06T04:38:58.764Z` (BID 99.004 / ASK 99.044). An independent process reopened
PostgreSQL and read the same record; see `verification/production-durable-archive.json`.
The earlier requested 2026-11-05 time remains an interval estimate, because recording
began after that event. A new archive cannot reconstruct past unrecorded exact ticks.

Hosting constraint: **free plans only**, as requested by the owner. Neon is on Free;
no Railway paid subscription has been activated. Railway Free/Trial is the prepared
worker target, pending account connection and private Capital.com variables. Its free
credits/resource quotas do not guarantee uninterrupted 24/7 collection. Do not upgrade
plans automatically or describe the worker as running until a fresh persisted heartbeat
and actual saved ticks confirm deployment. Data remains in the separate Neon database
when a worker process stops; capacity and provider quotas still need monitoring.
