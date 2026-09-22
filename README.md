# Capital.com Market Feed

Minimal, read-only Next.js App Router API for current Capital.com CFD quotes.

This project is market-data only. It implements only session creation and market-data GET
requests. It does not contain trading, account-changing, or preference-changing endpoints.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the four `CAPITAL_*` variables in `.env.local`. `CAPITAL_API_PASSWORD` is the
   custom password created with the Capital.com API key.
3. Run `npm install` and `npm run dev`.
4. Open `http://localhost:3000/api/markets` or `http://localhost:3000/api/quotes`.

## Vercel

Add `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER`, `CAPITAL_API_PASSWORD`, and
`CAPITAL_API_BASE_URL` in **Project Settings → Environment Variables**, then deploy.
