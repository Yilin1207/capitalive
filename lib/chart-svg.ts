import { HISTORY, type CandleResponse, type PriceSide, type Timeframe } from "./candle-data";
import { INSTRUMENTS, type AnalysisSymbol, type SeriesAnalysis } from "./technical-analysis";
import { SNR_COLORS } from './htf-priority';
import type { ChartHtf } from './chart-htf';

export type ChartLayers = { fractals: boolean; fvg: boolean; ranges: boolean; eq: boolean; snr_mn1:boolean; snr_w1:boolean; snr_d1:boolean; snr_h4:boolean; snr_events:boolean };
export const DEFAULT_LAYERS: ChartLayers = { fractals: true, fvg: true, ranges: true, eq: true, snr_mn1:false,snr_w1:false,snr_d1:false,snr_h4:false,snr_events:false };
export const SNR_LAYER:Record<Timeframe,keyof ChartLayers>={MN1:'snr_mn1',W1:'snr_w1',D1:'snr_d1',H4:'snr_h4'};
const escape = (text: unknown) => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Deterministic OHLC rendering shared by browser and PNG API; no remote assets or generated prices. */
export function chartSvg(data: CandleResponse, analysis: SeriesAnalysis, symbol: AnalysisSymbol, side: PriceSide, layers: ChartLayers = DEFAULT_LAYERS, bars = 120, htf?:ChartHtf) {
  const snrEnabled=Object.values(SNR_LAYER).some(key=>layers[key]);
  const width = 1400, height = snrEnabled ? 1280 : 1000, left = 72, right = 1250, top = 140, bottom = 694;
  const candles = data.candles.slice(-bars), offset = data.candles.length - candles.length;
  const prices = candles.flatMap(c => [c.low[side], c.high[side]]).filter((p): p is number => p !== null);
  if (!prices.length) throw new Error("No valid prices for selected chart side");
  const ranges = [analysis.ranges.selected, ...analysis.ranges.potential].filter(r => r.lower !== null && r.upper !== null);
  if (layers.ranges || layers.eq) for (const r of ranges) prices.push(r.lower!, r.upper!);
  const min = Math.min(...prices), max = Math.max(...prices), padding = Math.max((max - min) * 0.10, Math.abs(max) * 0.0001, 0.00001);
  const lo = min - padding, hi = max + padding, step = (right - left) / Math.max(1, candles.length);
  const x = (i: number) => left + (i + 0.5) * step;
  const y = (price: number) => top + (hi - price) / (hi - lo) * (bottom - top);
  const fmt = (price: number) => price.toFixed(INSTRUMENTS[symbol].precision);
  const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${symbol} ${data.timeframe} Capital.com OHLC chart">
    <defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/></clipPath></defs>
    <rect width="1400" height="${height}" fill="#0c1422"/>
    <g font-family="Noto Sans,DejaVu Sans,Arial,sans-serif" fill="#b7c7dc">
    <text x="72" y="43" font-size="15" letter-spacing="2" fill="#53d9b4">CAPITALIVE 2.1 / OBSERVED MARKET DATA</text>
    <text x="72" y="82" font-size="30" font-weight="bold" fill="#f2f6fc">${symbol} · ${data.timeframe} · ${side.toUpperCase()}</text>
    <text x="1320" y="43" text-anchor="end" font-size="15">CAPITAL.COM / ${data.environment.toUpperCase()}</text>
    <text x="1320" y="78" text-anchor="end" font-size="13">Fetched ${escape(data.fetched_at)} · UTC</text>
    <text x="72" y="114" font-size="13">${candles.length} bars shown / ${data.candles.length} analyzed · Amber = forming candle · Ordinal bars, actual UTC dates</text>`];
  for (let i = 0; i <= 6; i++) {
    const price = lo + (hi - lo) * i / 6, yy = y(price);
    svg.push(`<path d="M${left} ${yy}H${right}" stroke="#233147"/><text x="1264" y="${yy + 5}" font-size="13">${fmt(price)}</text>`);
  }
  const dateIndexes = [...new Set(Array.from({ length: Math.min(7, candles.length) }, (_, i) => Math.round(i * (candles.length - 1) / Math.max(1, Math.min(7, candles.length) - 1))))];
  for (const i of dateIndexes) svg.push(`<text x="${x(i)}" y="722" text-anchor="middle" font-size="12">${escape(candles[i].time.slice(0, 10))}</text>`);
  svg.push(`<g clip-path="url(#plot)">`);
  const enabledZones=htf?.priority_zones.zones.filter(z=>layers[SNR_LAYER[z.timeframe]])??[];
  const visibleZones=enabledZones.filter(z=>z.upper>=lo&&z.lower<=hi);
  const drawnZones=(['MN1','W1','D1','H4'] as const).flatMap(tf=>{
    const candidates=visibleZones.filter(z=>z.timeframe===tf);
    const nearest=[...candidates].sort((a,b)=>(a.distance_atr??Infinity)-(b.distance_atr??Infinity)||b.score-a.score)[0];
    return nearest?[nearest,...candidates.filter(z=>z.id!==nearest.id).slice(0,1)]:[];
  });
  const atTime=(time:string)=>{
    const t=Date.parse(time), i=candles.findIndex(c=>Date.parse(c.time)>=t);
    return t<=Date.parse(candles[0].time)?left:i<0?right:x(i);
  };
  drawnZones.forEach((z,i)=>{
    const color=SNR_COLORS[z.timeframe], stamp=new Date(z.origin.time);
    const originEnd=z.timeframe==='MN1'?Date.UTC(stamp.getUTCFullYear(),stamp.getUTCMonth()+1,1):stamp.getTime()+HISTORY[z.timeframe].seconds*1000;
    const start=atTime(new Date(originEnd).toISOString());
    svg.push(`<g data-snr-timeframe="${z.timeframe}" data-zone-id="${escape(z.id)}"><title>${escape(`${z.timeframe} current ${z.role}; ${z.status}; ${z.lower}-${z.upper}`)}</title>
      <rect x="${start}" y="${y(z.upper)}" width="${Math.max(0,right-start)}" height="${Math.max(1,y(z.lower)-y(z.upper))}" fill="${color}" fill-opacity="0.07" stroke="${color}" stroke-width="${z.timeframe==='MN1'?1.7:1}" stroke-dasharray="${z.status==='watch'?'3 5':'9 3'}"/>
      <text x="${Math.min(right-25,start+4)}" y="${Math.max(top+13,Math.min(bottom-4,y(z.upper)-3))}" fill="${color}" font-size="11">S${i+1}</text></g>`);
    if(layers.snr_events){
      const byTime=new Map(z.events.map(e=>[e.confirmed_at,e]));
      for(const e of [...byTime.values()].slice(-2)){
        if(e.confirmed_at<candles[0].time||e.time>candles.at(-1)!.time)continue;
        const xx=atTime(e.confirmed_at),yy=y(e.role==='support'?z.lower:z.upper);
        const short={CLOSE_BREAK:'C1',BREAK_PENDING:'BP',CONFIRMED_BREAK:'CB',RETEST:'R',FAILED_RECLAIM:'FR',CONFIRMED_ROLE_REVERSAL:'RV',SWEEP:'SW',BREAK_INVALIDATED:'X'}[e.state];
        svg.push(`<g data-snr-state="${e.state}"><title>${escape(`${e.state} known ${e.confirmed_at}; ${e.confidence}; close ${e.facts.close}`)}</title><circle cx="${xx}" cy="${yy}" r="4" fill="${color}"/><text x="${Math.min(right-22,xx+5)}" y="${Math.max(top+11,yy-7-(i%3)*12)}" fill="${color}" font-size="10">${short}</text></g>`);
      }
    }
  });
  for (const r of ranges) {
    const start = Math.max(left, x(Math.min(r.high!.index, r.low!.index) - offset));
    const forming = r.status !== "confirmed", color = forming ? "#edbd64" : "#899dff";
    if (layers.ranges) {
      svg.push(`<rect x="${start}" y="${y(r.upper!)}" width="${right - start}" height="${y(r.lower!) - y(r.upper!)}" fill="${color}" fill-opacity="0.04" stroke="${color}" stroke-dasharray="${forming ? "4 6" : "10 4"}"/>`);
    }
    if (layers.eq) svg.push(`<rect x="${start}" y="${y(r.upper!)}" width="${right - start}" height="${y(r.equilibrium!) - y(r.upper!)}" fill="#ef8491" fill-opacity="0.06"/>
      <rect x="${start}" y="${y(r.equilibrium!)}" width="${right - start}" height="${y(r.lower!) - y(r.equilibrium!)}" fill="#42d6ad" fill-opacity="0.06"/>
      <path d="M${start} ${y(r.equilibrium!)}H${right}" stroke="${color}" stroke-dasharray="6 6"/>`);
  }
  const visibleGaps = analysis.fvgs.filter(g => g.status !== "filled" && g.upper >= lo && g.lower <= hi);
  const drawnGaps = visibleGaps.slice(-8);
  if (layers.fvg) for (const [index, g] of drawnGaps.entries()) {
    const start = Math.max(left, x(g.index - offset)), color = g.direction === "bullish" ? "#44d8b2" : "#ef8491";
    svg.push(`<rect x="${start}" y="${y(g.upper)}" width="${right - start}" height="${Math.max(1, y(g.lower) - y(g.upper))}" fill="${color}" fill-opacity="0.035" stroke="${color}" stroke-opacity="0.3" stroke-dasharray="3 6"/>
      <rect x="${start}" y="${y(g.remaining_upper!)}" width="${right - start}" height="${Math.max(1, y(g.remaining_lower!) - y(g.remaining_upper!))}" fill="${color}" fill-opacity="${g.material ? 0.16 : 0.04}"/>
      <text x="${Math.min(start + 4, right - 24)}" y="${Math.max(top + 12, y(g.upper) - 4)}" fill="${color}" font-size="11">F${index + 1}</text>`);
  }
  candles.forEach((c, i) => {
    const o = c.open[side], h = c.high[side], l = c.low[side], close = c.close[side];
    if (o === null || h === null || l === null || close === null) return;
    const color = !c.is_closed ? "#edbd64" : close >= o ? "#44d8b2" : "#ef8491", w = Math.max(1, Math.min(14, step * 0.63));
    svg.push(`<path d="M${x(i)} ${y(h)}V${y(l)}" stroke="${color}" stroke-width="1.3"/>
      <rect x="${x(i) - w / 2}" y="${y(Math.max(o, close))}" width="${w}" height="${Math.max(1.2, Math.abs(y(o) - y(close)))}" fill="${color}"/>`);
  });
  if (layers.fractals) for (const f of analysis.fractals.filter(f => f.index >= offset)) {
    const xx = x(f.index - offset), yy = y(f.price) + (f.kind === "high" ? -10 : 10), dy = f.kind === "high" ? -7 : 7;
    svg.push(`<path d="M${xx} ${yy}l-5 ${dy}h10Z" fill="${f.liquidity_status === "swept" ? "#65738a" : f.liquidity_status === "touched" ? "#edbd64" : "#c8b3ff"}"/>`);
  }
  svg.push(`</g>`);
  const selected = analysis.ranges.selected;
  svg.push(`<text x="72" y="756" font-size="13" fill="#c8b3ff">${layers.fractals ? "Confirmed fractals: purple untouched / amber touched (equal) / grey swept (strict cross)" : "Fractals hidden"}</text>`);
  svg.push(`<text x="72" y="781" font-size="13">${escape(!layers.ranges&&!layers.eq ? 'Range / EQ layers hidden' : selected.equilibrium === null ? "Range unconfirmed: missing opposite fractal" : `${selected.status.toUpperCase()} RANGE ${fmt(selected.lower!)} - ${fmt(selected.upper!)} / EQ ${fmt(selected.equilibrium)} / above EQ: Premium; below: Discount`)}${(layers.ranges||layers.eq)&&selected.boundaries_swept ? " / boundary swept" : ""}</text>`);
  if (layers.fvg) {
    svg.push(`<text x="72" y="809" font-size="12">FVG: ${drawnGaps.length}/${visibleGaps.length} active shown. Faint outline = original; solid tint = residual. Filled gaps retained in JSON.</text>`);
    drawnGaps.forEach((g, i) => {
      const summary = `F${i + 1} ${g.direction === "bullish" ? "BULL" : "BEAR"} ${fmt(g.remaining_lower!)} - ${fmt(g.remaining_upper!)} / ${g.fill_percent.toFixed(1)}% filled / ${g.remaining_units.toFixed(2)} ${INSTRUMENTS[symbol].unit}${g.material ? "" : " (small)"}`;
      svg.push(`<text x="${72 + (i % 2) * 640}" y="${834 + Math.floor(i / 2) * 23}" font-size="12">${escape(summary)}</text>`);
    });
  }
  const notes = analysis.warnings.length ? `Data: ${analysis.warnings.join(" / ")}` : "OHLC retrieval time is not tick freshness. History coverage is not a guarantee of complete sessions.";
  const lines = notes.match(/.{1,150}(?:\s|$)|.{1,150}/g) ?? [];
  lines.slice(0, 3).forEach((line, i) => svg.push(`<text x="72" y="${940 + i * 20}" font-size="12" fill="#edbd64">${escape(line.trim())}</text>`));
  if(snrEnabled){
    svg.push(`<text x="72" y="1010" font-size="14" fill="#eef4ff">HTF SNR · current roles · ${drawnZones.length}/${enabledZones.length} enabled priority zones shown; full catalog retains ${htf?.priority_zones.full_snr_count??0} candidates</text>`);
    svg.push(`<text x="72" y="1032" font-size="12">Max 2 visible bands / TF: nearest + highest score; max 2 recent event stamps / band. Image caps only; complete evidence in catalog.</text>`);
    drawnZones.forEach((z,i)=>svg.push(`<text x="${72+(i%2)*640}" y="${1060+Math.floor(i/2)*27}" fill="${SNR_COLORS[z.timeframe]}" font-size="12">${escape(`S${i+1} ${z.timeframe} ${fmt(z.lower)}–${fmt(z.upper)} ${z.role}${z.provisional_role?` -> ${z.provisional_role}?`:''} / ${z.status}`)}</text>`));
    svg.push(`<text x="72" y="1239" font-size="12">CB confirmed break · R retest · FR failed reclaim · RV role reversal · SW sweep · X reclaimed · score is not probability</text>`);
    svg.push(`<text x="72" y="1260" font-size="11">${escape(htf?`SNR snapshots: ${Object.entries(htf.frame_snapshots??{}).map(([tf,t])=>`${tf} ${t}`).join(' / ')}`:'SNR data not loaded; no HTF levels inferred.')}</text>`);
  }
  svg.push(`</g></svg>`);
  return svg.join("");
}
