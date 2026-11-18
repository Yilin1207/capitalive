import { searchKnowledge } from "@/lib/knowledge/rules";
import "../market-feed.css";
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams,
    { documents, rules, coverage } = searchKnowledge(q.slice(0, 200));
  return (
    <main style={{ overflowWrap: "anywhere" }}>
      <div className="eyebrow">CAPITALIVE · THE EDGE</div>
      <h1>Knowledge Base</h1>
      <p>
        Оригинальные спецификации и ссылки на приватные первоисточники.
        Прочитанный материал, работающий детектор и доказанная торговая
        эффективность — разные статусы.
      </p>
      <nav className="api-links">
        <a href="/">Графики</a>
        <a href="/intelligence">Анализ по правилам</a>
        <a href="/api/knowledge">JSON и покрытие</a>
      </nav>
      <p>
        Импортировано {coverage.imported}/{coverage.expected}; правил{" "}
        {coverage.rules}; формализовано {coverage.formalized}; протестировано{" "}
        {coverage.tested}; VALIDATED: {coverage.validated}.
      </p>
      <p>
        Изображения проверены: {coverage.images_reviewed}/
        {coverage.images_total}. Walk-forward / OOS: {coverage.out_of_sample}.
        Неопределённые правила не превращаются в сигналы.
      </p>
      <form>
        <label>
          Поиск по материалам и правилам{" "}
          <input name="q" defaultValue={q} maxLength={200} />
        </label>
        <button type="submit">Найти</button>
      </form>
      <h2>Правила</h2>
      {rules.map((r) => (
        <details key={r.id}>
          <summary>
            {r.id} · {r.concept} · {r.status} · {r.specification}
          </summary>
          <p>{r.definition}</p>
          <p>Формирование: {r.formation.join(" ")}</p>
          <p>Подтверждение: {r.confirmation.join(" ")}</p>
          <p>Отмена: {r.invalidation.join(" ")}</p>
          <p>Неопределённости: {r.unresolved.join(" ")}</p>
          <p>
            Проверка: {r.validation.unit ?? "Не выполнена"}; OOS:{" "}
            {r.validation.out_of_sample}
          </p>
          <p>
            TF: {r.timeframes.join(", ")}; {r.htf_dependencies.join("; ")}
          </p>
          <p>
            POI: {r.poi}; VC: {r.vc}; Trigger: {r.trigger}; Target: {r.target}
          </p>
          <p>Пример: {r.examples.join(" ")}</p>
          <p>Контрпример: {r.counterexamples.join(" ")}</p>
          {r.source_ids.map((id) => (
            <p key={id}>
              <a
                href={`https://app.notion.com/p/${id}`}
                target="_blank"
                rel="noreferrer"
              >
                Источник {id}
              </a>
            </p>
          ))}
        </details>
      ))}
      <h2>Каталог материалов</h2>
      {documents.map((d) => (
        <details key={d.id}>
          <summary>
            {d.category} / {d.title}
          </summary>
          <p>{d.summary}</p>
          <p>
            Ревизия: {d.revision}; текст: {d.text_review}. Иллюстраций:{" "}
            {d.image_count}, просмотрено: {d.images_reviewed}.
          </p>
          <a href={d.url} target="_blank" rel="noreferrer">
            Открыть первоисточник в Notion
          </a>
          <p>
            Связи:{" "}
            {d.related_ids.map((id) => (
              <a key={id} href={`https://app.notion.com/p/${id}`}>
                {id}{" "}
              </a>
            ))}
          </p>
        </details>
      ))}
    </main>
  );
}
