import "server-only";
import { createHash } from "node:crypto";
import { CapitalApiError, capitalEnvironment, getHistoricalPrices, VERIFIED_MARKETS, type PublicSymbol } from "@/lib/capital";
import { HISTORY, normalizeCandles, type CandleResponse, type Timeframe } from "@/lib/candle-data";
import { HistoryCache, WindowLimit } from "@/lib/history-cache";
import { historyDiagnostics, type HistoryDiagnostics } from "@/lib/history-diagnostics";
import { aggregateMonths, monthStart } from "@/lib/monthly-candles";
import { aggregateWeeks, mergeSundaySessions, weekStart } from "@/lib/session-candles";
import {recoverDaily,type DailyRecovery} from './daily-recovery';
import { aggregateNy, bucketStart, type Grid } from "@/lib/ny-grid";

export class HistoryError extends Error {
  constructor(public code: string, message: string, public status: number, public retryAfter = 0, public diagnostics?: HistoryDiagnostics) { super(message); }
}

const TTL_SECONDS = 30;
const cache = new HistoryCache<Omit<CandleResponse, "metadata"> & { quality: ReturnType<typeof normalizeCandles>; aggregation?: CandleResponse["metadata"]["aggregation"] }>(TTL_SECONDS * 1000);
// Three four-frame cold loads, recovery windows and a refresh can exceed 24 pages.
// Separate pacing and broker cooldown still apply to every actual request.
const upstreamBudget = new WindowLimit(48, 60_000);
const historicalPages = new HistoryCache<{prices:unknown[]}>(10 * 60_000, 64);
// The current HOUR window is shared by NY H4 and NY D1 of one symbol for a short time.
const recentHourPages = new HistoryCache<{prices:unknown[]}>(TTL_SECONDS * 1000, 8);
/** NY-close H4/D1 are rebuilt from HOUR. History depth in weeks (D1: ~200 trading days incl. holidays). */
export const NY_WEEKS = { H4: 10, D1: 42 } as const;
/** Capital.com rejects a HOUR from/to span that is too long (error.invalid.max.daterange, seen on preview
 * 2026-11-23 for 56 days). Start at 41 days = 984 h (<= 1000 rows), halve on that error and remember it. */
export const HOUR_MAX_SPAN_MS = 41 * 86400_000;
const hourSpan = { span: HOUR_MAX_SPAN_MS };
/** Read [start, end] as HOUR windows aligned to multiples of the span since the epoch, so NY H4 and NY D1
 * request identical windows and share cached pages. Coverage is contiguous; buckets before `start` are
 * dropped later by aggregateNy. */
export async function readHourWindows(read:(from:number,to:number)=>Promise<unknown[]>,start:number,end:number,state=hourSpan){
  const prices:unknown[]=[];let pages=0;
  for(let from=Math.floor(start/state.span)*state.span;from<=end;){
    const to=Math.min(end,from+state.span-1000);
    try{prices.push(...await read(from,to));pages++;from=to+1000;}
    catch(error){
      if(error instanceof CapitalApiError&&error.providerCode==='error.invalid.max.daterange'&&state.span>86400_000){state.span=Math.ceil(state.span/2/3600_000)*3600_000;prices.length=0;pages=0;from=Math.floor(start/state.span)*state.span;continue;}
      throw error;
    }
  }
  return {prices,pages,span_hours:state.span/3600_000};
}
let activeLoads = 0;
let coolingUntil = 0;
const waiting=new Set<()=>void>();
async function acquireLoad(){
  if(activeLoads<3){activeLoads++;return;}
  if(waiting.size>=12)throw new HistoryError("HISTORY_BUSY","History service is busy",429,5);
  await new Promise<void>((resolve,reject)=>{
    const admit=()=>{clearTimeout(timer);resolve();};
    const timer=setTimeout(()=>{waiting.delete(admit);reject(new HistoryError("HISTORY_BUSY","History service is busy",429,5));},8_000);
    waiting.add(admit);
  });
}
function releaseLoad(){
  const next=waiting.values().next().value;
  if(next){waiting.delete(next);next();}else activeLoads--;
}

