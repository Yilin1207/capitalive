"use client";
import { useEffect, useMemo, useState } from "react";
import type { CandleResponse, PriceSide } from "@/lib/candle-data";
import { ANALYSIS_SYMBOLS, analyzeSeries, type AnalysisSymbol, type RangeSelection } from "@/lib/technical-analysis";
import { chartSvg, DEFAULT_LAYERS, SNR_LAYER, type ChartLayers } from "@/lib/chart-svg";
import type { ChartHtf } from '@/lib/chart-htf';
import { SNR_COLORS } from '@/lib/htf-priority';

export default function AnalysisChart({ data, side }: { data: CandleResponse; side: PriceSide }) {
  const [layers, setLayers] = useState<ChartLayers>({ ...DEFAULT_LAYERS });
  const [chosen, setChosen] = useState<{ identity: string; selection: RangeSelection } | null>(null);
  const symbol = data.symbol as AnalysisSymbol;
  const identity = `${symbol}:${data.timeframe}:${side}`;
  const selection = chosen?.identity === identity ? chosen.selection : undefined;
  const supported = ANALYSIS_SYMBOLS.includes(symbol);
  const [htfState,setHtfState]=useState<{key:string;value:ChartHtf|null;error:string}>({key:'',value:null,error:''});
  const snrEnabled=Object.values(SNR_LAYER).some(key=>layers[key]);
  const htfKey=`${symbol}:${side}:${data.fetched_at}`;
  const htf=htfState.key===htfKey?htfState.value:null;
  useEffect(()=>{
    if(!snrEnabled||!supported)return;
    const controller=new AbortController();
    void fetch(`/api/htf-zones?${new URLSearchParams({symbol,side,view:'priority'})}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{const body=await response.json(); if(!response.ok||!body.ok)throw new Error(body.error?.message??'HTF недоступен');
        if(!controller.signal.aborted)setHtfState({key:htfKey,value:{priority_zones:body.priority_zones,frame_snapshots:body.frame_snapshots},error:''});})
      .catch(error=>{if(!controller.signal.aborted)setHtfState({key:htfKey,value:null,error:error instanceof Error?error.message:'HTF недоступен'});});
    return()=>controller.abort();
  },[symbol,side,htfKey,snrEnabled,supported]);
  const automatic = useMemo(() => supported ? analyzeSeries(data, symbol, side) : null, [data, symbol, side, supported]);
  const { analysis, selectionError } = useMemo(() => {
    if (!selection || !automatic) return { analysis: automatic, selectionError: "" };
    try { return { analysis: analyzeSeries(data, symbol, side, {}, undefined, selection), selectionError: "" }; }
    catch { return { analysis: automatic, selectionError: "Выбранная пара недоступна или некорректна: нужны разные подтверждённые H4-фракталы, High выше Low. Выберите другую пару или автоматический диапазон." }; }
  }, [data, symbol, side, selection, automatic]);
  const svg = useMemo(() => {
    if (!analysis || selectionError) return null;
    try { return chartSvg(data, analysis, symbol, side, layers,120,htf??undefined); } catch { return null; }
  }, [data, analysis, symbol, side, layers, selectionError,htf]);
  if (!analysis) return null;
  const params = new URLSearchParams({ symbol, timeframe: data.timeframe, side, ...Object.fromEntries(Object.entries(layers).map(([key, value]) => [key, value ? "1" : "0"])) });
  const auditParams = new URLSearchParams({ symbol, side, view:'priority' });
  if (selection) for (const [key, value] of [["range_high", selection.high_id], ["range_low", selection.low_id]]) { params.set(key, value); auditParams.set(key, value); }
  const highId = selection?.high_id ?? automatic?.ranges.selected.high?.id ?? "";
  const lowId = selection?.low_id ?? automatic?.ranges.selected.low?.id ?? "";
  const labels:Record<keyof ChartLayers,string> = { fractals: "Фракталы", fvg: "FVG", ranges: "Диапазоны", eq: "EQ / Premium / Discount",
    snr_mn1:'Monthly SNR',snr_w1:'Weekly SNR',snr_d1:'Daily SNR',snr_h4:'H4 SNR',snr_events:'Пробои / ретесты / failed reclaim' };
  return <section className="analysis-panel" aria-label="Техническая структура Capitalive">
    <h2>Структура рынка</h2>
    <div className="controls">
      {(Object.keys(layers) as (keyof ChartLayers)[]).map(key => <label key={key} className="layer-control"><input type="checkbox" checked={layers[key]} onChange={event => setLayers(old => ({ ...old, [key]: event.target.checked }))} />{labels[key]}</label>)}
      {!selectionError && <><a href={`/api/chart?${params}`} target="_blank" rel="noreferrer">Открыть PNG</a>
      <a href={`/api/market-audit?${auditParams}`} target="_blank" rel="noreferrer">Аудит для ChatGPT</a></>}
    </div>
    {data.timeframe === "H4" && <div className="controls">
      <label>H4 Fractal High<select value={highId} onChange={event => setChosen({ identity, selection: { high_id: event.target.value, low_id: lowId } })}>
        <option value="">Выберите High</option>{automatic?.fractals.filter(f => f.kind === "high").map(f => <option key={f.id} value={f.id}>{f.time.slice(0, 16)} UTC · {f.price} · {f.liquidity_status}</option>)}
      </select></label>
      <label>H4 Fractal Low<select value={lowId} onChange={event => setChosen({ identity, selection: { high_id: highId, low_id: event.target.value } })}>
        <option value="">Выберите Low</option>{automatic?.fractals.filter(f => f.kind === "low").map(f => <option key={f.id} value={f.id}>{f.time.slice(0, 16)} UTC · {f.price} · {f.liquidity_status}</option>)}
      </select></label>
      <button onClick={() => setChosen(null)}>Автоматический диапазон</button>
      <span>{selection ? "Выбор по ID фракталов" : "Автоматический выбор"}</span>
    </div>}
    {selectionError && <p role="alert">{selectionError}</p>}
    {svg ? <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : !selectionError && <p role="status">Нет валидных OHLC для выбранной стороны цены.</p>}
    <p className="chart-note">Треугольники — подтверждённые фракталы: янтарные — касание ровно по уровню, серые — снятие с выходом за уровень. Пунктирный янтарный диапазон ещё формируется. Заполнение FVG учитывает текущую свечу. SNR — отдельный снимок HTF; цвета различают таймфреймы, score не является вероятностью.</p>
    {snrEnabled && !htf && <p role="status">{htfState.key===htfKey && htfState.error ? `HTF: ${htfState.error}` : 'Загрузка HTF-зон…'}</p>}
    {snrEnabled && htf && <details className="priority-zones"><summary>Приоритетные HTF-зоны: {htf.priority_zones.selected_count} из {htf.priority_zones.full_snr_count}</summary>
      <p>На графике — до двух видимых зон каждого включённого таймфрейма: ближайшая и следующая по рангу, до двух последних отметок событий на зону. Все кандидаты и причины отбора сохранены в <a href={`/api/htf-zones?${new URLSearchParams({symbol,side,view:'full'})}`} target="_blank" rel="noreferrer">полном каталоге SNR</a>.</p>
      <div className="analysis-table-wrap"><table><thead><tr><th>TF / границы</th><th>Роль / состояние</th><th>Тесты / реакции</th><th>Ранг</th></tr></thead><tbody>
        {htf.priority_zones.zones.map(z=><tr key={z.id}><td style={{color:SNR_COLORS[z.timeframe]}}>{z.timeframe} · {z.lower}—{z.upper}</td><td>{z.role}{z.provisional_role?` → ${z.provisional_role}?`:''} · {z.current_state??z.status}</td><td>{z.tests} / {z.reactions}</td>
          <td><span title={JSON.stringify(z.components)}>{z.score.toFixed(1)}</span> · {z.selection_reasons.join(', ')}</td></tr>)}
      </tbody></table></div>
    </details>}
    {!selectionError && <details><summary>Границы диапазонов и незаполненные FVG</summary>
      <p>Выбор: {selection ? "заданные подтверждённые фракталы" : "последняя пара противоположных подтверждённых фракталов"}. Альтернатив: {analysis.ranges.alternatives.length}. Статус: {analysis.ranges.selected.status}. EQ: <span data-testid="range-eq">{analysis.ranges.selected.equilibrium ?? "—"}</span>.</p>
      <div className="analysis-table-wrap"><table><thead><tr><th>FVG / UTC</th><th>Границы остатка</th><th>Заполнено</th><th>Остаток</th><th>Значимость</th></tr></thead><tbody>
        {analysis.fvgs.filter(g => g.status !== "filled").map(g => <tr key={g.id}><td>{g.direction} · {g.formed_at.slice(0, 16)}</td><td>{g.remaining_lower} — {g.remaining_upper}</td><td>{g.fill_percent.toFixed(1)}%</td><td>{g.remaining_units.toFixed(2)} {analysis.materiality.unit}</td><td>{g.material ? "значимый" : "малый"}</td></tr>)}
      </tbody></table></div>
    </details>}
  </section>;
}
