"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import { TIMEFRAMES, type Candle, type CandleResponse, type PriceSide, type Timeframe } from "@/lib/candle-data";
import AnalysisChart from "./analysis-chart";

function utc(value: string) { return `${value.replace("T", " ").replace(".000Z", "").replace("Z", "")} UTC`; }
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 6 });

export default function CandleChart({ instruments }: { instruments: { symbol: string; name: string }[] }) {
  const [symbol, setSymbol] = useState("NAS100");
  const [timeframe, setTimeframe] = useState<Timeframe>("H4");
  const [side, setSide] = useState<PriceSide>("bid");
  const [data, setData] = useState<CandleResponse | null>(null);
  const [selected, setSelected] = useState<Candle | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rows = useRef(new Map<number, Candle>());
  const chartIdentity = useRef("");

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#111a29" }, textColor: "#a8b8cd", attributionLogo: true },
      grid: { vertLines: { color: "#1c293b" }, horzLines: { color: "#1c293b" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#2a3a51" },
      rightPriceScale: { borderColor: "#2a3a51" },
      localization: { locale: "en-GB", timeFormatter: (time: Time) => typeof time === "number" ? utc(new Date(time * 1000).toISOString()) : String(time) },
    });
    chart.current = instance;
    series.current = instance.addSeries(CandlestickSeries, {
      upColor: "#43d8b0", downColor: "#f37f89", borderVisible: false,
      wickUpColor: "#43d8b0", wickDownColor: "#f37f89",
    });
    instance.subscribeCrosshairMove(param => {
      setSelected(typeof param.time === "number" ? rows.current.get(param.time) ?? null : null);
    });
    return () => { instance.remove(); chart.current = null; series.current = null; };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setSelected(null);
    setError("");
    setLoading(true);
    async function load() {
      let delay = 60_000;
      try {
        const response = await fetch(`/api/candles?${new URLSearchParams({ symbol, timeframe })}`, { signal: abort.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.ok) {
          delay = Math.max(delay, (Number(response.headers.get("Retry-After")) || 60) * 1000);
          throw new Error(body.error?.message ?? "Свечи недоступны");
        }
        if (!abort.signal.aborted) { setData(body); setError(""); }
      } catch (reason) {
        if (!abort.signal.aborted) {
          setData(null);
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить свечи");
        }
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, delay);
        }
      }
    }
    void load();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [symbol, timeframe, refresh]);

  useEffect(() => {
    if (!series.current || !chart.current) return;
    rows.current = new Map();
    const plotted = (data?.candles ?? []).flatMap(candle => {
      const open = candle.open[side], high = candle.high[side], low = candle.low[side], close = candle.close[side];
      const time = Date.parse(candle.time) / 1000 as UTCTimestamp;
      if (open === null || high === null || low === null || close === null) return [{ time }];
      rows.current.set(time, candle);
      return [{ time, open, high, low, close, ...(!candle.is_closed ? { color: "#eebc61", wickColor: "#eebc61", borderColor: "#eebc61" } : {}) }];
    });
    series.current.applyOptions({ priceFormat: { type: "price", precision: /USDJPY/.test(symbol) ? 3 : /EURUSD|GBPUSD/.test(symbol) ? 5 : /XAGUSD/.test(symbol) ? 3 : 2, minMove: /EURUSD|GBPUSD/.test(symbol) ? 0.00001 : /USDJPY|XAGUSD/.test(symbol) ? 0.001 : 0.01 } });
    series.current.setData(plotted);
    setSelected(null);
    const identity = `${symbol}:${timeframe}:${side}`;
    if (data && chartIdentity.current !== identity) {
      chart.current.timeScale().fitContent();
      chartIdentity.current = identity;
    }
  }, [data, side, symbol, timeframe]);

  const candle = selected ?? data?.candles.at(-1);
  const last = data?.candles.at(-1);
  const missingSide = data?.candles.filter(row => row.open[side] === null).length ?? 0;
  const currentPeriod = data?.metadata.diagnostics.current_period;
  return <section className="chart-panel" aria-label="Свечной график">
    <div className="controls">
      <label>Инструмент<select value={symbol} onChange={event => setSymbol(event.target.value)}>
        {instruments.map(item => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.name}</option>)}
      </select></label>
      <div className="control-group"><span>Период</span><div className="segmented">
        {TIMEFRAMES.map(value => <button key={value} aria-pressed={value === timeframe} onClick={() => setTimeframe(value)}>{value}</button>)}
      </div></div>
      <div className="control-group"><span>Сторона цены</span><div className="segmented">
        {(["bid", "ask"] as const).map(value => <button key={value} aria-pressed={value === side} onClick={() => setSide(value)}>{value.toUpperCase()}</button>)}
      </div></div>
      <button className="fit-button" onClick={() => chart.current?.timeScale().fitContent()}>Весь диапазон</button>
      <span className="environment">{data?.environment.toUpperCase() ?? "—"}</span>
    </div>
    <div className="ohlc" aria-live="polite">
      <strong>{symbol} · {timeframe} · {side.toUpperCase()}</strong>
      <span>O <b>{number(candle?.open[side])}</b></span><span>H <b>{number(candle?.high[side])}</b></span>
      <span>L <b>{number(candle?.low[side])}</b></span><span>C <b>{number(candle?.close[side])}</b></span>
    </div>
    <div className="chart-wrap">
      <div ref={container} className="chart-canvas" aria-label={`${symbol} ${timeframe}, цены ${side}, время UTC`} />
      {loading && <div className="chart-message" role="status">Загрузка свечей Capital.com…</div>}
      {error && <div className="chart-message" role="alert"><strong>Данные недоступны</strong><p>{error}</p><button onClick={() => setRefresh(value => value + 1)}>Повторить</button></div>}
    </div>
    <div className="chart-info">
      <span>Начало свечи: {candle ? utc(candle.time) : "—"}{candle && <b className={candle.is_closed ? "" : "forming"}> · {candle.is_closed ? "закрыта*" : "формируется*"}</b>}</span>
      <span>Загружено: {data ? utc(data.fetched_at) : "—"}</span>
    </div>
    <p className="chart-note">{data ? `${data.candles.length} свечей · ${data.epic} · ` : ""}Колесо мыши — масштаб, перетаскивание — история. Все даты в UTC. Обновление раз в минуту.</p>
    <p className="chart-note"><span className="forming">● Янтарная свеча формируется.</span> *Статус рассчитан на момент загрузки по следующей свече или длительности периода; это не флаг закрытия от провайдера.{last && !last.is_closed ? " Последняя свеча ещё может измениться." : ""}</p>
    {currentPeriod && currentPeriod.status !== "present" && <p className="data-warning" role="status">
      Свеча текущего периода {utc(currentPeriod.time)} отсутствует: {currentPeriod.status === "filtered_by_validation"
        ? "строка провайдера исключена проверкой цен" : currentPeriod.status === "not_yet_fetched"
          ? "период начался после загрузки данных" : "нет в ответе провайдера; торговое расписание не проверено"}.
      Последняя показанная свеча не заменяет текущую.
    </p>}
    {data?.metadata.insufficient_history && <p className="data-warning">Доступно меньше валидных свечей, чем запрошено: {data.metadata.returned} из {data.metadata.requested}.</p>}
    {(missingSide > 0 || (data?.metadata.discarded_rows ?? 0) > 0 || (data?.metadata.discarded_sides ?? 0) > 0) && <p className="data-warning">Проверка данных: пропущено строк — {data?.metadata.discarded_rows}; некорректных сторон — {data?.metadata.discarded_sides}; свечей без {side.toUpperCase()} — {missingSide}. Пропуски не заполняются.</p>}
    {data && <AnalysisChart data={data} side={side} />}
  </section>;
}