export async function getCandles(symbol: PublicSymbol, timeframe: Timeframe, limit: number, refresh = false, grid: Grid = "utc"): Promise<CandleResponse> {
  const ny = grid === "ny" && (timeframe === "H4" || timeframe === "D1");
  if (timeframe === "MN1" && limit > 60) throw new HistoryError("INVALID_LIMIT", "MN1 limit must be from 1 to 60", 400);
  const environment = capitalEnvironment();
  const epic = VERIFIED_MARKETS[symbol].epic;
  // A small finite set of fetch sizes prevents arbitrary query limits from multiplying upstream calls.
  const fetchLimit = limit <= HISTORY[timeframe].limit ? HISTORY[timeframe].limit : Math.ceil(limit / 250) * 250;
  const scope = createHash("sha256").update([
    process.env.CAPITAL_API_BASE_URL, process.env.CAPITAL_IDENTIFIER,
    process.env.CAPITAL_API_KEY, process.env.CAPITAL_API_PASSWORD,
  ].join("\n")).digest("hex");
  async function readPage(resolution:Parameters<typeof getHistoricalPrices>[1], count:number, range?:{from:string;to:string}){
    const load=async()=>{
      if(Date.now()<coolingUntil)throw new HistoryError("CAPITAL_RATE_LIMIT","Capital.com rate limit reached",429,Math.ceil((coolingUntil-Date.now())/1000));
      const wait=upstreamBudget.take("history");
      if(wait)throw new HistoryError("HISTORY_RATE_LIMIT","History request budget reached",429,wait);
      const page=await getHistoricalPrices(epic,resolution,count,undefined,range) as {prices?:unknown};
      if(!Array.isArray(page?.prices))throw new HistoryError("CAPITAL_INVALID_RESPONSE","Invalid price page",502);
      return {prices:page.prices as unknown[]};
    };
    if(range && resolution==="HOUR" && Date.parse(range.to)>Date.now()-86400_000)return (await recentHourPages.get(JSON.stringify([scope,epic,range.from]),load,Date.now(),refresh)).value;
    if(!range || Date.parse(range.to)>Date.now()-86400_000)return load();
    const key=JSON.stringify([scope,epic,resolution,count,range.from,range.to]);
    return (await historicalPages.get(key,load)).value;
  }
  const { value, hit } = await cache.get(`${scope}:${environment}:${symbol}:${timeframe}:${fetchLimit}:${ny ? "ny" : "utc"}`, async () => {
    if (Date.now() < coolingUntil) throw new HistoryError("CAPITAL_RATE_LIMIT", "Capital.com rate limit reached", 429, Math.ceil((coolingUntil - Date.now()) / 1000));
    await acquireLoad();
    try {
      // A small validation reserve can replace rejected rows with older real bars.
      // Never exceed Capital.com's 1000-bar ceiling or synthesize missing prices.
      const rangeEnd = Date.now();
      const rangeStart = timeframe === "W1" ? weekStart(rangeEnd) - (fetchLimit - 1) * 7 * 86400_000 : monthStart(rangeEnd, 1 - fetchLimit);
      let aggregation: CandleResponse["metadata"]["aggregation"];
      let payload: unknown;
      if (ny) {
        // History starts on a Sunday 00:00 UTC, inside the closed weekend, so the first NY bucket is complete.
        const from0 = weekStart(rangeEnd) + 7 * 86400_000 - NY_WEEKS[timeframe as "H4" | "D1"] * 7 * 86400_000;
        const read = await readHourWindows(async (from, to) => (await readPage("HOUR", 1000, { from: new Date(from).toISOString(), to: new Date(to).toISOString() })).prices, from0, rangeEnd);
        payload = { prices: read.prices };
        aggregation = { source: "Capital.com HOUR", calendar: "America/New_York 17:00", requested_from: new Date(from0).toISOString(), requested_to: new Date(rangeEnd).toISOString(), pages: read.pages, window_hours: read.span_hours, coverage: "requested_window_fetched", session_completeness: "unknown" };
      } else if (timeframe === "MN1" || timeframe === "W1") {
        // W1 is built from DAY so the Sunday session opens the new week (not the old one).
        // Bounded windows contain at most 900 calendar days, below the 1000-row ceiling.
        // Fetch every window even if one is empty (a listing can start later).
        const prices: unknown[] = [];
        let pages = 0;
        for (let from = rangeStart; from <= rangeEnd;) {
          const to = Math.min(rangeEnd, from + 900 * 86400_000 - 1000);
          const page = await readPage("DAY", 1000, { from: new Date(from).toISOString(), to: new Date(to).toISOString() });
          prices.push(...page.prices);
          pages++;
          from = to + 1000;
        }
        payload = { prices };
        aggregation = { source: "Capital.com DAY", calendar: "UTC", requested_from: new Date(rangeStart).toISOString(), requested_to: new Date(rangeEnd).toISOString(), pages, coverage: "requested_window_fetched", session_completeness: "unknown" };
      } else {
        payload = await readPage(HISTORY[timeframe].resolution, historyFetchReserve(fetchLimit));
      }
      const fetchedAt = Date.now();
      let quality: ReturnType<typeof normalizeCandles>;
      try {
        quality = normalizeCandles(payload, ny ? "H1" : timeframe === "MN1" || timeframe === "W1" ? "D1" : timeframe, fetchedAt);
        if (ny) {
          const tf = timeframe as "H4" | "D1";
          quality.candles = aggregateNy(quality.candles, tf, fetchedAt, Date.parse(aggregation!.requested_from), quality.rejected.map(row => row.time));
          quality.provider_times = [...new Set(quality.provider_times.map(time => new Date(bucketStart(Date.parse(time), tf, "ny")).toISOString()))].sort();
          quality.rejected = quality.rejected.map(row => row.time ? { ...row, time: new Date(bucketStart(Date.parse(row.time), tf, "ny")).toISOString() } : row);
        }
        else if (timeframe === "D1") quality.candles = mergeSundaySessions(quality.candles);
        if (timeframe === "W1") {
          quality.candles = aggregateWeeks(mergeSundaySessions(quality.candles.filter(bar => Date.parse(bar.time) >= rangeStart && Date.parse(bar.time) <= rangeEnd)), fetchedAt, quality.rejected.map(row => row.time));
          quality.provider_times = [...new Set(quality.provider_times.map(time => new Date(weekStart(Date.parse(time))).toISOString()))].sort();
        }
        if (timeframe === "MN1") {
          // Strict, bounded reconstruction of rejected D1 from actual closed H4.
          // Original raw capture remains unchanged; each attempt is recorded.
          const attempts:DailyRecovery[]=[],recovered=new Set<string>();
          const candidates=[...new Map(quality.rejected.filter(r=>r.reason==='crossed_sides'&&r.time&&Date.parse(r.time)>=rangeStart&&Date.parse(r.time)+86400_000<=fetchedAt&&!quality.candles.some(c=>c.time===r.time)).map(r=>[r.time,r])).values()].slice(0,4);
          for(const rejected of candidates){const day=rejected.time!;
            try{const raw=(payload as {prices:Record<string,unknown>[]}).prices.find(r=>typeof r.snapshotTimeUTC==='string'&&r.snapshotTimeUTC.slice(0,19)===day.slice(0,19));
              const detail=await readPage('HOUR_4',20,{from:new Date(Date.parse(day)-86400_000).toISOString(),to:new Date(Date.parse(day)+86400_000-1000).toISOString()});
              let result=recoverDaily(rejected,raw,quality.candles,detail,fetchedAt);
              if(result.record.reason==='INCOMPLETE_OR_INVALID_H4_DAY'){
                const hours=await readPage('HOUR',48,{from:new Date(Date.parse(day)-86400_000).toISOString(),to:new Date(Date.parse(day)+86400_000-1000).toISOString()});
                result=recoverDaily(rejected,raw,quality.candles,hours,fetchedAt,symbol);
              }
              attempts.push(result.record);
              if(result.candle){quality.candles.push(result.candle);recovered.add(day);}
            }catch(error){attempts.push({day,source:'Capital.com HOUR_4',status:'NOT_RECOVERED',reason:error instanceof CapitalApiError||error instanceof HistoryError?error.code:'RECOVERY_UNAVAILABLE',input_sha256:null});if(error instanceof CapitalApiError&&error.code==='CAPITAL_RATE_LIMIT')coolingUntil=Date.now()+Math.max(60,error.retryAfter??0)*1000;}
          }
          if(attempts.length&&aggregation)aggregation.reconstructions=attempts;
          quality.rejected=quality.rejected.filter(r=>!r.time||!quality.candles.some(c=>c.time===r.time));
          quality.candles = aggregateMonths(mergeSundaySessions(quality.candles).filter(bar => Date.parse(bar.time) >= rangeStart && Date.parse(bar.time) <= rangeEnd), fetchedAt, quality.rejected.map(row => row.time));
          quality.provider_times = [...new Set(quality.provider_times.map(time => new Date(monthStart(Date.parse(time))).toISOString()))].sort();
        }
      }
      catch { throw new HistoryError("CAPITAL_INVALID_RESPONSE", "Capital.com returned invalid candles", 502); }
      if (!quality.candles.length) throw new HistoryError("CANDLES_UNAVAILABLE", "No valid historical candles available for this instrument", 404, 0,
        historyDiagnostics(quality, [], timeframe, fetchedAt, fetchedAt, TTL_SECONDS));
      return {
        ok: true, symbol, epic, timeframe, provider: "Capital.com", environment,
        price_side: "bid_ask", fetched_at: new Date(fetchedAt).toISOString(), candles: quality.candles, quality, aggregation,
      };
    } catch (error) {
      if (error instanceof CapitalApiError && error.code === "CAPITAL_RATE_LIMIT") {
        const retryAfter = error.step==="authentication" ? Math.max(1,error.retryAfter??2) : Math.max(60, error.retryAfter ?? 0);
        coolingUntil = Date.now() + retryAfter * 1000;
        throw new HistoryError("CAPITAL_RATE_LIMIT", "Capital.com rate limit reached", 429, retryAfter);
      }
      if (error instanceof CapitalApiError && (error.status === 404 || (error.status === 400 && error.code === "CAPITAL_UPSTREAM"))) {
        throw new HistoryError("CANDLES_UNAVAILABLE", "Capital.com historical data is unavailable for this instrument", 404);
      }
      throw error;
    } finally { releaseLoad(); }
  }, Date.now(), refresh);
  const { quality, aggregation, ...data } = value;
  const candles = data.candles.slice(-limit);
  return { ...data, candles, metadata: {
    requested: limit, returned: candles.length, available: data.candles.length,
    insufficient_history: candles.length < limit,
    discarded_rows: quality.discarded_rows, discarded_sides: quality.discarded_sides,
    discarded_reasons: quality.discarded_reasons,
    duplicate_rows: quality.duplicate_rows, time_semantics: timeframe === "MN1" ? "calendar_month_start_utc" : ny ? "ny_close_bucket_start_utc" : "provider_bar_start_utc",
    grid: ny ? "ny" : timeframe === "MN1" ? "utc_calendar" : timeframe === "W1" ? "utc_week" : "utc",
    validation_gaps: [...new Set(quality.rejected.flatMap(row => row.time && !quality.candles.some(c => c.time === row.time) ? [row.time] : []))].sort(),
    closure_basis: timeframe === "MN1" ? "calendar_month_end_elapsed_at_fetch" : ny ? "bucket_end_elapsed_at_fetch" : "successor_or_nominal_interval_elapsed_at_fetch",
    ...(aggregation ? { aggregation } : {}),
    cache_ttl_seconds: TTL_SECONDS, cache_hit: hit,
    diagnostics: historyDiagnostics(quality, candles, timeframe, Date.parse(data.fetched_at), Date.now(), TTL_SECONDS),
  } };
}

// Provider max is a request ceiling, not a promise of that many valid rows.
// Bounded overfetch replaces the observed 191/200 D1 shortage with older REAL bars.
export function historyFetchReserve(limit:number){return Math.min(1000,Math.ceil(limit*1.35)+10);}
