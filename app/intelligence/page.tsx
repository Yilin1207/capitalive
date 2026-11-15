"use client";
import { useState } from "react";
import type { buildIntelligence } from "@/lib/knowledge/intelligence";
import "../market-feed.css";
type Audit = ReturnType<typeof buildIntelligence>;
export default function IntelligencePage() {
  const [symbol, setSymbol] = useState("EURUSD"),
    [side, setSide] = useState("bid"),
    [audit, setAudit] = useState<Audit | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [high, setHigh] = useState(""),
    [low, setLow] = useState("");
  const pivots =
    audit?.frames
      .find((f) => f.timeframe === "H4")
      ?.findings.filter((f) => f.kind === "FRACTAL") ?? [];
  async function run(selection?: { high_id: string; low_id: string }) {
    setBusy(true);
    setError("");
    setAudit(null);
    try {
      const r = await fetch(
        `/api/intelligence?${new URLSearchParams({ symbol, side, ...selection })}`,
        { cache: "no-store" },
      );
      const body = await r.json();
      if (!r.ok || !body.ok)
        throw new Error(body.error?.message ?? `HTTP ${r.status}`);
      setAudit(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ overflowWrap: "anywhere" }}>
      <div className="eyebrow">THE EDGE · OBSERVATIONS</div>
      <h1>Market Intelligence</h1>
      <nav className="api-links">
        <a href="/">Графики</a>
        <a href="/knowledge">Knowledge Base</a>
      </nav>
      <p>
        Анализ закрытых свечей с происхождением каждого вывода. Геометрия и
        гипотезы не являются вероятностями или поручением на сделку.
      </p>
      <label>
        Инструмент{" "}
        <select
          value={symbol}
          disabled={busy}
          onChange={(e) => {
            setSymbol(e.target.value);
            setAudit(null);
            setHigh("");
            setLow("");
          }}
        >
          {["EURUSD", "NAS100", "EU50"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Цена{" "}
        <select
          value={side}
          disabled={busy}
          onChange={(e) => {
            setSide(e.target.value);
            setAudit(null);
            setHigh("");
            setLow("");
          }}
        >
          <option value="bid">Bid</option>
          <option value="ask">Ask</option>
        </select>
      </label>
      <button disabled={busy} onClick={() => run()}>
        {busy ? "Проверка данных…" : "Получить анализ"}
      </button>
      {error && <p role="alert">{error}</p>}
      {audit && (
        <>
          <p>
            {audit.environment.toUpperCase()} · {audit.as_of} ·{" "}
            {audit.data_quality.status}
          </p>
          <p>{audit.pipeline.join(" → ")}</p>
          <fieldset>
            <legend>Выбрать H4 Dealing Range</legend>
            <p>
              Оба фрактала должны быть одной версии, на одной стороне цены и в
              непрерывном участке истории.
            </p>
            <label>
              H4 High{" "}
              <select
                style={{ maxWidth: "100%" }}
                value={high}
                onChange={(e) => setHigh(e.target.value)}
              >
                <option value="">Выберите максимум</option>
                {pivots
                  .filter((p) => p.facts.polarity === "high")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.facts.variant)}-bar · {String(p.facts.price)} ·{" "}
                      {String(p.facts.pivot_time)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              H4 Low{" "}
              <select
                style={{ maxWidth: "100%" }}
                value={low}
                onChange={(e) => setLow(e.target.value)}
              >
                <option value="">Выберите минимум</option>
                {pivots
                  .filter((p) => p.facts.polarity === "low")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.facts.variant)}-bar · {String(p.facts.price)} ·{" "}
                      {String(p.facts.pivot_time)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={!high || !low || busy}
              onClick={() => run({ high_id: high, low_id: low })}
            >
              Применить H4 диапазон
            </button>
            {audit.frames.find((f) => f.timeframe === "H4")?.range && (
              <p data-testid="selected-range">
                DR:{" "}
                {audit.frames.find((f) => f.timeframe === "H4")!.range!.lower} —{" "}
                {audit.frames.find((f) => f.timeframe === "H4")!.range!.upper};
                EQ:{" "}
                {
                  audit.frames.find((f) => f.timeframe === "H4")!.range!
                    .equilibrium
                }
              </p>
            )}
          </fieldset>
          <h2>Narrative: {audit.narrative.bias}</h2>
          <p>
            A: {audit.narrative.A?.id ?? "Не определена"}; B:{" "}
            {audit.narrative.B?.price ?? "Нет подтверждённой цели"}; C:{" "}
            {audit.narrative.C?.price ?? "Требуется спецификация"}.
          </p>
          <p>
            Вердикт: {audit.verdict.status}. Риск: {audit.risk.status}.
            Вероятность TP не рассчитывается.
          </p>
          <details>
            <summary>Аргументы и условия отмены</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(
                {
                  narrative: audit.narrative,
                  execution: audit.execution,
                  assessment: audit.assessment,
                },
                null,
                2,
              )}
            </pre>
          </details>
          {audit.frames.map((f) => (
            <section key={f.timeframe}>
              <h2>
                {f.timeframe} · {f.findings.length} наблюдений
              </h2>
              <p>
                {f.data_status} · {f.closed_candles} закрытых свечей
              </p>
              <p>
                {f.range_blocker}; {f.session_blocker}
              </p>
              {f.findings.map((e) => (
                <details key={e.id}>
                  <summary>
                    {e.kind} · {e.confirmed_at} · {e.state}
                  </summary>
                  <p>
                    {e.rule_id} · {e.rule_status} · {e.data_status}
                  </p>
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {JSON.stringify(e.facts, null, 2)}
                  </pre>
                  <p>
                    Свечи: {e.candle_evidence.map((c) => c.time).join(", ")}
                  </p>
                  <p>Отмена: {e.invalidation}</p>
                  <p>{e.counterarguments.join("; ")}</p>
                  {e.sources.map((s) => (
                    <p key={s.id}>
                      <a href={s.url ?? undefined}>Источник</a> · {s.revision}
                    </p>
                  ))}
                </details>
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
