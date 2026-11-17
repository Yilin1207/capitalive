# Публичная активация DR/RB — 17 ноября 2026

Пользователь явно разрешил перенос изменений на основной публичный сайт.
Это заменяет прежнее ограничение «Preview до отдельного разрешения».

## Результат

- Основной сайт: https://capitalive.vercel.app/research
- Production runtime: `2e7a44289b50ea08abddbdf4315f917f4bc52d36`.
- Deployment: `dpl_8fvj6hHuoe35wynBXTmLHXGzPgmT`, READY, target=production.
- Выполнена новая Production-сборка из проверенного Git deployment, с Production
  environment; локальные приватные файлы и секреты не загружались.
- PR #9 слит только в `feature/the-edge-knowledge`, merge `3dc49521297d4a4a77e01f50f0f43dc1191c5690`.
  Основной PR #2 остаётся открытым. Переключение Vercel не требует его слияния.
- Приватный Bridge PR #7 слит в main, merge `c7cc3fe9ac2b19a64807c492f8e1f77ed1ffbd79`.
- BRIDGE_BASE_URL указывает на эту же Production-сборку:
  `https://capitalive-j773uyp35-yilin1207s-projects.vercel.app`.
- SSO=null, пароль отсутствует. Ключи провайдера, GitHub и ingestion остаются
  серверными; приватный репозиторий не открывался.

## Проверки

[CI проверенного коммита](https://github.com/Yilin1207/capitalive/actions/runs/44072552430)
успешен. Технические проверки RB: 243 unit, 10 browser, replay 7290 закрытых
префиксов, шесть фиксированных активных входов. Подробности — [RB audit](RB_V2_AUDIT_RU.md).

[Production HTTP](verification/rb-production/http.json): все шесть
EURUSD/NAS100/JP225 × Bid/Ask вернули 200 application/json без токенов/cookies.
Подтверждены source commit, desk-report-v2.3, DR revision, RB quality и отсутствие
автоматически подтверждённого Narrative. Все JSON меньше 65536 байт.
Три полных Intelligence проверены по арифметике первой свечи и времени второй.
H4 chart: 200 image/png, правильная PNG-сигнатура.

[Проверка свежести](verification/rb-production/freshness.json) дополнительно
проверяет основной HTML, старый market-audit JSON и новые GET desk-report:
provider timestamp продвигается, котировки FRESH, последняя закрытая H4 —
12:00 UTC (17:00 Asia/Qyzylorda). Это именно закрытая свеча, не текущая незакрытая.
Ошибки и превышение лимитов не скрываются: при серии проверок получены 429,
повторы соблюдают Retry-After. Лимиты провайдера не отключались.

## Рабочая публикация и повторное чтение

Первый запуск после слияния, [44091927181](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/44091927181),
завершился CONFIGURATION_ERROR: publisher разрешает только immutable адреса
проекта, а не стабильный alias. Исправлена именно переменная BRIDGE_BASE_URL;
проверка допустимых адресов не ослаблялась. Это был отказ до получения отчётов,
не ошибка Capital.com и не успешная публикация.

Повторный ручной [запуск 44092086415](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/44092086415)
успешен: 13 publisher tests, получение, атомарная запись и readback.
Commit публикации в private main: `019bba09dc33fd16243c6c55773d25628b517787`.
Manifest и три отчёта дополнительно прочитаны из GitHub именно по этому commit.
Проверены размеры, SHA-256, git blob, revision и причинность evidence.

| Актив | Размер | Статус | Возраст котировки при дополнительном чтении |
|---|---:|---|---:|
| EURUSD | 59431 | PARTIAL / FRESH quote | ≤32.016 с |
| NAS100 | 60806 | PARTIAL / FRESH quote | ≤31.660 с |
| JP225 | 64735 | PARTIAL / FRESH quote | ≤30.706 с |

Все файлы были прочитаны до expires_at. PARTIAL отражает ограничения
истории/компактного вывода, а не подменяет сбой. Полные hashes и timestamps:
[readback](verification/rb-production/publication-readback.json),
[Actions](verification/rb-production/actions-publication.json).

## Как получать актуальные данные

Для ChatGPT предпочтительны прямые публичные GET:

- https://capitalive.vercel.app/api/desk-report?symbol=EURUSD&side=bid
- https://capitalive.vercel.app/api/desk-report?symbol=NAS100&side=bid
- https://capitalive.vercel.app/api/desk-report?symbol=JP225&side=bid

HTTP no-store; quote cache 5 секунд, candle cache 30 секунд. Отчёт заново
проверяет свежесть на каждом обращении. Лимит возраста котировки — 120 секунд,
допустимое запаздывание закрытия H4 — 600 секунд. Отсутствующий/старый timestamp
не заменяется временем получения. Проверять expires_at и статус нужно при чтении.
Если провайдер недоступен, возможны STALE/ERROR/429; безусловная свежесть не обещается.

GitHub snapshots не являются непрерывным real-time каналом: почасовой scheduler
best effort, отчёты истекают раньше следующего планового запуска. Для актуального
анализа используется GET сайта или явное обновление, а не старый GitHub файл.

## Доступ ChatGPT и ограничения

Прямые HTTP-проверки без авторизации успешны; на основном домене нет login
redirect и noindex. Однако оба доступных веб-инструмента ChatGPT при открытии
домена вернули Internal Error. Причина на стороне маршрута извлечения не
установлена; успешный curl/fetch не выдаётся за доказательство доступа из
OpenAI. Индексация поиском и универсальная доступность во всех сессиях ChatGPT
не подтверждены. Запасной путь — открыть публичный /research и передать JSON.

Вердикт: **Production и рабочий Bridge активированы и проверены**.
Доступ именно через веб-поиск ChatGPT — **не подтверждён**.
Независимая экспертная оценка торговой эффективности не заявляется.
