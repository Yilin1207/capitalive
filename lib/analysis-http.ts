import "server-only";
import { HistoryError } from "./candles";
import { ANALYSIS_SYMBOLS, INSTRUMENTS, type AnalysisSymbol, type AnalysisSettings, type RangeSelection } from "./technical-analysis";
import { type PriceSide } from "./candle-data";

export function analysisParams(params: URLSearchParams): { symbol: AnalysisSymbol; side: PriceSide; settings: AnalysisSettings; selection?: RangeSelection } {
  const symbol = (params.get("symbol") ?? "NAS100").toUpperCase() as AnalysisSymbol;
  if (!ANALYSIS_SYMBOLS.includes(symbol)) throw new HistoryError("INVALID_SYMBOL", "Analysis supports EURUSD, NAS100, EU50", 400);
  const side = params.get("side") ?? "bid";
  if (side !== "bid" && side !== "ask") throw new HistoryError("INVALID_SIDE", "side must be bid or ask", 400);
  const numeric = (name: string, fallback: number, maximum: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) > maximum)
      throw new HistoryError("INVALID_MATERIALITY", `${name} must be a number from 0 to ${maximum}`, 400);
    return Number(raw);
  };
  const high = params.get("range_high"), low = params.get("range_low");
  let selection: RangeSelection | undefined;
  if (high !== null || low !== null) {
    if (!high || !low || high.length > 100 || low.length > 100) throw new HistoryError("INVALID_RANGE_SELECTION", "Provide both range_high and range_low fractal IDs", 400);
    const prefix = `H4:${side}:`;
    if (!high.startsWith(`${prefix}high:`) || !low.startsWith(`${prefix}low:`)) throw new HistoryError("INVALID_RANGE_SELECTION", "Range IDs must be H4 high/low IDs for the selected price side", 400);
    selection = { high_id: high, low_id: low };
  }
  return { symbol, side, selection, settings: { min_remaining_units: numeric("min_remaining_units", INSTRUMENTS[symbol].min_remaining_units, 10000), atr_fraction: numeric("atr_fraction", 0.02, 1) } };
}
