# Capitalive V5 — финальная активация

Дата проверки: 16 ноября 2026, UTC. **CAPITALIVE V5: OPERATIONAL** для технического Research Bridge через защищённый Preview. Это результат проверки работающей цепочки refresh → публикация → чтение по SHA, а не утверждение о постоянной свежести сохранённых файлов или о подтверждённой торговой гипотезе.

## Интеграция

Все зависимые PR слиты после успешного CI. Вложенные ветки интегрированы от дочерней к родительской: #7 → #6 → #5. Методология и runtime при активации не переписывались.

| Репозиторий / PR | Целевая ветка | Merge commit |
|---|---|---|
| [Capitalive #7](https://github.com/Yilin1207/capitalive/pull/7) | feature/jp225-migration-20261116 | `10d974be5b4afd0c33b1d75dcadd3b2d24b5e0d8` |
| [Capitalive #6](https://github.com/Yilin1207/capitalive/pull/6) | research/v4-pa-validation-20261116 | `5a3dfa6afb3bb488c0f6ea5df874e403827f3048` |
| [Capitalive #5](https://github.com/Yilin1207/capitalive/pull/5) | feature/the-edge-knowledge | `83da1268ea0d250eebbdf076ecac8ccaf89619b7` |
| [Bridge #5](https://github.com/Yilin1207/capitalive-research-bridge/pull/5) | main | `50809a3aca4ab56b7176df2ab04e7dd254a21027` |
| [Bridge #6, актуализация README](https://github.com/Yilin1207/capitalive-research-bridge/pull/6) | main | `7261eeab8e81f65ad436cb3b284ee0249630cefb` |

Проверенный исходный head V5: `e823b321917fb9e0e19252ce2706d7d57fa0eaa4`. Git tree всех трёх source merge-коммитов совпал с ним: `809fc7cd28a048f58c6f04ea7b6d31e6ba057464`. Head проверенного Bridge PR #5: `40b31f410865271941894fc31ae75b85bac7f8a6`. Семь переносимых файлов publisher/contract/tests на рабочей main побайтово совпали с интегрированным исходным кодом.

## Рабочая конфигурация

- Источник: [Capitalive V5 Preview](https://capitalive-iyzyi4yo2-yilin1207s-projects.vercel.app/research).
- Runtime engine commit: `a78e5d89ef2c6666ec7cbdb9332918ddd320cbe1`; изменения после него до проверенного head — документация и доказательства проверок.
- `BRIDGE_BASE_URL` приватного репозитория установлен в `https://capitalive-iyzyi4yo2-yilin1207s-projects.vercel.app` и прочитан обратно.
- Активный workflow main действительно использует `${{ vars.BRIDGE_BASE_URL }}`. Старый hardcoded URL не используется.
- Контракты: `desk-report-v2`, `X-Desk-Contract: desk-report-v2.0`, `edge-knowledge-5`.
- Активные рынки: **EURUSD, NAS100, JP225**. EU50 отсутствует в latest; его архив сохранён.
- Workflow активен, расписание `7 * * * *` UTC, есть ручной запуск. Проверены конфигурация расписания и его общий исполнитель ручным запуском; наступление очередного scheduled trigger в этом аудите не наблюдалось.

## Фактическая публикация main

[Ручной запуск 43930101625](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43930101625) завершился **success** на publisher commit `7261eeab8e81f65ad436cb3b284ee0249630cefb`.

Запрос: `2026-11-16T18:33:46.537Z`; подготовка публикации: `18:33:53.147Z`; фактическое время Git commit: `18:33:54Z`; CI readback: `18:33:56.159Z`. `published_at` обозначает подготовку атомарного коммита и не заменяет время поставщика.

Проверенный атомарный report commit: **`22d786105edc65e301949fda8dd5c6abef1fe6d2`**. Он изменил ровно manifest и три отчёта. Все четыре файла прочитаны повторно через авторизованный GitHub API по этому SHA; размеры и SHA-256 отчётов совпали с manifest, Git blob SHA также проверены.

| Файл в reports/latest | UTF-8 bytes | SHA-256 |
|---|---:|---|
| manifest.json | 1559 | `d5b1df0eb6b8ad4c1a9c896467aaffb4f5c4e08f857ddf15501780f120aa1d2b` |
| EURUSD.json | 48194 | `a3c44ff8d2bbd02b1e6ff399591044becf282d48bf2fbfd88a32c0b6221984e6` |
| NAS100.json | 36935 | `53e7f04e5b1e9748cfddd5111894b22404e1ce4a64e114ecf4198185761da287` |
| JP225.json | 37590 | `6e89d34808f46b9cb9fdaeab107c3d5ccb3ae483f4e7e4c48018b00f7663ca9c` |

Все отчёты меньше 65 536 байт. Environment — **Capital.com Demo**, price_side — bid, оба значения Bid/Ask присутствуют. Market status — `TRADEABLE`; report status — `PARTIAL`; quote status — `FRESH` **на момент проверки**.

| Рынок | Bid / Ask | provider_timestamp UTC | Возраст в CI readback | Верхняя оценка возраста при отдельном API readback |
|---|---|---|---:|---:|
| EURUSD | 1.09942 / 1.09949 | 18:33:42.347 | 13.480 с | 33.652 с |
| NAS100 | 27204.7 / 27206.5 | 18:33:43.709 | 12.308 с | 32.290 с |
| JP225 | 59346.6 / 59356.6 | 18:33:45.695 | 10.464 с | 31.304 с |

Все времена таблиц относятся к 2026-11-16. Отдельный readback использовал GitHub HTTP Date `18:34:15–16 GMT` с округлением вверх на 999 мс. Локальные часы оператора опережали серверные примерно на 39 секунд; локальное время чтения не использовано как доказательство возраста котировки.

| Рынок | quote_retrieved_at | generated_at | analysis as_of | expires_at |
|---|---|---|---|---|
| EURUSD | 18:33:49.581 | 18:33:49.584 | 18:25:55.595 | 18:35:42.347 |
| NAS100 | 18:33:51.174 | 18:33:51.177 | 18:26:02.272 | 18:35:43.709 |
| JP225 | 18:33:52.740 | 18:33:53.098 | 18:33:51.707 | 18:35:45.695 |

Последняя закрытая H4 у всех трёх — **2026-11-16 16:00 UTC**. MN1 закрыта 1 ноября 00:00 UTC, W1/D1 — 16 ноября 00:00 UTC. Старый `as_of` EURUSD/NAS100 сохранён для кэшированного анализа неизменившихся закрытых свечей; это не время новой котировки. Будущие/открытые свечи не выданы за подтверждённые доказательства.

## Качество и методология

`selected_evidence_complete=true` у всех трёх отчётов; включено 40/30/30 evidence. Компактный отчёт сознательно не включает все 1205/1123/1093 находки: `all_findings_included=false`, количество пропусков явно указано. ID и времена подтверждения выбранных зависимостей проверены контрактом. `confirmed_narrative=null` у всех трёх.

`PARTIAL` не скрыт: независимая проверка session coverage отсутствует; отмечены границы gaps, на которых паттерны не склеиваются. На MN1 EURUSD отфильтрованы 3 строки, NAS100 — 1; у JP225 отфильтрованы по 1 строке W1/H4. NAS100 MN1 дополнительно имеет `PARTIAL_AGGREGATION`. Это диагностированные потери валидации/покрытия OHLC, без подстановки искусственных свечей. Полная покадровая сводка сохранена в [main-readback.json](verification/capitalive-v5-activation/main-readback.json).

Сохранены author Fractal 3, FVG, SNR, RB, Raid/IDM, HTF KL, MN1/W1/D1/H4, DR, A/B/C candidates и X → X−1 → X−2. `range_candidate` не становится подтверждённым DR, Candidate Narrative не повышается до Confirmed. Fractal 5, generic BOS/CHOCH, ICT OB/Breaker, ATR SNR, автоматический HH/HL bias и искусственные SL/TP не возвращены в активный V5-контракт. Качественные условия автора с недостаточной спецификацией остаются NEEDS_SPEC/REVIEW. Макроанализ и итоговое решение не автоматизированы.

## Повторные проверки

| Проверка | Результат |
|---|---|
| TypeScript, lint, production build | PASS |
| Unit/integration | 209/209 PASS |
| Native publisher | 12/12 PASS |
| Playwright | 9/9 PASS |
| THE EDGE / V2 / V4 replay | PASS; V4: 12 случаев, 7290 закрытых префиксов |
| Записанный HTTP transport | 23 проверки, 2 PNG, 2 snapshot pages PASS |
| Дополнительный фиксированный архив EURUSD/NAS100/JP225 × Bid/Ask | 6/6 PASS |
| Реальный Preview, три рынка × Bid/Ask | 6/6 HTTP 200 application/json, валидный V2, лимит размера соблюдён |
| Реальный JP225 H4 chart | HTTP 200 image/png, 113788 байт, PNG signature PASS |
| SSO без авторизации / исключённый EU50 | HTTP 302 / HTTP 400 соответственно |
| main GitHub atomic readback | 3/3 SHA и размеры PASS, manifest прочитан тем же SHA |

Полный повторный [source CI 43929613425](https://github.com/Yilin1207/capitalive/actions/runs/43929613425) проверил интегрированный `83da1268ea0d250eebbdf076ecac8ccaf89619b7`. Перед слиянием зависимостей также прошли [CI #6](https://github.com/Yilin1207/capitalive/actions/runs/43928664364) и [CI #5](https://github.com/Yilin1207/capitalive/actions/runs/43929085627). Исторические EU50 replay остаются регрессионными архивами и не включают EU50 в активную тройку.

Архив NAS100 от 16 ноября: input SHA-256 `efd85cf036af96e2da8d816b8590088943cf0f2824a5008122dad8d9b2386ccc`, as_of `07:17:59.382Z`. D1 Bullish FVG **27097.8–27419.3**, ID `NAS100:D1:bid:FVG:2026-11-10T00:00:00.000Z:`, подтверждён 11 ноября 00:00 UTC: `ACTIVE`, `UNTOUCHED`, fill=0, `COMPLETE_OBSERVED_INTERVAL`, gaps=[]; закрытие выходных учтено отдельно. Lifecycle не регрессировал. **Это архивный тест, не текущий торговый сигнал.**

## Refresh и восстановление

Реально выполнены три пути публикации main:

1. Push после merge: [run 43929617861](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43929617861), commit `3988921bfe3baab8f2d10f492f51b5fbdf2d3d7d`, успешный readback всех трёх.
2. Operator fallback без Actions и без подмены источника/ветки: commit `4d7cbabf15746d5290f216da52d52dc22a438b08`, успешная доставка и readback. EURUSD получил `provider_timestamp=null` и **STALE**; NAS100/JP225 — PARTIAL с проверяемыми timestamps. Свежесть доставки не была выдана за свежесть EURUSD.
3. Ручной main workflow: run `43930101625`, commit `22d786105edc65e301949fda8dd5c6abef1fe6d2`, все три котировки FRESH при readback, как показано выше.

Первичная серия HTTP Bid/Ask также обнаружила отсутствие timestamp EURUSD и честно вернула STALE. Последующий успешный запрос не отменяет это наблюдаемое ограничение провайдера.

Два реальных refresh NAS100 обновили quote retrieval/generation `18:28:06.600/604` → `18:28:08.224/228`, сохранив analysis as_of `18:26:02.272` и одинаковый evidence SHA-256 `baa47b4925a8ded92b2e6d878500680c261d1214819c4f0d965202c0553b6105`. Unit-тест со счётчиком построений отдельно проверяет отсутствие повторного PA-расчёта для одинакового входа.

Повторный CI проверил provider/client HTTP 429, безопасные stage/code, Retry-After, ограниченный retry и expiry/STALE. Предварительный реальный 429 → 200 stress сохранён в [аудите V5](CAPITALIVE_V5_AUDIT_RU.md); новая нагрузочная серия 429 при финальной активации не выполнялась. Закрытые H4 проверены; прохождение новой H4-границы за ≤600 секунд в этой сессии не наблюдалось.

Для нового исследования откройте [защищённый /research](https://capitalive-iyzyi4yo2-yilin1207s-projects.vercel.app/research), выполните refresh и скачайте компактные JSON. Для публикации в GitHub: [Actions → Research Bridge](https://github.com/Yilin1207/capitalive-research-bridge/actions/workflows/research-bridge.yml) → Run workflow → **main**, `preview_url` оставить пустым; дождаться `bridge_readback` и использовать выведенный report commit.

При недоступности Actions: Node 24, существующие входы Git Credential Manager и Vercel CLI; задайте путь `VERCEL_CLI_JS` и несекретный селектор `BRIDGE_BYPASS_CREATED_AT`, затем `node scripts/refresh-research.ts --project <путь-к-существующему-.vercel/project.json>`. По умолчанию используются рабочая переменная источника и main. Скрипт не создаёт новые credentials и читает опубликованное обратно. `--dispatch` лишь запрашивает Actions, а не подтверждает доставку.

## Чтение в ChatGPT по точному commit

Доступ приватный: требуется авторизованный доступ к репозиторию. В этой сессии ассистент действительно прочитал четыре файла через GitHub API по точному SHA; индексация отдельного GitHub-коннектора ChatGPT не проверялась и не гарантируется.

Проверенный набор:

- [manifest.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/22d786105edc65e301949fda8dd5c6abef1fe6d2/reports/latest/manifest.json)
- [EURUSD.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/22d786105edc65e301949fda8dd5c6abef1fe6d2/reports/latest/EURUSD.json)
- [NAS100.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/22d786105edc65e301949fda8dd5c6abef1fe6d2/reports/latest/NAS100.json)
- [JP225.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/22d786105edc65e301949fda8dd5c6abef1fe6d2/reports/latest/JP225.json)

Для машинного доступа: авторизованный `GET /repos/Yilin1207/capitalive-research-bridge/contents/reports/latest/<file>?ref=<report_commit>` через GitHub API. Декодировать content как bytes, сравнить длину и SHA-256 с manifest. Не читать файлы четырьмя отдельными запросами к изменяющемуся main. Если коннектор не умеет получить указанный SHA, откройте эти файлы в авторизованном GitHub, скачайте исходные JSON и приложите все четыре к чату. Credentials и временные подписанные URL в чат не передавать.

Инструкция для анализа: «Прочитай manifest и EURUSD/NAS100/JP225 из одного указанного commit. Проверь SHA-256, bytes, schema, Demo/Live, сторону, provider_timestamp, expires_at и последнюю закрытую H4. Старое или неизвестное время обозначай STALE и запроси refresh. Используй evidence IDs; сохраняй Candidate/Confirmed и ограничения покрытия. Не делай вывод о текущем рынке только по времени Git commit».

## Ограничения и безопасность

Сохранённый набор истёк после `18:35:42–45 UTC`: он доказывает успешную активацию, но для нового анализа нужен новый refresh. Почасовой fallback и очередь GitHub Actions не обеспечивают постоянную свежесть ≤120 секунд. Нет гарантии доставки за 120 секунд или мгновенной индексации ChatGPT. Источник — Demo, эквивалентность Live не заявляется. Независимая экспертная валидация торговой точности не выполнена.

Production Capitalive остался на `d7d1ec5ddebdbce2c90bd7f8c86657d00b9ba1c2`, deployment `dpl_B1xyiJwXMrxiXBD1dXH9BbBtNTYM`; основной PR #2 не слит. SSO `all_except_custom_domains` сохранён; Bridge PRIVATE; архив EU50 побайтово сохранён. Force-push, новые секреты, изменение production-секретов, платные API и автоматическая торговля не использовались. В публичном аудите только безопасные технические сводки; полные compact JSON остаются в приватном Bridge, сырые OHLC и credentials не публикуются.

Доказательства: [verification/capitalive-v5-activation](verification/capitalive-v5-activation). Предыдущий [CAPITALIVE_V5_AUDIT_RU.md](CAPITALIVE_V5_AUDIT_RU.md) сохранён как аудит до активации; его статус интеграции заменён настоящим отчётом.
