# Research Desk Fix — финальный аудит

Дата: 15 ноября 2026. Повторное чтение приватного GitHub: 2026-11-15T16:00:25.987Z.

**Вердикт: READY для интеграции Research Desk Fix в Research Bridge.** Вердикт вынесен после успешной реальной публикации и повторного чтения manifest и всех трёх отчётов из одного коммита GitHub. Это техническая готовность доставки исследовательских данных; не подтверждение свежести котировок, торговой эффективности или независимой экспертной валидации.

## 1. Root Cause

В приватном репозитории оставалась прежняя строгая копия portable contract без поля `range_candidate`. PR #3 добавил это поле в frames, в том числе со значением null. Прежний whitelist отклонял все три рынка на `report.frames[0]`. Общий catch publisher превращал ошибку схемы в `TRANSPORT_ERROR`.

Причина воспроизведена на одинаковых байтах реальных ответов исходного Preview: старый приватный validator — FAIL, новый validator PR #3 — PASS для EURUSD/NAS100/EU50 × Bid/Ask. Все шесть ответов имели HTTP 200, Content-Type application/json, status STALE, error null. Размеры до исправления publisher:

| Рынок | Bid, байт | Ask, байт |
| --- | --- | --- |
| EURUSD | 63718 | 63543 |
| NAS100 | 57119 | 57122 |
| EU50 | 52663 | 51683 |

Это не HTTP redirect, не 500/503, не превышение лимита и не недопустимая геометрия кандидата. [Неудачный Actions run](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43731490903) сохранён в истории. Точный исходный HTTP payload той публикации не восстановлен: причинность установлена повторным воспроизведением несовместимости на текущих ответах и кодом старого catch. На старом адресе публикация успела восстановиться до начала этой работы; это не выдаётся за исправление нового Preview.

`markets_batch → HTTP 200 → Invalid response schema` — отдельная ошибка необязательной ветки котировки. `getAnalysisQuote` использует Promise.allSettled и допускает отказ batch при доступном single-market REST/WS. Регрессионный тест воспроизводит batch schema rejection и подтверждает сохранение основного Bid/Ask без выдуманного provider_timestamp. Утверждение, что исправлен формат ответа самого Capital.com, не делается. Критический отказ истории/провайдера по-прежнему выдаёт ERROR/503.

## 2. Исправления и интеграция

