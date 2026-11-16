# Capitalive V4 — Price Action Accuracy & Structural Validation

Дата: 16 ноября 2026. Итог: **PARTIAL**. Это проверка детерминированности, причинности и доказательств, а не измерение торговой точности.

Ветка `research/v4-pa-validation-20261116`, база `b26cdbc5d73a575a147bcf4379951e673b09f31e`, целевая ветка PR — `feature/the-edge-knowledge`. Автоматическое слияние запрещено. Production, основной PR #2, SSO и текущая публикация приватного Bridge не переключаются.

## Реально воспроизведённые ошибки

| Дефект | Первопричина | Исправление и проверка |
|---|---|---|
| После более позднего закрытого пробоя сохранялась ранее подтверждённая противоположная роль фрактала | Выбирался последний retest, но не проверялось последующее разрушение его предпосылки на X/X−1 | Новый пробой отзывает текущую роль; доказательства старого retest и нового пробоя сохраняются; unit и differential |
| INVALIDATED FVG сохранял support/resistance и мог получить позднюю реакцию | Инвалидация меняла только state | current_role=null, initial_role отдельно; реакция после инвалидации исключается; подтверждено историческим NAS100 H4 |
| CONSUMED/UNVERIFIED уровень выглядел как имеющий текущую исходную роль | Возврат к роли геометрии при отсутствии действующего retest | Недоказанная current_role=null; геометрия и initial_role остаются; исторический EU50 и adversarial tests |
| SNR получал подтверждение через KL delivery, случившийся после первого пробоя исходного уровня | Поиск пробоя начинался после delivery, игнорируя более ранний пробой | Сначала находится первый закрытый пробой origin, затем проверяется порядок origin → KL → break; unit и проверка каждого удалённого SNR в replay |
| Разрыв последовательности break/retest мог склеиваться при наличии покрытия родительскими свечами | Покрытие интервала ошибочно использовалось как доказательство непрерывной последовательности младшего TF | Сброс pending/confirmed через segment barrier; UNVERIFIED до нового доказательства |
| Bridge мог сообщать COMPLETE только потому, что список препятствий не обрезан | Полнота списка подменяла полноту проверенной истории и вселенной уровней | Явная path_completeness; UNKNOWN/PARTIAL не дают TARGET_VALIDATED; UNASSESSED — прежнее wire-имя UNKNOWN |
| Конфликтующие дубли OHLC зависели от порядка строк | Последняя строка побеждала | Весь конфликтующий timestamp изолируется; одинаковые дубли дедуплицируются; validation barrier сохраняется и в MN1 |

Дополнительно закрыта причинностная граница IRL: новые внутренние фракталы после инвалидации выбранного DR больше не принадлежат этому диапазону. Положительные/отрицательные проверки отделяют касание, строгое снятие ликвидности, заполнение FVG и закрытую инвалидацию.

Первый целевой прогон воспроизвёл четыре падения из пяти тестов. Проверка IRL затем усилена невакуумным примером. Все добавленные проверки теперь обязательны; прежние проверки не отключались. Тесты, предполагающие заведомо полный синтетический universe, передают это явно, вместо неявного COMPLETE.

## Каноническая база и границы формализации

Через авторизованный Notion прочитаны актуальные определения и сверены редакции 16 страниц: карта правил, материалы, ТС, Fractal, FVG, SNR, RB, TDA, Narrative, Entry, DR/H4 DR, Raid, IRL, Compression. Реестр: [source-revisions.json](verification/pa-v4/source-revisions.json). Использованы текущие текстовые определения и ранее проверенная неизменившаяся редакция; **новый визуальный разбор всех схем не выполнялся**, все 85 статей повторно не читались.

