# Bridge V5.1: изолированная совместимость

Рабочий PRIVATE Bridge main остаётся V5. `BRIDGE_BASE_URL` остаётся
`https://capitalive-iyzyi4yo2-yilin1207s-projects.vercel.app`.
Новый источник проверяется только через PR #7 и `verification/v5-1-context`.
Main и Production не изменяются этой поставкой.

| Поверхность | V5 | V5.1 Preview |
|---|---|---|
| JSON schema | desk-report-v2 | desk-report-v2 |
| X-Desk-Contract | desk-report-v2.0 | desk-report-v2.1 |
| Research context | отсутствует | strict context-5.1 |
| Intelligence schema | edge-knowledge-5 | edge-knowledge-5 + research_revision 5.1 |
| Полный wire | evidence-dictionary-1 | evidence-dictionary-2 |
| Размер compact JSON | ≤65536 UTF-8 байт с newline | тот же предел |

Обновлённый body validator принимает прежние v2 тела без context и строго
проверяет новый optional context. Transport header обновлён явно: старый main
publisher не должен молча принимать v2.1. Активация потребует согласованного
обновления publisher и источника с отдельным разрешением; текущая переменная
не переключалась. Companion PR изменяет contract, synthetic fixture, publisher
tests и branch-isolated workflow; не меняет секреты или торговые аккаунты.

Для полного Intelligence consumer обязан вызывать `decodeIntelligence` из
`lib/knowledge/wire.ts`: strings/objects/provenance/path IDs словарные, все
данные восстанавливаются без потерь. Декодер поддерживает v1 и v2. Обычный
JSON.parse не восстанавливает ссылки v2. Это обнаружено release HTTP check и
исправлено в `f1caf97`; runtime не изменялся. Компактный desk-report остаётся
обычным JSON и этого декодера не требует.

## Использование с ChatGPT

После будущей разрешённой активации подключённый GitHub должен иметь доступ
только к нужному PRIVATE Bridge. Читать manifest и три JSON по одному pinned
commit, проверять SHA-256, bytes, symbol/side, environment, source commit,
provider_timestamp, as_of и expires_at. Снимок после expires_at не является
текущим. Для нового анализа использовать существующий защищённый refresh flow;
cron остаётся best effort, не гарантией доставки.

До активации для проверки использовать приватную ветку `verification/v5-1-context`,
не называть её рабочим main. ChatGPT анализирует компактные отчёты; full OHLC
не публикуется. Для спорного KL открыть авторизованный inspector по as_of и
evidence SHA из отчёта, например:

```text
/api/intelligence?symbol=NAS100&side=bid&mode=inspection&as_of=<report.as_of>&evidence_sha256=<report.source.evidence_sha256>&inspection_tf=D1&offset=0&limit=10
```

Инспектор требует SSO/существующую серверную авторизацию, не URL-секрет.
`publication_allowed=false`; данные окна нельзя автоматически переносить в
Bridge. При 409 получить новый отчёт и не смешивать старые и новые evidence.
Неполный/устаревший отчёт не превращать в свежий успешный. Ошибки HTTP/schema/
size/expiry/provider/publish и secret checks остаются fail-closed.

## Проверка публикации

Финальный [GitHub Actions run 43939087277](https://github.com/Yilin1207/capitalive-research-bridge/actions/runs/43939087277)
завершился success. Выполнена атомарная публикация в `verification/v5-1-context`,
commit `adcb4505fb9e700343f242630bb525aa87855f94`, published_at `2026-11-16T19:25:59.587Z`.
Publisher: `c77898266c67ee25ddb7012f94bd2c1bb22d460c`; runtime: `0d55355ff5ef3e3b5e003b8318dc62e8d439ff8d`.

| JSON | Байты с newline | SHA-256 | При повторном чтении |
|---|---:|---|---|
| EURUSD | 59095 | `20c4d53a176fd1dfe9eb109c4e08a9620b6755137e50a91f0ebb318c3934b32c` | STALE; expired=false; quote fresh=false |
| NAS100 | 56326 | `145f6dbec7576c9b7f153cf3114d89fa52160a3311c7fae88a082b8038b980b8` | PARTIAL; expired=false; quote fresh=true |
| JP225 | 60131 | `855c628a1241c1cfd671917bc2d3c6b89b3f0172e23453030ac91cc296415e08` | PARTIAL; expired=false; quote fresh=true |

Все файлы прочитаны по одному commit; git blob SHA-1, manifest SHA-256 и bytes
совпали. Строгий контракт, context-5.1, source commit и причинность evidence
проверены повторно. Возраст provider quote NAS100/JP225 по серверному Date с
верхней границей: 32.257 / 30.185 секунды. EURUSD provider timestamp отсутствует:
статус STALE сохранён, свежесть не придумана. PARTIAL остальных относится к
покрытию истории, а не к возрасту котировки.

Предыдущий run 43937230773 оставался queued без job; попытка отмены вернула 409.
До нового запуска отдельно проверен идентичный native publisher локально,
commit ff2aea2d3e9e72215a2e98c0172ba7f78a6b3058 с прежним runtime 1ee93b5.
Это дополнительное историческое доказательство, не финальный запуск. Рабочие
main и BRIDGE_BASE_URL не затрагивались ни одним из этих запусков.

[publication-readback.json](verification/capitalive-v5-1/publication-readback.json)
и [actions-publication.json](verification/capitalive-v5-1/actions-publication.json)
содержат безопасные метаданные. Полные приватные отчёты, OHLC, авторские
иллюстрации, токены и bypass не включены в source. После expires_at эти JSON —
историческое доказательство доставки, а не обещание текущей свежести.
