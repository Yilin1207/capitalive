# Capitalive V5 — итоговый аудит

**Вердикт: READY FOR MERGE.** Проверена связка Capital.com → V5 Preview →
Publisher → приватный GitHub → повторное чтение трёх JSON. Это готовность
отдельных PR к согласованному включению. **PRODUCTION READY не заявляется.**
Production, SSO, секреты и основная система макроанализа не изменялись.

## Проверенные версии и окружения

- [Capitalive PR #7](https://github.com/Yilin1207/capitalive/pull/7), ветка
  `feature/v5-realtime-edge-only-20261116`, база `feature/jp225-migration-20261116`.
  Это последовательный PR поверх миграции JP225 (#6); родительские PR автоматически не сливались.
- Проверенный код движка: `cd4c746bda181aca0429faee16fdba4649b0e412`.
- [Immutable V5 Preview](https://capitalive-l2umiufiw-yilin1207s-projects.vercel.app/research),
  Vercel READY, target не Production; запрос без авторизации получает HTTP 302.
  Сохранено `all_except_custom_domains`.
- [Приватный Bridge PR #5](https://github.com/Yilin1207/capitalive-research-bridge/pull/5).
  Проверенный publisher: `0e4074a90341b5f4c03d7de289285c920c11b697`.
  Последующие коммиты аудита/инструкций не меняют проверенный исполняемый код.
- V5 публиковалась в **реальную ветку `verification/v5-current` приватного Bridge**.
  Коммит файлов: `71a4ddd5335a5e3d851ceb87957e16a5dbce1b34`.
- Рабочая `main` также проверена и обновлена отдельно: `60ea7845830a85f3326b79b4f150dcdb9255d907`.
  Там пока **старый `desk-report-v1`**, движок `e5cf95e0af3164e1a99eec58ed79296d5c4fb986`.
  Этот refresh не выдаётся за включение V5.

## 1. Причина задержки и архитектура

Исходный main `411ba81399afaff83242b8de0503e5397df6e6f9` содержал manifest
2026-11-16T08:36:55.920Z, котировку NAS100 08:36:43.929Z и закрытую H4 08:00Z.
Расписание `17 0,4,8,12,16,20 * * *` само допускает многочасовую задержку;
GitHub может дополнительно задерживать scheduled jobs. В первом V5 запуске
мониторинг зафиксировал возраст прежней публикации **33 130 секунд**.

В действующем старом workflow источник жёстко задан как
`https://capitalive-f56a94iqf-yilin1207s-projects.vercel.app`.
Переменная `BRIDGE_BASE_URL` указывала на `capitalive-ogpymvyfo` и игнорировалась.
Это подтверждено чтением workflow по точному commit, а не предположением по Variable.

Исправления:

1. Защищённый **POST refresh** получает свечи и новую котировку. GET остаётся
   доступным для чтения; `GET refresh=1` отклоняется. Браузерный POST — same origin,
   автоматизация — через существующую защиту Vercel, без ключей в URL.
2. Котировка не участвует в закрытом PA. Кэш PA привязан к закрытым OHLC,
   данным валидации, стороне, окружению, выбранным ID и ревизии правил.
   Неизменившийся закрытый вход повторно не анализируется; его `as_of` сохраняется.
   Новая закрытая свеча или пересмотр OHLC инвалидирует кэш.
3. Не выполняется опасное склеивание истории. История загружается ограниченными
   окнами, force обходит кэш запросов; история не заменяется старым успехом при ошибке.
   Полный incremental merge произвольных исправлений поставщика не заявляется.
4. `/research` позволяет обновить и скачать три компактных JSON. Срок годности
   повторно оценивается на открытой странице, старое FRESH не остаётся навсегда.
5. Новый private workflow: почасовой резерв `7 * * * *`, ручной запуск и переменная
   источника вместо hardcode. Независимый от Actions операторский fallback:
   `scripts/refresh-research.ts` с существующими GCM/Vercel CLI авторизациями.
6. Новый `desk-report-v2`, `edge-knowledge-5`. Старые ответы отклоняются новым
   publisher, исторические V1-файлы не переименовываются в V2.
7. Четыре файла публикуются одним Git tree/commit без force. Все читаются обратно
   по одному SHA; проверяются размеры, SHA-256, символы, evidence, clocks и expiry.

[GitHub schedule не гарантирует запуск вовремя](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
[Vercel Hobby cron имеет дневное ограничение и часовую точность](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).
Поэтому бесплатный cron — резерв, а исследование свежего рынка использует on-demand.
Новые платные службы/секреты не добавлены.

## 2. Свежесть и реальные HTTP-проверки

Отдельны `provider_timestamp`, `quote_retrieved_at`, `generated_at`, `as_of`,
`last_closed_at` четырёх TF, `published_at`, `expires_at`, environment, side,
market status, data quality и stale reasons. `published_at` означает подготовку
коммита, а не время рынка; в readback дополнительно записано фактическое время Git commit.

Порог котировки 120 секунд при открытом рынке, допустимая задержка новой H4
600 секунд, доставки 120 секунд. Настройки допускают уменьшение этих порогов.
Это критерии классификации, **не обещание SLA**. Новый H4 проверен как 16:00 UTC;
не проводился непрерывный замер непосредственно вокруг границы следующего H4.

На проверенном Preview получены реальные JSON (`application/json`):

| Актив | Bid: HTTP / байты / статус | Ask: HTTP / байты / статус |
|---|---|---|
| EURUSD | 200 / 48 199 / STALE | 200 / 48 086 / STALE |
| NAS100 | 200 / 36 910 / PARTIAL | 200 / 36 887 / PARTIAL |
| JP225 | 200 / 37 510 / PARTIAL | 200 / 37 513 / PARTIAL |

EURUSD в этом проходе пришёл без проверяемого времени поставщика:
`QUOTE_PROVIDER_TIME_UNKNOWN`. Оно не было подставлено из retrieval/commit.
В последующей сквозной публикации EURUSD получил реальный timestamp и FRESH quote.
На всех шести ответах проверены контракт, лимит 65 536 байт, точный engine commit,
закрытые evidence windows, ID, lifecycle и отсутствие автоматического Confirmed.
`PARTIAL` характеризует доказательства; оно не означает просроченную котировку.
Компактный отчёт содержит выбранные evidence и честные total/omitted, не все находки.

`/api/chart?symbol=JP225&timeframe=H4`: HTTP 200, настоящий `image/png`,
109 944 байта, сигнатура PNG проверена. Активный desk для EU50: HTTP 400.
Подробная матрица, времена и SHA: [http-matrix.json](verification/capitalive-v5/http-matrix.json).

При шести последовательных принудительных загрузках воспроизведён
**HISTORY_RATE_LIMIT**. Его прежняя обработка скрывала код за общим 503.
Теперь это безопасный JSON ERROR / HTTP 429 / bounded `Retry-After`.
После ожидания NAS100 и JP225 восстановились; это зафиксировано в
[стресс-проверке](verification/capitalive-v5/http-stress.json).
Первый сохранённый общий 503 сам по себе не доказывал точный код причины;
вывод о лимите опирается на последующее воспроизведение с диагностикой.
Лимит запросов не увеличивался и ошибки не маскировались.

`markets_batch` — необязательный запрос метаданных котировки; отказ фиксируется
как optional failure. REST snapshot и stream проверяются отдельно. Наличие этого
сообщения не доказывает ни TRANSPORT_ERROR, ни отсутствие всех источников.
HTTP/schema/size/expiry/provider/publish разделены; сырые ответы и ключи не логируются.

## 3. Методологические изменения

Приоритет: актуальное указание пользователя → статья THE EDGE → карта → код.
Проверены обязательные статьи, связанные страницы TS, DR/инвалидации и схемы
Fractal, FVG, SNR, RB, TDA. Это инженерная сверка, не независимая экспертная разметка.

| Элемент | Решение V5 и основание |
|---|---|
| Fractal | Только строгие 3 закрытые последовательные свечи; подтверждение на закрытии третьей. [Источник](https://app.notion.com/p/419e05dadd18817692d6efb4d9a1db5d) |
| Fractal Raid / IDM | Касание отделено от строгого снятия; IDM внутри уже доступного POI X/X−1 — кандидат. «Близко» без порога не выдумывается. [Источник](https://app.notion.com/p/419e05dadd18817692d6efb4d9a1db5d) |
| FVG | Три свечи, границы и направление, fill/test отдельно от own-TF close invalidation; session/weekend gaps не FVG. [Источник](https://app.notion.com/p/419e05dadd18817abc57e446cd074bdc) |
| SNR | Собственное двухсвечное происхождение, KL delivery и закрытый break; не выводится из FVG. Геометрические допуски, не определённые автором, остаются ограничением. [Источник](https://app.notion.com/p/419e05dadd1881c6a539fe10cf3ea892) |
| RB | Двухсвечная последовательность с rejection у KL; одиночная свеча не RB. [Источник](https://app.notion.com/p/419e05dadd1881f68a6bd60a2e1d2cff) |
| DR / PD / IRL | Конкретные ID и исходный TF; автоматически показанная пара Fractal 3 — только `range_candidate`, не выбранный `dealing_range` и не доказательство значимости. [DR](https://app.notion.com/p/418e05dadd188105b1afc1a536f434e2) |
| SOF / Compression / LRL / Strong | Доступные наблюдения сохранены; качественные критерии и точные Strong-границы требуют NEEDS_SPECIFICATION / REVIEW_REQUIRED. [TS Basic](https://app.notion.com/p/8bde05dadd18832d9543812df955d9e3) |
| A/B/C / Execution | MN1/W1 → D1 → H4, контекст A, авторская eligibility B, путь/препятствия и C. X→X−1→X−2 сохранено по прямому указанию пользователя. Локальный entry stop не отменяет автоматически HTF Narrative. [TDA](https://app.notion.com/p/418e05dadd1881eb8321c5c4edb17a06), [Analysis](https://app.notion.com/p/7d9e05dadd188366a19301b7bd49fd06), [Execution](https://app.notion.com/p/a6ce05dadd1883deb64901c8937779e6) |

Удалены из активных вычислений:

- Generic BOS/CHOCH на пересечении pivot и HH/HL-count bias.
- ATR endpoint clustering под названием SNR, generic OB/Breaker и числовая priority heuristic.
- ATR-фильтр размера FVG и автоматическая значимость/главная цель в legacy catalog.
- Автоматическая противоположная роль снятого фрактала по generic break/retest.
- Generic protected-swing SL/TP, RR и перенос исторических obstacle bounds текущим spread.

Эти правила не переименованы в авторские. Старые маршруты сохранены, их
неподдерживаемые выводы пусты/null с NEEDS_SPECIFICATION; авторские данные —
`/api/intelligence` и desk. Текущий контракт отклоняет BOS/CHOCH/OB/Breaker evidence.
Candidate Narrative без привязанного human review остаётся Candidate.
iFVG не превращается в придуманный автоматический разворот роли.
Решения об ордерах, макроанализе и совокупном риске не автоматизированы.

Fractal 5 удалён из новых детекторов, legacy fractals, range/target/narrative
входов, Bridge, UI, активных правил, golden expectations и контрактов.
Каждый опубликованный Fractal имеет variant=3, три candle references и rule
`EDGE.FRACTAL_3.v1`; вариант 5 отвергается. Исторические документы/снимки и
семь старых наборов тестов сохранены как архивные записи, не исполняются как
методология V5. Снижение количества старых тестов не скрыто: вместо требований
к удалённым эвристикам добавлены проверки их отсутствия и авторских инвариантов.

## 4. NAS100: сравнение на тех же OHLC

Вход: 2026-11-16T07:17:59.382Z, SHA-256
`efd85cf036af96e2da8d816b8590088943cf0f2824a5008122dad8d9b2386ccc`.
Точный ID: `NAS100:D1:bid:FVG:2026-11-10T00:00:00.000Z:`.
Bullish FVG **27097.8–27419.3**, подтверждение **2026-11-11T00:00:00.000Z**.

| Проверка | До | После |
|---|---|---|
| Цены и входной OHLC | Исходный архив | Тот же архив, без изменений |
| Lifecycle | UNVERIFIED | ACTIVE |
| Coverage | UNVERIFIED | COMPLETE_OBSERVED_INTERVAL |
| Разрыв | 14 ноября 00:00 → 15 ноября 00:00 UTC | Тот же интервал зарегистрирован как scheduled closure |
| Fill | Не подтверждался из-за coverage | UNTOUCHED, fraction=0, без выдуманного теста |

Исключаются только **полностью доказанные закрытые интервалы**. Торговые часы,
частично открытый интервал, неизвестный праздник, потерянная свеча и неизвестный
исторический календарь JP225 не становятся «полным покрытием». PA-сегменты не
склеиваются, OHLC не синтезируется. Для календаря учтён опубликованный
[режим обслуживания индексов Capital.com](https://help.capital.com/hc/en-us/articles/27299104990482-Trading-hours-extended-on-key-indices).
[Replay всех трёх активов × Bid/Ask](verification/capitalive-v5/fixed-input-replay.json)
сохраняет хеши входов, counts, report SHA и данный контрольный случай.

## 5. Тесты и CI

[Source CI](https://github.com/Yilin1207/capitalive/actions/runs/43923117079): SUCCESS.
Проверено: **208/208 unit/integration**, lint/typecheck, build,
THE EDGE replay, V2 replay, V4 replay; **9/9 Playwright**, **23 HTTP-проверки**
реального локального Next build на записанном транспорте, два декодированных PNG,
две страницы snapshot с проверкой SHA. Это не подмена реальных проверок Preview.

[Private CI](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43922648089):
SUCCESS, **12/12** native Node 24 tests без npm-зависимостей.
Проверяются атомарность, приватность, secret canary, размеры, будущие данные,
candidate range, подмена файла, отсутствие clocks, false freshness, expiry,
несовместимая версия источника и ошибочные HTTP/content type.

Replay архивов: **12/12 случаев, 7 290 закрытых префиксов**, без look-ahead;
EU50 в этих старых архивах не возвращён в активный universe.
Дополнительно **6/6** фиксированных EURUSD/NAS100/JP225 × Bid/Ask.
Тестируются X−2 eligibility, отдельные entry/KL/narrative invalidations,
3-candle FVG/SNR/RB/IDM и закрытые сессии против реальных дыр истории.
Precision/Recall, доходность и полностью независимая экспертная валидация не заявляются.

## 6. Публикация, повторное чтение и восстановление

[Финальный workflow](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43923381707): SUCCESS.
Запрос 17:55:22.058Z, подготовка публикации 17:55:45.634Z,
Git commit 17:55:47Z, чтение всех файлов завершено 17:55:50.184Z.
Все значения ниже — 16 ноября 2026, UTC; environment **demo**, side **bid**.

| Актив | Provider time | H4 closed | Quote age при CI readback | Байты | Статус |
|---|---|---|---:|---:|---|
| EURUSD | 17:55:35.373 | 16:00:00 | 14.274 s | 48 193 | PARTIAL / quote FRESH |
| NAS100 | 17:55:36.662 | 16:00:00 | 13.294 s | 36 959 | PARTIAL / quote FRESH |
| JP225 | 17:55:38.597 | 16:00:00 | 11.587 s | 37 536 | PARTIAL / quote FRESH |

SHA-256 опубликованных файлов:

- EURUSD: `7b6f0ed0ef76c04cf12d5de9e1f39598cdf0b8cdf63aad44286b8dfb45fd7913`
- NAS100: `9e73fd823eeddf91d45c36a9f11f7ed478ad626a58e112f06665ab5636435f73`
- JP225: `8ee29f9ef192a69e2e89545a0fff37ebf3f8ceb2c46fb74f7902a462b25ad89d`

Повторное отдельное чтение в 17:56:48.615Z подтвердило те же SHA/размеры и
срок годности. [Manifest по immutable commit](https://github.com/Yilin1207/capitalive-research-bridge/blob/71a4ddd5335a5e3d851ceb87957e16a5dbce1b34/reports/latest/manifest.json).
После expiry эти же сохранённые файлы уже STALE; успех проверки не делает их
актуальными навсегда. Это также проверено на предыдущей публикации.

**Резерв без Actions реально выполнен:** операторский refresh опубликовал и
прочитал три PARTIAL JSON в `verification/v5-recovery`, commit
`c5600167f3e1930012f5870544acff82e60caca8`. Quote ages при readback 53–56 секунд,
все SHA/размеры совпали. [Доказательства](verification/capitalive-v5/operator-recovery.json).
Часы локального оператора примерно на 39 секунд впереди HTTP Date Vercel/GitHub;
поэтому метрики между сервисами выше рассчитаны по CI. Фактическое время Git
commit сохранено отдельно; локальное время не используется вместо provider time.

**Рабочая main действительно проверена:**
[ручной запуск](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43923157201)
SUCCESS обновил старые 08:36 отчёты до 17:54. Все три файла прочитаны по одному
commit, их SHA/размеры совпали. [Результат](verification/capitalive-v5/main-readback.json).
Старые слишком длинные expiry и четырёхчасовой cron остаются в main до слияния
V5; это ограничение не скрывается свежим ручным снимком.

## 7. Подключение ChatGPT и включение V5

[GitHub app ChatGPT читает файлы](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt-deep-resear),
но не вызывает `workflow_dispatch`/защищённый POST автоматически.
Без такого вызова нельзя обещать live-анализ обычным чтением GitHub.

Доступные пути:

1. Открыть [защищённый Research V5](https://capitalive-l2umiufiw-yilin1207s-projects.vercel.app/research),
   нажать обновление, скачать JSON и приложить их в ChatGPT.
2. Ручной workflow: до merge выбрать V5 branch и указать проверенный Preview;
   после успешного readback читать отчёты по указанному commit.
3. Операторский fallback без scheduler/Actions описан в README и проверен выше.

Читать manifest и три файла одного commit; сверять SHA, environment, side,
provider timestamp, H4 и expiry по текущему времени. При устаревании запрашивать
refresh, не интерпретировать сохранённое `fresh:true` как актуальность сейчас.
Read-only connector может иметь задержку индексации; pinned read/download JSON
остаётся явным способом передачи, успешное мгновенное переиндексирование не заявляется.

Для штатного включения подготовлены PR, но автоматического merge нет.
Согласованно слить цепочку исходного PR и private PR #5, установить
`BRIDGE_BASE_URL=https://capitalive-l2umiufiw-yilin1207s-projects.vercel.app`,
запустить private workflow на main и повторно прочитать manifest + три отчёта.
Source и publisher должны переходить на V2 вместе. Production заменять для
этого не требуется. До такого включения итог — **READY FOR MERGE**.

## 8. Оставшиеся ограничения

- Непрерывная двухминутная доставка через read-only GitHub/cron не гарантируется.
  Резервный оператор требует доступного компьютера с действующей авторизацией.
- Отдельные ответы Capital.com не содержат проверяемый timestamp; остаются STALE.
  Force-запросы истории ограничены бюджетом; интенсивная нагрузка получает 429.
- Исторические праздники и календарь JP225 не полностью подтверждены;
  соответствующие lifecycle остаются UNVERIFIED. Demo не приравнивается к Live.
- Качественная значимость и полные SOF/Strong/LRL критерии требуют спецификации
  и ручной оценки; нейтральный/неопределённый результат предпочтительнее выдуманного.
- Compact JSON — выборка связанных доказательств с omitted counts. Полный анализ
  доступен отдельно; snapshot mismatch возвращает 409, а не смешанные доказательства.
- Полные OHLC, персональные данные, API keys, GitHub/Vercel tokens не добавлены
  в публичные артефакты или опубликованные compact JSON. Raw проверки хранятся
  только локально в ignored `.vercel`. Автоторговля не добавлялась.