Основные источники: [карта правил](https://app.notion.com/p/419e05dadd188118ba32fc9f0f146cc4), [материалы](https://app.notion.com/p/418e05dadd188134b279fb543a6ed8fe), [ТС](https://app.notion.com/p/02de05dadd188371823c01c1f58aacc1).

Сохраняются существенные ограничения спецификации:

- Fractal 3 — строгий трёхсвечный экстремум; Fractal 5 — отдельная геометрия. Подтверждение только после правой закрытой свечи/свечей.
- FVG — трёхсвечная геометрия с body-through; ни каждый gap, ни FVG внутри консолидации автоматически не являются сильным VC. Gap через разрыв сессии не склеивается с PA.
- SNR требует независимых origin, KL delivery, первого closed break. Не создаётся из любого FVG. В тексте поддержки есть неоднозначность направления пробоя; сохранено ранее документированное прочтение схем, а не выдумано новое правило.
- RB — две противоположные свечи и KL-context. Одиночный фитиль — не RB. Исполнительная значимость и границы при несовпадающих телах остаются кандидатными.
- BOS/CHOCH и swing flow — явно обозначенные проектные наблюдения, не полная авторская SOF.
- Compression/LRL, Displacement, «near POI» и значимость импульса для DR не имеют достаточных численных критериев. NEEDS_SPECIFICATION сохранён.
- X→X−1→X−2 сохранено, включая D1 для MN1. Это пользовательское техническое расширение: нельзя приписывать авторскому Step 2 TDA, где цели описаны X/X−1, дословное правило X−2.

## Детекторы, структура и lifecycle

Геометрия существующих Fractal/FVG/RB/Raid/BOS/CHOCH не переписана. Изменены последовательность SNR, временная граница IRL, lifecycle и покрытие. Связанные Strong candidates пересчитываются только при отзыве ошибочного SNR; alternate VC обязан иметь собственные доказательства. Формальная геометрия не превращает кандидат в подтверждённую торговую модель.

Каждый уровень сохраняет ID, origin, confirmed_at, TF, границы, initial_role, current_role, evaluated_through, coverage, invalidated_at и proof events. TESTED представлен orthogonal-полями last_test/test_episodes, а не новым несовместимым значением enum. Тесты разных TF могут перекрываться и не считаются независимыми реакциями.

FVG.fill показывает UNKNOWN/UNTOUCHED/TOUCHED/PARTIAL/FILLED, наблюдавшуюся долю и времена тестов. FILLED по фитилю не означает INVALIDATED; последний требует закрытия собственного TF за дальней границей. При неполном покрытии «не трогали» не утверждается.

DR: полная Intelligence выдаёт все допустимые пары подтверждённых Fractal 3 текущего сегмента, основания, EQ, REVIEW_REQUIRED, selected=null и automatic_selection=false. Значимость пары не выбирается по удобству RR. Явный выбор `high_id/low_id` и соответствующие параметры MN1/W1/D1 сохраняются. Bridge показывает один прежний компактный кандидат плюс total/omitted; это **не выбранный dealing_range**. При выбранном DR его доказательства сохраняются.

MN1/W1/D1/H4 показывают структуру, swing bias и технические конфликты. Финальные Macro, Narrative и ENTER/WAIT/NO TRADE больше не являются автоматическим решением движка: action=NOT_EVALUATED, macro_edge=NOT_EVALUATED. Старое human-review API остаётся явной пользовательской аннотацией с evidence hash; Candidate не повышается автоматически.

## OHLC и провайдер

Цепочка проверена на ранее сохранённых архивах, контрольном наборе и новом реальном захвате 16 ноября через защищённый Preview. Новый захват — **demo Capital.com**, эквивалентность live/spot не установлена. Все три `/api/market-audit?...&include_candles=1&view=priority` вернули HTTP 200 JSON. Полные новые снимки находятся только в игнорируемом `.vercel/v4/private`.

Bid/Ask, положительные конечные OHLC, high/low, timestamps, закрытие свечей, identity symbol/environment/TF/provider проверяются до PA. Смешанный набор отклоняется, а не анализируется. Время получения не подставляется вместо provider_timestamp. H4→D1 recovery остаётся строгим: нужны все шесть закрытых H4, согласование предыдущего D1 и независимых полей.

В свежих данных реально есть crossed-side потери поставщика, в том числе в исходных дневных рядах для MN1. Они не «исправляются» выдуманной ценой. PARTIAL_AGGREGATION/PROVIDER_VALIDATION_LOSS сохраняются, затронутый месяц не становится полным. GAP_BOUNDARY_NO_PATTERN_STITCHING — действующий причинностный барьер, а не косметическое предупреждение. Без проверенного календаря сессий нельзя доказать полноту месячной агрегации или отличить каждую штатную паузу от утраты данных.

## Исторические контрольные случаи 15–16 ноября

Из приватного GitHub прочитаны три закреплённых manifest и все девять JSON, проверены точные bytes и SHA-256. Коммиты: `72a074e6a5878aaf21164da52986e55aa700cd1c`, `4e63d4f5e690a21a9ac9b61d2a2695738153fc4f`, `bfe798e6f56b972ac174e4645550190144f53886`. Эти публикации — старая рабочая версия, не V4.

| Контроль | Наблюдение и предел доказательства |
|---|---|
| EURUSD MN1 FVG 1.09544–1.10653 | Формирование 2025-06-01 00:00 UTC; bullish support ACTIVE в проверенных срезах. Bearish MN1/W1 структура сохраняется как конфликт с KL, не отменяет геометрию FVG |
| EURUSD W1 low 1.10653 | Подтверждён 2025-05-26 00:00 UTC; resistance имеет отдельные break/retest proofs, не выводится из текущей котировки |
| EURUSD D1 FVG 1.10726–1.10817 | Подтверждён 2026-11-14 00:00 UTC; ACTIVE в отчётах 15-го, UNVERIFIED при недостаточном позднем покрытии 16-го; V4 не утверждает действующую роль при UNVERIFIED |
| NAS100 MN1 FVG 27530.4–28184.7 | Подтверждён 2026-07-01 00:00 UTC; ACTIVE support; MN1 bullish и W1 bearish показываются отдельно |
| NAS100 W1 около 28487.5 | В реальном отчёте это **SNR candidate 28487.5–28488.7**, не подтверждённый Fractal resistance. Найдены также двухсвечные RB candidates с тем же junction. Нельзя повышать их до подтверждённого KL |
| NAS100 H4 FVG 27962–28151.1 | Подтверждён 2026-11-13 20:00 UTC; ACTIVE 15-го, INVALIDATED по own-TF закрытию 2026-11-16 00:00 UTC. В старом JSON оставалась resistance; V4 current_role=null |
| NAS100 W1 low 26255.2 | Подтверждение только 2026-11-16 00:00 UTC; отсутствует до закрытия правой недельной свечи, появляется 16-го |
| EU50 W1 6405.4 | Resistance с retest в срезах 15-го; 16-го CONSUMED. Старая current_role=support не является новым подтверждением support; V4 отзывает недоказанную роль |
| EU50 D1 high 6430.5 | Подтверждён 2026-11-14 00:00 UTC; ACTIVE→UNVERIFIED на позднем неполном покрытии |
| EU50 D1 FVG 6346.5–6351.4 | Подтверждён 2026-11-12 00:00 UTC; ACTIVE→UNVERIFIED, а не выдуманная инвалидация |
| EU50 MN1/W1 | 15-го MN1 bullish/W1 bearish. 16-го W1 break bias уже Bullish, swing bias ещё Bearish; нельзя утверждать, что оба поля всегда bearish |

Проверка `scripts/audit-pa-v4-history.ts` сравнивает formation SHA. Часть совпадает сразу; остальные воспроизводятся **точным SHA после единственного равномерного сдвига index**, без изменения OHLC/time. Это изменение индекса при сдвиге rolling window, а не найденная правка цены. Полного исходного OHLC каждого исторического запуска нет: равенство formation не доказывает равенство всей lifecycle-истории. Новый захват нельзя называть исходным golden snapshot. Отсутствие нового W1 low до его подтверждения — ожидаемый результат.

## Проверки и воспроизводимость

- `npm test`: 267 PASS, 0 failed/skipped на локальном финальном коде; включает прежние тесты, причинность, загрязнённые OHLC, неправильный side/identity, пересечение сессий, ложные подтверждения и HTTP detail.
- `node --test tests/research-bridge-publisher.test.ts`: 8 PASS под нативным Node 24, без tsx. Проверены atomic manifest/3 reports, секреты-canary, отказы HTTP/schema/size/expiry/provider/publish, новый контракт и отсутствие повышения Narrative.
- 22 новых declarative golden cases в `tests/fixtures/pa-v4/golden.json`: позитивные, негативные и boundary примеры, ожидаемые значения записаны вручную до вызова детектора; каждый закрытый префикс проверяется отдельно. Это **не независимая экспертная разметка**: external expert_review=PENDING. Старые тесты дополнительно покрывают DR/IRL, Strong, session gaps, opens и lifecycle.
- `npm run knowledge:replay:v4`: архив 12 ноября, контроль 15 ноября, новый private capture 16 ноября × EURUSD/NAS100/EU50 × Bid/Ask = 18 запусков. На каждом закрытом префиксе сравниваются устойчивые события Fractal 3/5, FVG, inversion, Raid, RB, SNR, IDM, Strong, BOS/CHOCH с результатом полного ряда, отфильтрованным по времени. Stateful lifecycle проверяется отдельными fixtures и differential; это не доказательство всех возможных рыночных последовательностей.
- Differential использует идентичный input SHA и базовый движок b26cdbc (его код совпадает с ccf2c29; различие между коммитами документальное). Удалённый SNR допустим только при доказанном первом break до delivery; Strong — только при удалённом SNR dependency/relinked VC. Изменения ролей классифицируются по новой проверке break, sequence gap, FVG terminal state либо отзыву недоказанной роли при неизменном state. Неизвестное изменение останавливает replay.
- `npm run lint`, `npm run build` пройдены. Remote CI дополнительно должен выполнить старые replay, UI Chromium и RC HTTP. Итоговые ссылки и результаты приведены ниже после завершения CI.

Воспроизведение общедоступной части: `npm ci`, `npm test`, `npm run knowledge:replay:v4`, `npm run lint`, `npm run build`. Без `PA_V4_INPUT_DIR` выполняются 12 архивных комбинаций; без baseline явно записывается BASELINE_NOT_SUPPLIED, а не фиктивный успешный differential.

Для differential создайте отдельный checkout pinned base, установите его зависимости, запускайте `scripts/capture-pa-v4-baseline.ts` из cwd **старого checkout** с его tsx loader, `PA_V4_EXPECTED_BASELINE_COMMIT` и абсолютным игнорируемым `PA_V4_BASELINE_DIR`. Затем укажите этот каталог V4 replay. `PA_V4_INPUT_DIR` опционально добавляет приватные `input-EURUSD.json`, `input-NAS100.json`, `input-EU50.json`. Не коммитьте выходные full engine/OHLC. Публичный `verification/pa-v4/replay-summary.json` содержит только счётчики, hashes и результаты.

## Research Bridge и совместимость

schema_version остаётся `desk-report-v1`; portable contract/header/manifest revision становится **desk-report-v1.2**. Изменение обосновано новыми allowlisted-полями initial_role/fill/range_options/details/technical_only/budget_tier и action=NOT_EVALUATED. Новый валидатор принимает старые v1.1 payload-поля; старый строгий publisher **не примет** новые поля. Поэтому приватный companion PR обязателен до переключения источника. Автоматического изменения live workflow/BRIDGE_BASE_URL нет.

Лимит 65 536 байт включает завершающий LF. При превышении последовательно уменьшается только recent display RB/SNR, затем Fractal 5, затем Raid. Counts/omitted сохраняются; mandatory выбранные уровни и их dependencies не удаляются. Если они сами не помещаются — REPORT_TOO_LARGE, не успешный неполный ответ. Полная Intelligence ограничена 4 250 000 байт.

Подробности: `/api/intelligence?symbol=EURUSD&side=bid&as_of=<report.as_of>&level_id=<evidence.id>&evidence_sha256=<source.evidence_sha256>`. URL-encode параметры. HTTP 409 SNAPSHOT_CHANGED требует заново получить отчёт; API не архивирует старые снимки и не обещает их вечную реконструкцию. Без level_id можно получить все найденные уровни и range candidates, с ним — formation/state и все наблюдённые закрытые interactions. Детали содержат OHLC доказательства только за SSO, в GitHub Bridge не экспортируются.

Для выбранных диапазонов/anchor/target нужно повторить те же параметры запроса, поскольку они входят в snapshot hash. `generated_at` — сборка отчёта, `as_of` — граница анализа, provider_timestamp — время поставщика, retrieved_at — получение; значения не взаимозаменяемы. STALE/UNVERIFIED/ERROR остаются честными статусами. SHA в manifest считается по точным опубликованным bytes.

## Статус модулей

| Модуль | Статус | Что остаётся |
|---|---|---|
| Fractal 3/5 | PARTIAL | Геометрия, timestamps, prefixes и реальные formation подтверждены; независимое экспертное утверждение golden-пакета отсутствует |
| FVG / fill / invalidation | PARTIAL | Геометрия и собственное закрытие проверены; реакционная значимость/консолидация и полнота истории не доказаны |
| SNR | PARTIAL | Причинность исправлена; авторская неоднозначность и исполнительная граница требуют ревью |
| RB | PARTIAL | Две свечи и KL-context проверены; junction/значимость остаются candidate |
| Raid / lifecycle | PARTIAL | Строгий crossing и отзыв недоказанной роли проверены; неполные сессии не позволяют глобально доказать первый тест |
| BOS/CHOCH / swing flow | PARTIAL | Детерминированная проектная конвенция, не полная формализация SOF |
| IDM inside / IRL / DR | PARTIAL | Геометрия и causal boundary проверены; near/significance и выбор макродиапазона требуют человека |
| Strong | PARTIAL | Связи pivot/raid/VC проверены, исполнительное подтверждение не автоматическое |
| Compression/LRL / Displacement | BLOCKED | Нет утверждённых исполняемых порогов; только measurements/NEEDS_SPECIFICATION |
| Session gaps / MN1 completeness | PARTIAL | Barriers и потери видимы; календарь и полнота источника не подтверждены |
| Targets X/X−1/X−2 / obstacles | PARTIAL | Eligibility и counts проверены; universe PARTIAL/UNKNOWN, полного пути не утверждаем |
| Bridge V4 rollout | PARTIAL | Контракт и локальная публикация проверены; PR review/merge и согласованное переключение намеренно ожидают пользователя |

## Файлы изменений

`lib/candle-data.ts`; `lib/knowledge/{detectors,level-state,target-selection,intelligence,http,interaction-history,range-candidates}.ts`; `lib/research-bridge/{contract,report}.ts`; `app/intelligence/page.tsx`; `scripts/{verify-edge-v2,verify-pa-v4,audit-pa-v4-history,capture-pa-v4-baseline}.ts`; `tests/{knowledge-v4,pa-v4-golden,knowledge-pipeline,knowledge-v2,knowledge-v3,candle-data,history-diagnostics,research-bridge,research-bridge-publisher}.test.ts`; `tests/fixtures/pa-v4/golden.json`; `tests/browser/knowledge.spec.ts`; `package.json`; `.github/workflows/release-checks.yml`; этот отчёт и безопасные metadata в `verification/pa-v4`.

## Ответ Trading Research Desk

**Нет, использовать Capitalive без систематической проверки каждого значимого PA-элемента пока нельзя.** Можно использовать его как воспроизводимый технический источник с Evidence ID и явно ограниченной уверенностью. Препятствия: независимая разметка не получена; RB/SNR/DR/SOF и качественные PA-концепции формализованы не полностью; покрытие сессий/потери provider оставляют UNVERIFIED; точные исторические lifecycle inputs не восстановлены. Вероятности точности, Precision/Recall и полная независимая валидация не заявляются. Итоговое торговое решение остаётся у внешнего Trading Research Desk.
