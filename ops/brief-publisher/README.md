# capitalive-brief

Static JSON snapshots of the public Capitalive `/api/brief?symbols=NAS100,EU50,EURUSD` batch, for clients that can
reach `raw.githubusercontent.com` but not `capitalive.vercel.app`. Technical price-action facts only (`PA_ONLY`,
`trading_enabled: false`); no keys, account or balance data.

| File | Content |
|---|---|
| `brief/latest.json` | The latest batch exactly as served (`pa-brief-batch-v1`), including per-symbol errors. |
| `brief/<SYMBOL>.json` | `{published_at, source, brief}` — updated only when that symbol succeeded. |
| `brief/status.json` | Last publishing attempt: `ok`, `requested_at` (request sent), `published_at` (response received), per-symbol `results` or the `error`. |

Read `brief/status.json` first. A failed attempt never replaces data with an older success: older files keep
their own `generated_at` / `as_of` / `expires_at`; compare them with `published_at` before use.
Schedule: ~7 minutes after each New York-grid H4 close (GitHub may start runs late).

Raw URLs: `https://raw.githubusercontent.com/<owner>/capitalive-brief/main/brief/latest.json`
