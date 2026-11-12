import { HISTORY, type Candle, type RejectedCandle, type Timeframe } from "./candle-data.ts";
import { monthStart } from "./monthly-candles";

type Observation = {
  provider_rows: number;
  provider_times: string[];
  rejected: RejectedCandle[];
};
export function periodStart(time: number, timeframe: Timeframe): number {
  if (timeframe === "MN1") return monthStart(time);
  if (timeframe !== "W1") return Math.floor(time / (HISTORY[timeframe].seconds * 1000)) * HISTORY[timeframe].seconds * 1000;
  const date = new Date(time);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.getTime();
}

// Absence on a nominal UTC grid is not proof of a provider outage: weekends,
// market sessions and holidays are deliberately NOT inferred from price history.
export function historyDiagnostics(
  observation: Observation, candles: Candle[], timeframe: Timeframe,
  fetchedAt: number, evaluatedAt: number, ttlSeconds: number,
) {
  const currentTime = new Date(periodStart(evaluatedAt, timeframe)).toISOString();
  const accepted = new Set(candles.map(candle => candle.time));
  const providerTimes = observation.provider_times.filter(time => Date.parse(time) <= fetchedAt);
  const provider = new Set(providerTimes);
  const currentRejected = observation.rejected.filter(row => row.time === currentTime);
  const currentStatus = accepted.has(currentTime) ? "present"
    : Date.parse(currentTime) > fetchedAt ? "not_yet_fetched"
    : provider.has(currentTime) ? "filtered_by_validation" : "not_in_provider_response";
  // Report omissions in the returned window, including a filtered trailing bar.
  const windowStart = candles[0]?.time ?? providerTimes[0] ?? currentTime;
  const rejectedInWindow = observation.rejected.filter(row => row.time !== null && row.time >= windowStart && row.time <= currentTime);
  const missingFiltered = [...new Set(rejectedInWindow.map(row => row.time!))].filter(time => !accepted.has(time)).sort();
  const gaps: { from: string; to: string; count: number; reason: "not_in_provider_response" }[] = [];
  const interval = HISTORY[timeframe].seconds * 1000;
  if (timeframe === "MN1") {
    for (let cursor = monthStart(Date.parse(windowStart)); cursor <= Date.parse(currentTime); cursor = monthStart(cursor, 1)) {
      const time = new Date(cursor).toISOString();
      if (!provider.has(time) && cursor <= fetchedAt) gaps.push({ from: time, to: time, count: 1, reason: "not_in_provider_response" });
    }
  }
  for (let i = 1; timeframe !== "MN1" && i < providerTimes.length; i++) {
    const previous = Date.parse(providerTimes[i - 1]);
    const next = Date.parse(providerTimes[i]);
    const first = Math.max(previous + interval, Date.parse(windowStart));
    // Retain the provider's phase. Do not invent midnight bars for a shifted session.
    const from = previous + Math.max(1, Math.ceil((first - previous) / interval)) * interval;
    const count = Math.max(0, Math.ceil((next - from) / interval));
    if (count) gaps.push({ from: new Date(from).toISOString(), to: new Date(from + (count - 1) * interval).toISOString(), count, reason: "not_in_provider_response" });
  }
  // A newest bar absent from both provider and output must not disappear from diagnostics.
  const latest = providerTimes.at(-1);
  if (timeframe !== "MN1" && latest && latest < currentTime && Date.parse(currentTime) <= fetchedAt) {
    const from = Math.max(Date.parse(latest) + interval, Date.parse(windowStart));
    const count = Math.max(0, Math.floor((Date.parse(currentTime) - from) / interval) + 1);
    if (count) gaps.push({ from: new Date(from).toISOString(), to: new Date(from + (count - 1) * interval).toISOString(), count, reason: "not_in_provider_response" });
  }
  const sample = observation.rejected.filter(row => row.time === null || row.time >= windowStart)
    .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
  const age = Math.max(0, (evaluatedAt - fetchedAt) / 1000);
  return {
    evaluated_at: new Date(evaluatedAt).toISOString(),
    retrieval_age_seconds: Math.round(age * 1000) / 1000,
    retrieval_status: age <= ttlSeconds ? "recent" as const : "expired" as const,
    price_update_freshness: "unknown_bar_start_is_not_last_tick" as const,
    provider_rows: observation.provider_rows,
    latest_provider_bar_time: latest ?? null,
    latest_returned_bar_time: candles.at(-1)?.time ?? null,
    current_period: { time: currentTime, status: currentStatus, rejected: currentRejected.slice(0, 4) },
    forming_bars: candles.filter(candle => !candle.is_closed).map(candle => candle.time),
    window_start: windowStart,
    missing_filtered_count: missingFiltered.length,
    missing_filtered_times: missingFiltered.slice(-20),
    rejected_rows: sample.slice(0, 20),
    rejected_rows_omitted: Math.max(0, sample.length - 20),
    provider_gap_slots: gaps.reduce((sum, gap) => sum + gap.count, 0),
    provider_gaps: gaps.slice(-20),
    provider_gap_ranges_omitted: Math.max(0, gaps.length - 20),
    gap_interpretation: "nominal_intervals_only_market_hours_not_checked" as const,
    counts_do_not_prove_continuity: true as const,
  };
}
export type HistoryDiagnostics = ReturnType<typeof historyDiagnostics>;
