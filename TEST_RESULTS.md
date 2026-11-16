# Capitalive V5.1 — проверенные результаты

Runtime указан в итоговых release-checks.json и HTTP-summary. Коммит `f1caf97`
исправляет decoder в release HTTP проверке; последующий `0d55355` добавляет
полный approach_path для каждого KL в инспекторе. Тесты не являются независимой
экспертной разметкой рынков.

| Проверка | Результат / область |
|---|---|
| npm test | 223/223; включая 13 context tests, Fractal 3, Raid, FVG, RB/SNR, freshness, environment, side, provider guards |
| TypeScript / Next build | PASS |
| Playwright | 10/10, включая V5.1 research, explicit H4 range, blind review и refresh |
| Native private publisher tests | 13/13, без tsx, Node 24 |
| THE EDGE replay / V2 / V4 | PASS; V4 12 cases / 7290 closed prefixes |
| V5 vs V5.1 на фиксированных OHLC | 6/6; одинаковые findings/states/narrative; lossless wire; no look-ahead |
| Live desk-report | 6/6 HTTP 200 JSON; все PARTIAL с отдельными freshness clocks |
| Live detail / inspection | 6 + 6 HTTP 200, snapshot match; bad hash 409, missing hash 400 |
| Full Intelligence HTTP | 3/3 HTTP 200; 2.59–3.55 MB, lossless wire v2 |
| PNG live H4 | 200 image/png, signature verified |
| Local built-server HTTP on recorded transport | 23 checks, 2 decoded PNG, exact H4 pair, snapshot SHA/pages |

Новый suite проверяет причинность ссылок и свечей, arithmetic observed leg,
gaps, quote independence, full fill без false invalidation/role reversal,
consumed boundary/zone, X−1/X−2, omissions, compact budget, обязательные HTF KL,
контрактные future refs, role mismatch, snapshot rejection и dictionary cycles.
Реальные тесты контракта пропускают только разрешённые поля, проверяют отсутствие
OHLC/account data/секретов в публикуемом JSON и byte ceiling. Числа не доказывают
авторскую значимость или торговую точность.

Первый runtime CI [43936973474](https://github.com/Yilin1207/capitalive/actions/runs/43936973474)
прошёл unit/replay/build/browser и упал на последнем HTTP step: legacy test
прочёл словарный ID без декодирования. Исправление использует тот же lossless
decoder, что UI; требования endpoint не ослаблены. Итоговые CI и публикация
фиксируются в [release-checks.json](verification/capitalive-v5-1/release-checks.json).

## Воспроизведение

```powershell
npm ci
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:ui
node scripts/verify-rc-http.mjs
npm run knowledge:replay
npm run knowledge:replay:v2
npm run knowledge:replay:v4
node --conditions=react-server --import tsx scripts/verify-v5-1-context.ts <private-input-manifest.json> <safe-summary.json>
```

Private manifest — массив объектов `{symbol,input,baseline_bid,baseline_ask}`:
пути к исходному JSON `{data,quote}` и двум сохранённым V5 exports `{result}`.
Нужны именно зафиксированные входы с SHA из replay; новые свечи не заменяют
golden inputs. Полный приватный архив не перенесён в публичные fixtures.
Release HTTP использует записанный transport, не реальные Production credentials.
Browser fixture — UI mock, его screenshot не доказательство рыночной картины.

Безопасные HTTP summaries, replay, source revisions и readback находятся в
`verification/capitalive-v5-1/`. SHA каждого отчёта относится к точным байтам
ответа/публикации; archive replay включает финальный newline. Локальные часы
были впереди HTTP server Date примерно на 39 секунд, поэтому freshness при
GitHub readback проверяется по серверному Date с консервативной верхней границей.
