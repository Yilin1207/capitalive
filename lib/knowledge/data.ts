import type { CandleResponse, PriceSide, Timeframe } from "../candle-data";
import { HISTORY } from "../candle-data";
import { isWeekendClosure, mergeSundaySessions } from "../session-candles";
export type Bar = {
  index: number;
  time: string;
  end: string;
  open: number;
  high: number;
  low: number;
  close: number;
  segment: number;
};
export type Frame = {
  timeframe: Timeframe;
  side: PriceSide;
  bars: Bar[];
  status: "PARTIAL" | "UNVERIFIED";
  warnings: string[];
  as_of: string;
  symbol: string;
  diagnostics?: {code:string;origin:string;count:number;times:string[];detail:string}[];
};
export function closedFrame(
  data: CandleResponse,
  side: PriceSide,
  asOf = data.fetched_at,
): Frame {
  const now = Date.parse(asOf),
    fetched = Date.parse(data.fetched_at),
    bars: Bar[] = [],
    warnings = new Set<string>(["SESSION_COVERAGE_NOT_INDEPENDENTLY_VERIFIED"]);
  let segment = 0,
    previous = -Infinity,
    formingSeen = false;
  const diagnostics:NonNullable<Frame['diagnostics']>=[];
  const record=(code:string,origin:string,time:string,detail:string)=>{let d=diagnostics.find(x=>x.code===code);if(!d){d={code,origin,count:0,times:[],detail};diagnostics.push(d);}d.count++;if(time)d.times.push(time);};
  record('SESSION_COVERAGE_NOT_INDEPENDENTLY_VERIFIED','MISSING_CALENDAR','','Provider/exchange session calendar is not independently verified; nominal gaps are not automatically missing trades.');
  const rejected = (
    data.metadata.validation_gaps ??
    data.metadata.diagnostics.missing_filtered_times
  ).map(Date.parse);
  const fatal =
    !Number.isFinite(now) ||
    !Number.isFinite(fetched) ||
    data.metadata.discarded_reasons.invalid_time > 0;
  // D1: the Sunday-evening session opens Monday's trading day (idempotent for already merged data).
  const source = data.timeframe === "D1" ? mergeSundaySessions(data.candles) : data.candles;
  for (let index = 0; index < source.length; index++) {
    const c = source[index],
      t = Date.parse(c.time),
      end =
        data.timeframe === "MN1"
          ? Date.UTC(
              new Date(t).getUTCFullYear(),
              new Date(t).getUTCMonth() + 1,
              1,
            )
          : t + HISTORY[data.timeframe].seconds * 1000;
    if (!Number.isFinite(t) || t <= previous) {
      warnings.add("INVALID_TIME_ORDER");
      record('INVALID_TIME_ORDER','PIPELINE_GUARD',c.time,'Malformed or non-increasing normalized time; no pattern may cross it.');
      segment++;
      continue;
    }
    previous = t;
    if (t >= now) continue;
    if (!c.is_closed || end > now || end > fetched) {
      record('FORMING_OR_NOT_YET_CLOSED','NORMAL_CLOSURE_FILTER',c.time,'Excluded until nominal interval and provider closure are both satisfied.');
      formingSeen = true;
      segment++;
      continue;
    }
    if (formingSeen) {
      warnings.add("CLOSED_AFTER_FORMING");
      segment++;
      continue;
    }
    if((c.history_completeness_by_side?.[side]??c.history_completeness)==='partial_validation'){
      warnings.add('PARTIAL_AGGREGATION');record('PARTIAL_AGGREGATION','AGGREGATION_WITH_UPSTREAM_REJECTION',c.time,'Monthly aggregate lost validated daily input; this is not necessarily malformed monthly OHLC.');segment++;continue;
    }
    const values = [c.open[side], c.high[side], c.low[side], c.close[side]];
    if (
      values.some((v) => v === null || !Number.isFinite(v) || v! <= 0) ||
      c.low[side]! > Math.min(c.open[side]!, c.close[side]!) ||
      c.high[side]! < Math.max(c.open[side]!, c.close[side]!) ||
      ["open", "high", "low", "close"].some((f) => {
        const p = c[f as "open"];
        return p.bid !== null && p.ask !== null && p.bid > p.ask;
      })
    ) {
      warnings.add("INVALID_OHLC");
      const crossed=['open','high','low','close'].some(f=>{const p=c[f as 'open'];return p.bid!==null&&p.ask!==null&&p.bid>p.ask;});
      record(crossed?'CROSSED_BID_ASK':'INVALID_SELECTED_SIDE_OHLC','NORMALIZED_PROVIDER_DATA',c.time,crossed?'Bid exceeds Ask in at least one matched OHLC field; both sides are unusable.':`Selected ${side} side is missing, nonfinite, nonpositive, or violates OHLC geometry.`);
      segment++;
      continue;
    }
    const prev = bars.at(-1);
    if (
      prev &&
      ((Date.parse(prev.end) !== t && !(data.timeframe === "D1" && isWeekendClosure(Date.parse(prev.end), t))) ||
        rejected.some((x) => x >= Date.parse(prev.time) && x <= t))
    ) {
      segment++;
      warnings.add("GAP_BOUNDARY_NO_PATTERN_STITCHING");
      record('GAP_BOUNDARY_NO_PATTERN_STITCHING','PROVIDER_INTERVAL_OR_VALIDATION_GAP',c.time,'Nominal interval is absent or rejected; could be a session closure. No automatic calendar inference.');
    }
    if (rejected.includes(t)) {
      segment++;
      warnings.add("KNOWN_REJECTED_BAR");
      continue;
    }
    bars.push({
      index,
      time: c.time,
      end: new Date(end).toISOString(),
      open: c.open[side]!,
      high: c.high[side]!,
      low: c.low[side]!,
      close: c.close[side]!,
      segment,
    });
  }
  if (data.metadata.insufficient_history)
    {warnings.add("REQUESTED_HISTORY_INCOMPLETE");record('REQUESTED_HISTORY_INCOMPLETE','HISTORY_WINDOW','','Provider returned fewer requested candles; before-window interactions cannot be reconstructed.');}
  const recoveredDays=new Set(data.metadata.aggregation?.reconstructions?.filter(x=>x.status==='RECOVERED').map(x=>x.day));
  const allRecovered=data.timeframe==='MN1' && recoveredDays.size>0 && recoveredDays.size===data.metadata.discarded_rows &&
    recoveredDays.size===data.metadata.discarded_reasons.crossed_sides && !data.metadata.discarded_sides &&
    !data.metadata.validation_gaps?.length && data.candles.every(c=>c.history_completeness!=='partial_validation');
  if (allRecovered)record('PROVIDER_ROWS_RECONSTRUCTED','VERIFIED_INTRADAY_AGGREGATION','','All rejected daily rows were reconstructed from provider intraday bars with neighboring-day and unaffected-field checks.');
  const gaps=data.metadata.validation_gaps??[];
  const cutoff=Math.min(now,fetched);
  const formingOnly=gaps.length>0 && gaps.length+recoveredDays.size===data.metadata.discarded_rows &&
    !data.metadata.discarded_sides && gaps.every(time=>{
      const start=Date.parse(time),date=new Date(start);
      const end=data.timeframe==='MN1'?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1):start+HISTORY[data.timeframe].seconds*1000;
      return end>cutoff;
    });
  if(formingOnly)record('FORMING_INPUT_REJECTED','UPSTREAM_NORMALIZATION','','Outstanding rejected inputs belong to intervals that had not closed at the analysis cutoff.');
  if (!allRecovered && !formingOnly && (data.metadata.discarded_rows || data.metadata.discarded_sides))
    {warnings.add("PROVIDER_VALIDATION_LOSS");record('PROVIDER_VALIDATION_LOSS','UPSTREAM_NORMALIZATION','','Provider rows/sides were discarded before this engine. Consult metadata.discarded_reasons and rejected_rows; do not infer root cause without raw upstream evidence.');}
  if (fatal) warnings.add("UNLOCATABLE_OR_INVALID_TIME");
  return {
    timeframe: data.timeframe,
    side,
    bars: fatal ? [] : bars,
    status: fatal || !bars.length ? "UNVERIFIED" : "PARTIAL",
    warnings: [...warnings],
    as_of: asOf,
    symbol: data.symbol,
    diagnostics,
  };
}
export function contiguous(bars: Bar[]) {
  return bars.length > 0 && bars.every((b) => b.segment === bars[0].segment);
}
