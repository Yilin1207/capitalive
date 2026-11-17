# Level lifecycle: formation, fill, role

Реализация: `lib/knowledge/research-context.ts`, `lib/research-bridge/report.ts`.
Исходный `LevelState` V5 сохраняется; новый слой объясняет его без переопределения
авторского детектора. Полный контекст содержит origin/confirmed_at/ID, first
observed interaction и область достоверности, fill, own-TF invalidation,
liquidity_consumed, original geometry и verified/unverified current role.

| Случай | Разрешённый вывод | Запрещённый вывод |
|---|---|---|
| FVG FILLED, собственный close не нарушил дальнюю границу | Полное геометрическое заполнение при прежнем lifecycle | Автоматическая INVALIDATED или доказанная поддержка |
| Пробой на младшем TF | Role transition требует review | Автоматическая смена support/resistance |
| Fractal touched без строгого пересечения | Тест уровня по существующему правилу | Consumed только из-за касания |
| Liquidity consumed | Ликвидность снята; зона может требовать дальнейшего исследования | Новая неснятая ликвидность, обязательное исключение зоны из всех препятствий |
| Incomplete history | Первое наблюдаемое взаимодействие в доступном окне | Первое взаимодействие за всю историю |
| Геометрия/связи найдены | DETECTED / ELIGIBLE_FOR_REVIEW | HUMAN_VALIDATED без атрибутивной ручной проверки |

Текущая роль публикуется только при допустимом `RETEST_CONFIRMED`, нетерминальном
состоянии и достаточном наблюдаемом покрытии; иначе null/UNVERIFIED. Никакой новый
автоматический retest detector этим изменением не введён. Уровень сохраняет
initial_role для объяснения происхождения. Consumer не должен читать initial_role
как current_role. Контракт проверяет причинность времени и соответствие роли.

NAS100 MN1 27530.4–28184.7: ACTIVE/FILLED сохранены, current_role support заменён
в исследовательском представлении на null, причины объясняют различие.
D1 27097.8–27419.3: ACTIVE/UNTOUCHED, нет собственного TF break и H4-пересечения
в фиксированном архиве. [Результаты](verification/capitalive-v5-1/replay.json).

Регрессии проверяют full fill, own-TF invalidation, младший breach, consumed zone,
causal references, gaps и отсутствие автоматического human validation. Полный
набор V5 detector/states на шести архивных входах не изменился.
