# Capitalive V4 — замена EU50 на JP225

Дата проверки: 16 ноября 2026. **Замена реализована и проверена в Preview и отдельной приватной проверочной ветке. Рабочая публикация ещё не переключена.** Новая активная тройка: **EURUSD / NAS100 / JP225**.

## Объём изменения

- Основной [PR #6](https://github.com/Yilin1207/capitalive/pull/6) направлен в V4-ветку `research/v4-pa-validation-20261116` поверх PR #5; база `14be2a620313d44021aee856afa6e12a3331a6a2`.
- Приватный [PR #4](https://github.com/Yilin1207/capitalive-research-bridge/pull/4) направлен в `research/v4-contract-20261116` поверх PR #3; проверенный код publisher `068fca96b1df0a4ee0f1f326d25b5b24a30294ea`.
- Общий активный список используется интерфейсом, desk-report и publisher. JP225 добавлен в технический анализ, Market Audit, Intelligence и строгий JSON-контракт. Идентификаторы evidence допускают JP225 и проверяют принадлежность символу/стороне.
- EU50 остаётся в общем каталоге/API и исторических fixtures; `/api/desk-report?symbol=EU50` теперь возвращает 400. Архивная проекция/валидация EU50 сохранена для replay. Blind-пакет с историческими примерами EU50 не переименован и не удалён.
- **PA, lifecycle, Narrative, target selection и формирование свечей не изменялись.** Diff `lib/knowledge`, `lib/candle-data.ts`, `lib/monthly-candles.ts`, `lib/daily-recovery.ts` относительно базы V4 пуст. Изменён только выбор активов, метаданные JP225, отображение точности и перенос EU50 из latest в архив.

## Подтверждённые характеристики JP225

Фактический ответ `Capital.com /api/v1/markets/J225`, получен 2026-11-16T08:10:48.028Z через защищённый Preview. [Безопасные метаданные](verification/jp225-migration/provider-metadata.json).

| Поле | Подтверждённое значение |
|---|---|
| Символ / EPIC | JP225 / **J225** |
| Название / тип | Japan 225 / INDICES; брокерский CFD на японский индекс, не фьючерс и не календарь Tokyo cash |
| Среда / валюта | **Demo**, JPY; эквивалентность Live не установлена |
| Котировка | Capital.com REST/WebSocket; отдельные Bid/Ask и provider timestamp |
| Точность отображения | 1 десятичный знак, наблюдённый в quote и всех четырёх OHLC-рядах; provider не объявил decimalPlaces |
| Lot size | 1 |
| Tick size / contract size | **Не подтверждены, null** |
| Min/max deal size | 0.1 / 80 000, unit POINTS, как вернул provider |
| Min step distance | 0.1 POINTS; **не интерпретируется как tick size** |
| Текущий часовой пояс расписания | UTC |

Текущее расписание provider: пн–чт `00:00–22:00`, `22:05–00:00`; пт `00:00–22:00`; сб закрыто; вс `23:00–00:00`. Оно не доказывает прошлые праздники/DST/полноту сессий. JP225 не наследует календарь EU50/NAS100: исторический regularSession остаётся UNKNOWN. Диагностика явно сообщает непроверенное покрытие. Проектный порог малости FVG в 1 index point — существующая настройка анализа индексов, не характеристика контракта или торговый tick.

## OHLC и технический pipeline

Получены реальные данные J225: MN1 60, W1 120, D1 200, H4 240 свечей. При общем `as_of=2026-11-16T08:06:37.110Z` допускаются соответственно **59 / 119 / 199 / 239 закрытых** свечей. Формирующиеся свечи исключены. В этом нормализованном наборе discarded_rows=0; это не доказательство отсутствия недостающих сессий.

- H4/D1/W1 берутся из native `HOUR_4/DAY/WEEK` provider с UTC start. Дневные/недельные свечи не создаются путём копирования параметров EU50.
- MN1 — существующая календарная агрегация DAY в UTC, без разбиения недель и без интерполяции отсутствующих цен.
- Повторно получены сырые D1/W1/H4: все **199 / 119 / 239** пересекающихся закрытых свечей совпали по timestamp и всем OHLC Bid/Ask.
- **32 полных месяца** из независимого raw DAY-запроса совпали с MN1 по всем OHLC. Первый неполный месяц raw-окна исключён из сравнения. [Результаты сверки](verification/jp225-migration/data-summary.json).

JP225 прошёл неизменённый V4 pipeline для обеих сторон. Replay каждого закрытого префикса: **616 Bid + 616 Ask = 1 232 проверки**, без расхождений и будущих подтверждений. [Сводка replay](verification/jp225-migration/replay-summary.json).

| Детектор | Bid / Ask, число исторических выдач |
|---|---:|
| Fractal 3 / Fractal 5 | 250 / 250; 122 / 122 |
| FVG | 115 / 116 |
| SNR / двухсвечный RB | 136 / 136; 120 / 120 |
| Raid | 139 / 139 |
| BOS / CHOCH | 47 / 47; 20 / 20 |

Lifecycle сохраняет исходную роль и отзывает недоказанную текущую; INVALIDATED/CONSUMED/UNVERIFIED не получают действующую роль. DR-кандидаты доступны: MN1 12, W1 41; в данном срезе D1/H4 допустимых активных пар нет. Диапазон не создаётся искусственно. Targets/obstacles проходят обычные V4 проверки; полнота пути не повышается до COMPLETE. Candidate Narrative остаётся неподтверждённым, action=NOT_EVALUATED. Compression/Displacement и прочие прежние NEEDS_SPECIFICATION остаются такими — это не новые дефекты подключения JP225 и не повод менять алгоритмы в этой задаче.

На одинаковых сохранённых входах EURUSD и NAS100 × Bid/Ask полные Intelligence и desk-report **идентичны V4 до миграции**, а не просто похожи по итоговому направлению. Исторические EU50 regression tests продолжают выполняться.

## HTTP и публикация

Проверенный runtime commit: `e5cf95e0af3164e1a99eec58ed79296d5c4fb986`. [Immutable Preview](https://capitalive-f56a94iqf-yilin1207s-projects.vercel.app/intelligence). Внешняя проверка шести EURUSD/NAS100/JP225 × Bid/Ask ответов: **HTTP 200 application/json**, строгий контракт, причинность, ID, размер ≤65 536 байт; шесть detail-запросов совпали по snapshot hash. JP225 PNG: **HTTP 200 image/png**, 111 414 байт, PNG signature проверена. SSO сохранён; неавторизованный запрос возвращает 302. [Все SHA/bytes/timestamps](verification/jp225-migration/http-summary.json).

Защищённые маршруты: [JP225 desk Bid](https://capitalive-f56a94iqf-yilin1207s-projects.vercel.app/api/desk-report?symbol=JP225&side=bid), [Ask](https://capitalive-f56a94iqf-yilin1207s-projects.vercel.app/api/desk-report?symbol=JP225&side=ask), [H4 PNG](https://capitalive-f56a94iqf-yilin1207s-projects.vercel.app/api/chart?symbol=JP225&timeframe=H4). Требуется существующий Vercel-вход.

В приватном репозитории выполнена **реальная тестовая публикация**, не mock: [ветка verification/jp225-20261116](https://github.com/Yilin1207/capitalive-research-bridge/tree/verification/jp225-20261116/reports/latest), commit `418dd1a9e416ecd86f26f71a2e97585e3db8013b`. Использован настоящий publisher; его ref-read/ref-update направлены только на изолированную ветку. `main` не изменялся.

Manifest и все три файла повторно прочитаны по закреплённому commit; размеры и SHA-256 совпали:

| Отчёт | Bytes с LF | Статус |
|---|---:|---|
| EURUSD.json | 59 668 | PARTIAL |
| NAS100.json | 58 356 | PARTIAL |
| JP225.json | 49 872 | PARTIAL |

Manifest содержит ровно EURUSD/NAS100/JP225. Старый latest/EU50.json перенесён **тем же blob**, без потери содержимого, в `reports/archive/EU50/73c759a4c1515a4f12b18ea3a1ae832c75cf3582.json`; latest/EU50.json отсутствует в проверочной ветке. Старые архивы не удалялись. [Доказательства readback](verification/jp225-migration/publication-summary.json).

## Тестирование и ограничения запуска

- **275 unit/integration tests PASS**, 0 failed/skipped; добавлены только проверки JP225, активной тройки, отсутствия подмены календаря и публикации/архивирования.
- **10 native Node 24 publisher tests PASS**: manifest, три символа, exact bytes/SHA, атомарный архив EU50, отказ при неправильном наборе/контракте, секреты-canary.
- Lint/TypeScript и Build PASS. UI: 3 целевых Chromium-теста PASS, оба активных селектора показывают ровно EURUSD/NAS100/JP225. [Полный CI runtime-коммита](https://github.com/Yilin1207/capitalive/actions/runs/43829627738) SUCCESS, включая прежние V4/архивные replay, Chromium и RC HTTP. [Приватный CI](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43829635204) SUCCESS, рабочий publish job намеренно SKIPPED для PR. Последующие commits уточняют тест/документацию и проверку формы дерева архивирования; окончательные head-статусы также доступны в PR.
- Новый JP225 replay воспроизводится командой `JP225_INPUT=<private capture> node --conditions=react-server --import tsx scripts/verify-jp225-migration.ts`. Полный OHLC захват хранится только в игнорируемой `.vercel/jp225/private`; опубликованы только безопасные summaries. Синтетический CI fixture явно помечен synthetic и не выдан за реальный JP225 golden.

**Research Bridge технически готов передавать JP225:** это подтверждено реальной публикацией и чтением из приватного GitHub. Однако **рабочая система ещё не переключена**: оба миграционных PR и исходные V4 PR остаются открытыми. Для запуска нужны разрешённые согласованные merge V4, затем миграционных PR, выбор проверенного JP225 Preview и переключение private BRIDGE_BASE_URL. До переключения следует согласовать окно scheduled/manual publisher: старый источник не поддерживает JP225 desk и вернёт явный ERROR, а не фиктивный отчёт.

Существующие H4 cron и manual workflow_dispatch не изменены; после одобренного переключения они используют новый централизованный список. Текущие main, Production, секреты, SSO и рабочий BRIDGE_BASE_URL не изменены. Данные JP225 подтверждены, но качество остаётся PARTIAL из-за непроверенной полноты исторических сессий; tick size/contract size неизвестны. Независимая точность PA этой миграцией не заявляется.

Макроанализ, оценка EDGE и решение о сделке остаются за ChatGPT. Другие инструменты и алгоритмы не дорабатывались. На этом целевая миграция завершена; дальнейшая разработка не выполняется.
