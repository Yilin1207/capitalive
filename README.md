# Capital.com Market Feed

Read-only Next.js API for current Capital.com CFD quotes. The project contains no trading,
account-changing, or preference-changing endpoints.

## Endpoints

- `GET /api/quotes` — live WebSocket quotes with REST fallback. Optional cache-busting
  parameters such as `?cb=1727000000000` are ignored safely.
- `GET /api/markets` — verified public-symbol to Capital.com EPIC mappings.
- `GET /api/health` — process-local session and quote diagnostics without credentials.

Quote responses retain the original `server_time` and `markets` fields and also expose
`ok`, `serverTime`, `fetchedAt`, and `quotes` aliases. Upstream calls use bounded timeout,
transient retries, and a single automatic session refresh for expired credentials.

When Capital.com is unavailable, `/api/quotes` may include a best-effort `lastGood`
snapshot. Every saved quote is explicitly marked `stale: true` and `fresh: false`.
This cache is process-local only: Vercel may recycle an instance or route a request to a
different instance, so `lastGood` and health timestamps are not guaranteed to persist.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the four `CAPITAL_*` variables. `CAPITAL_API_PASSWORD` is the custom password
   created with the Capital.com API key.
3. Run `npm install`, `npm test`, and `npm run dev`.
4. Open `http://localhost:3000/api/quotes`.

## Vercel

Add `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER`, `CAPITAL_API_PASSWORD`, and
`CAPITAL_API_BASE_URL` in **Project Settings → Environment Variables**, then deploy.
