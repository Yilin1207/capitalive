# Capital.com Market Feed

Read-only Next.js API for current Capital.com CFD quotes. The project contains no trading,
account-changing, or preference-changing endpoints.

## Endpoints

- `GET /api/quotes` — live WebSocket quotes with REST fallback. Optional cache-busting
  parameters such as `?cb=1727000000000` are ignored safely.
- `GET /api/markets` — verified public-symbol to Capital.com EPIC mappings.

Tracked symbols: `NAS100`, `JP225`, `USDJPY`, `EURUSD`, `XAUUSD`, `GER40`,
`EU50`, `US500`, `XAGUSD`, `UK100`, `US10Y`, `BRENT`, and `GBPUSD`.

`/api/quotes` keeps those 13 instruments in `markets`/`quotes` and adds optional
macro context in `context_markets`:

- `DE2Y` -> German Schatz Dec-2026 future (`FGBSZ2026`)
- `DE10Y` -> German Bund Dec-2026 future (`FGBLZ2026`)
- `UK10Y` -> UK Long Gilt Dec-2026 future (`FLGZ6`)
- `VIX` -> Volatility Index (`VIX`)

These bond values are prices of bond CFDs or bond futures, not sovereign yields.
Their metadata therefore uses `representation: "bond_price"` or
`representation: "rate_future"` and `inverse_to_yield: true`. The API deliberately
does not calculate yield spreads from differences between bond prices. Requested
`US2Y`, `UK2Y`, `JP2Y`, and `JP10Y` instruments remain explicitly listed as
unavailable because no matching Capital.com market was confirmed.

The response also includes `metadata`, `relationships`, and `derived`. Context
futures have an explicit contract month and must be reviewed before expiry.
- `GET /api/health` — process-local session and quote diagnostics without credentials.

Quote responses retain the original `server_time` and `markets` fields and also expose
`ok`, `serverTime`, `fetchedAt`, and `quotes` aliases. Upstream calls use bounded timeout,
transient retries, and a single automatic session refresh for expired credentials.

When Capital.com is unavailable, `/api/quotes` may include a best-effort `lastGood`
snapshot. Every saved quote is explicitly marked `stale: true` and `fresh: false`.
It is also marked `actionable_live: false` and `live_retrieval: false`.
This cache is process-local only: Vercel may recycle an instance or route a request to a
different instance, so `lastGood` and health timestamps are not guaranteed to persist.

`actionable_live` is true only when `market_status` is `TRADEABLE` and the quote is
provider-fresh. A successful REST retrieval without a provider timestamp remains
`fresh: false`; `retrieved_at` and `live_retrieval: true` show that it was fetched in
the current request without incorrectly calling it a fresh market tick.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the four `CAPITAL_*` variables. `CAPITAL_API_PASSWORD` is the custom password
   created with the Capital.com API key.
3. Run `npm install`, `npm test`, and `npm run dev`.
4. Open `http://localhost:3000/api/quotes`.

## Vercel

Add `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER`, `CAPITAL_API_PASSWORD`, and
`CAPITAL_API_BASE_URL` in **Project Settings → Environment Variables**, then deploy.