- Portable contract и publisher синхронизированы в двух репозиториях. Проверено побайтовое равенство копий после публикации.
- Ревизия `desk-report-v1.1` передаётся заголовком X-Desk-Contract и в manifest. Несовместимая явно указанная ревизия отклоняется.
- Добавлены безопасные стадии отказа: http, schema, size, expiry, provider, publish; коды из whitelist, HTTP status, счётчик байтов и категория Content-Type. В диагностике нет upstream body, stack, URL с параметрами, секретов и свободного текста исключений.
- Ошибки схемы больше не называются сетевыми. Отдельно проверены redirect/HTTP 500, HTML, неверный JSON, плохая геометрия, несовместимая ревизия, превышение размера, expiry, provider 503, сеть и GitHub 403. Canary-секреты не попадают в диагностические записи.
- Лимит 65 536 байт учитывает завершающий LF опубликованного файла. Просроченный не-ERROR отчёт отклоняется; ERROR публикуется явно, workflow завершается с ошибкой, старый успешный файл не сохраняется под видом нового.
- Прежние правки PR #3 сохранены: X/X−1/X−2, кандидатные Fractal 3 диапазоны, альтернативные A и проверки причинности. Алгоритмы THE EDGE этой доработкой не переопределены.
- [Capitalive PR #3](https://github.com/Yilin1207/capitalive/pull/3) слит только в `feature/the-edge-knowledge`, merge SHA `2aaff0f41339437c4fde9aa8b75723093211a02d`. Проверенный исполняемый SHA: `ccf2c298ad1d4b3bea0c9c340f58035862b367a9`.
- [PR #2 приватного bridge-репозитория](https://github.com/Yilin1207/capitalive-research-bridge/pull/2) синхронизирует publisher и контракт; он слит в private main. Это другой PR, не основной Capitalive PR #2.

Хеши совпадающих исходных файлов (исходники; не секреты):

| Файл | SHA-256 |
| --- | --- |
| lib/research-bridge/contract.ts | `1c87198397ac4fa6e464482625af312afca50912cab6da1b1896aae241b413d3` |
| scripts/publish-research-bridge.ts | `5ad9c14ca612426beff3ec77e0a13aed27b2fa79ff5a85dff70136fed1998104` |

## 3. Тесты и CI

- Локально: 231/231 unit/regression tests; 7/7 portable publisher tests под нативным Node 24 без tsx; TypeScript и Next build — PASS.
- THE EDGE replay: 6/6 archive cases; replay v2: 12/12 control/archive × EURUSD/NAS100/EU50 × Bid/Ask — PASS. Исходная независимая проверка EURUSD 1.10225 не объявляется восстановленным golden case.
- [Release checks проверенного SHA](https://github.com/Yilin1207/capitalive/actions/runs/43732552002) — SUCCESS. Все шаги: npm test, knowledge import, оба replay, lint/tsc, build, Playwright UI и verify-rc-http — SUCCESS.
- [Private publisher PR CI](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43732523468) — SUCCESS; публикация на pull_request закономерно skipped.
- Тест `X/X-1/X-2: MN1 anchor may validate an eligible D1 structural target, without skipping obstacles` — PASS. Разрешение D1 не означает автоматический выбор любого D1 target; проверки роли/геометрии/препятствий сохранены.
- Проверены отсутствие будущих свечей/подтверждений/взаимодействий, полнота ссылок на evidence, candle_refs, уникальность ID, тип/полярность Fractal 3 и отсутствие автоматического повышения Candidate Narrative.

## 4. Реальные HTTP-проверки

Проверенный immutable Preview: https://capitalive-ogpymvyfo-yilin1207s-projects.vercel.app

Endpoint: `GET /api/desk-report?symbol=EURUSD|NAS100|EU50&side=bid|ask`.
Проверка завершена: 2026-11-15T15:58:57.976Z. Запросы выполнены извне с существующим служебным bypass, без изменения SSO. Каждый ответ содержит проверенный engine_commit, application/json и X-Desk-Contract: desk-report-v1.1.

| Рынок / side | HTTP | Тело, байт | С LF, байт | Status | Evidence IDs | Кандидатные TF |
| --- | --- | --- | --- | --- | --- | --- |
| EURUSD/bid | 200 | 63718 | 63719 | STALE | 61 | W1 |
| EURUSD/ask | 200 | 63543 | 63544 | STALE | 61 | W1 |
| NAS100/bid | 200 | 57119 | 57120 | STALE | 55 | MN1, D1, H4 |
| NAS100/ask | 200 | 57122 | 57123 | STALE | 55 | MN1, D1, H4 |
| EU50/bid | 200 | 52663 | 52664 | STALE | 51 | MN1, W1, H4 |
| EU50/ask | 200 | 51683 | 51684 | STALE | 50 | MN1, W1, H4 |

Все шесть JSON проходят portable validator, проверку времён и секретов; selected_evidence_complete=true. Полная история и все находки намеренно не включены: findings_omitted остаётся явным, полнота выбранных доказательств не выдаётся за полноту всех рыночных данных. Подтверждённый/выбранный dealing_range в этих default-запросах отсутствует; range_candidate имеет review_required=true и отдельный method. confirmed_narrative=null во всех шести ответах. Тест с явно выбранными high_id/low_id отдельно подтверждает сохранение выбранного H4 диапазона, EQ, времени и инвалидации.

SHA-256 именно HTTP body (без дополнительного LF):

| Рынок / side | SHA-256 |
| --- | --- |
| EURUSD/bid | `6b147e9f2c197bd4ede2a8fdad60a4d63febb6d5beffa30483f7d7190996f01e` |
| EURUSD/ask | `9324023d5adac96413295f8041ea1cd23368835a5bcf21bca256f339e12f7714` |
| NAS100/bid | `6db4acd99106046393da1ef4bdc83008ffe44b9346e83f6cf686d0b83d978d30` |
| NAS100/ask | `585b6d026b44468e99a4b9d53454f4660ffffd7d28a00696562b4344485e2db5` |
| EU50/bid | `a94911bd0dd790aea1133bc603086f87a2ab5422c2faa4812ed73a2fd7a56245` |
| EU50/ask | `d63d679115c2ac7b32737f9b1111604ec1113922badc4500a20d2c0bb757bdd4` |

Для всех трёх рынков наблюдалось CLOSED, fresh=false, provider_timestamp=null; последняя закрытая H4 — 2026-11-14T00:00:00.000Z. Причины STALE: QUOTE_PROVIDER_TIME_UNKNOWN и H4_OLDER_THAN_8H_MARKET_CLOSURE_NOT_ASSUMED. Время нового запроса не подставляется вместо времени котировки. Рыночный выходной не используется для сокрытия отсутствующей временной метки.

## 5. GitHub Actions и повторное чтение опубликованных файлов

BRIDGE_BASE_URL обновлена на проверенный immutable Preview. Workflow сохраняет `BRIDGE_BASE_URL: ${{ vars.BRIDGE_BASE_URL }}`, ручной запуск и расписание `17 0,4,8,12,16,20 * * *` UTC. Secrets не создавались и не менялись.

[Ручной Research Bridge run](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43732857035) — **SUCCESS**. Manifest generated_at: 2026-11-15T15:59:28.207Z. Прочитан commit `f12d1d538469a4f96b6718a92f183d236a167cf2` (репозиторий проверен как PRIVATE).

Все четыре файла прочитаны через GitHub Contents API с одинаковым `ref=f12d1d538469a4f96b6718a92f183d236a167cf2`. Для каждого отчёта заново вычислены SHA-256 и размер реальных байтов, сверены symbol/path/status/as_of/generated_at/expires_at с manifest, запущен контракт. ERROR отсутствуют; ревизия manifest — desk-report-v1.1.

| Файл | Байт | SHA-256 | Status | generated_at |
| --- | --- | --- | --- | --- |
| [EURUSD.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/f12d1d538469a4f96b6718a92f183d236a167cf2/reports/latest/EURUSD.json) | 63719 | `e2b534dc59f3f447c73dba3b788278651e561ea069c115997d25fda81a89e6cc` | STALE | 2026-11-15T15:59:14.962Z |
| [NAS100.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/f12d1d538469a4f96b6718a92f183d236a167cf2/reports/latest/NAS100.json) | 57120 | `008b06aa1a057e842a4f6c3ba394b1b9f6b0e43defe44c52d37695ff4bb4296a` | STALE | 2026-11-15T15:59:21.492Z |
| [EU50.json](https://github.com/Yilin1207/capitalive-research-bridge/blob/f12d1d538469a4f96b6718a92f183d236a167cf2/reports/latest/EU50.json) | 52664 | `748ec6b72aa3e5822a8d1d765930b669360705b4992d48f3561d4a246003e276` | STALE | 2026-11-15T15:59:28.075Z |

[Проверенный manifest](https://github.com/Yilin1207/capitalive-research-bridge/blob/f12d1d538469a4f96b6718a92f183d236a167cf2/reports/latest/manifest.json). [Обновляемый каталог latest](https://github.com/Yilin1207/capitalive-research-bridge/tree/main/reports/latest).

Каждый опубликованный JSON содержит SHA нового движка. Количество range_candidate: EURUSD=1, NAS100=3, EU50=3; dealing_range=0; confirmed_narrative=null. Доказательств: 61/55/51, все ссылки разрешаются. Это новая публикация с новыми generated_at/as_of относительно HTTP-проверки и предыдущего manifest; старый снимок не скопирован под новой датой.

## 6. Ограничения и сохранённые настройки

- Production не развёртывался; его target остаётся `capitalive-2rnu3zimh-yilin1207s-projects.vercel.app`. Capitalive main: `d7d1ec5ddebdbce2c90bd7f8c86657d00b9ba1c2`; основной PR #2 не слит.
- Vercel SSO: all_except_custom_domains. Без авторизации проверенный endpoint возвращает HTTP 302; доступ через обычную ссылку требует входа. Токены/bypass не добавлены в URL или документы.
- Автоторговля не добавлена; trading_enabled=false. Ключи Capital.com, аккаунты, полная OHLC-история и личные данные не публикуются. Реальные отчёты остаются только в PRIVATE repo; локальные диагностические ответы — в игнорируемом .vercel.
- Это STALE исследовательские данные с PARTIAL историей и неизвестным временем котировки, а не свежая торговая рекомендация. Полная экспертная/доходностная валидация не выполнялась.
- GitHub cron может задерживаться; свежесть необходимо оценивать по generated_at/as_of/expires_at и status каждого отчёта. Успешный запуск не гарантирует доступность Capital.com при следующих запусках.
- Копия контракта по-прежнему переносится между двумя репозиториями: при будущих изменениях нужно синхронно обновлять publisher/validator и ревизию. Текущее побайтовое совпадение проверено; автоматическое межрепозиторное обновление не заявляется.
- Исторический markets_batch отказ не скрыт, но формат ответов Capital.com этим исправлением не изменён. При повторном отказе диагностика отдельно отмечает необязательную ветку; критические отказы остаются ERROR.

READY относится к проверенному исправлению и доставке в приватный Research Bridge на момент указанного повторного чтения GitHub.
