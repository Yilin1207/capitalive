import {ACTIVE_RESEARCH_SYMBOLS} from './active-research-markets';

/** Static API map for external AI clients. Every URL is absolute so a fetch-only agent can follow it. */
export function agentIndex(origin:string){
 const q=(path:string,params:Record<string,string>)=>`${origin}${path}?${new URLSearchParams(params)}`;
 const markets=Object.fromEntries(ACTIVE_RESEARCH_SYMBOLS.map(symbol=>[symbol,{
  brief:q('/api/brief',{symbol}),
  brief_ask:q('/api/brief',{symbol,side:'ask'}),
  desk_report:q('/api/desk-report',{symbol}),
  market_context:q('/api/desk-report',{symbol,view:'market-context'}),
  evidence_h4:q('/api/pa-evidence',{symbol,timeframe:'H4',limit:'50'}),
  evidence_d1:q('/api/pa-evidence',{symbol,timeframe:'D1',limit:'50'}),
  candles_h4:q('/api/pa-candles',{symbol,timeframe:'H4',limit:'200'}),
  candles_d1:q('/api/pa-candles',{symbol,timeframe:'D1',limit:'200'}),
  structure_h4:q('/api/pa-evidence',{symbol,view:'structure',timeframe:'H4'}),
 }]));
 return {
  service:'Capitalive',schema_version:'agent-index-v1',mode:'PA_ONLY',trading_enabled:false,
  description:'Technical Price Action evidence (THE EDGE rules) from Capital.com Bid/Ask CFD candles on closed MN1/W1/D1/H4 bars. No narrative, direction, entries, stops, targets, probabilities or scores.',
  start_here:'Fetch markets.<SYMBOL>.brief first. It has the quote, freshness, per-timeframe last closed candles, dealing range, nearest active levels and recent fractals, each with absolute drill-down URLs.',
  symbols:[...ACTIVE_RESEARCH_SYMBOLS],timeframes:['MN1','W1','D1','H4'],price_sides:['bid','ask'],
  markets,
  docs:`${origin}/llms.txt`,
  rules:[
   'Use status/freshness before using any observation: STALE or ERROR means observations are withheld.',
   'quote is a live price, never closed-candle evidence.',
   'Levels are ordered by distance to the last closed H4 close, not by significance.',
   'Follow links.next for pagination; pages are pinned by snapshot_sha256. On 409 SNAPSHOT_CHANGED refetch the brief.',
   'Errors include diagnostic.message explaining what to fix.',
  ],
 };
}

export function llmsText(origin:string){
 const index=agentIndex(origin);
 const market=(s:string)=>{const m=index.markets[s];return `### ${s}
- Brief (start here): ${m.brief}
- Brief, Ask side: ${m.brief_ask}
- Full desk report (≤64 KB): ${m.desk_report}
- Market context (VIX CFD, client sentiment, realized volatility): ${m.market_context}
- All H4 findings: ${m.evidence_h4}
- All D1 findings: ${m.evidence_d1}
- H4 closed candles: ${m.candles_h4}
- D1 closed candles: ${m.candles_d1}
- H4 structure (fractal/swing sequence, dealing ranges): ${m.structure_h4}`;};
 return `# Capitalive

> ${index.description}

Public, read-only, no login. JSON over HTTPS GET. CORS open.

## How to use (for AI agents)
1. Fetch the brief for the symbol you need (below). It is compact (at most 64 KB, all four timeframes) and every item has absolute URLs.
2. Check "status" and "freshness" first. PARTIAL = normal (provider data has known limitations listed in "warnings"). STALE or ERROR = observations are withheld; do not invent them.
3. "quote" is a live Bid/Ask price and is never closed-candle evidence. Evidence uses only fully closed candles.
4. "timeframes.<TF>.levels" lists the nearest non-invalidated levels above/below the last closed H4 close (FRACTAL — a raided fractal stays listed with state CONSUMED: its liquidity is taken but the zone remains, per Notion "Fractal Raid"; FVG unfilled remainder; RB; SNR). Order = distance only, not significance. One formation (same kind, timeframe, formation candles and bounds) observed at several known key levels is one row: "ids" = all its evidence ids, "contexts" = the key levels it was observed at, "formation_status" = CONFIRMED or NEEDS_SPECIFICATION. The 5-per-side limit counts these grouped rows.
4a. Per level: "distance_atr_d1" (distance / "atr_d1".value, a unit only), "nested_in" (live higher-TF RB/SNR/FVG zones that contain the level), "kl_events" (closed candles of the level TF and lower TFs after formation: TOUCH closed inside, REJECTION closed back beyond the near edge, ACCEPTANCE closed beyond the far edge, RAID fractal wick beyond with close back; "own_tf_counts" + "last").
4b. Per timeframe: "dealing_range.premium_discount" (high, low, eq, price_position_pct 0=low 100=high, zone PREMIUM/DISCOUNT/EQ/ABOVE_RANGE/BELOW_RANGE, confirmed, selection AUTOMATIC_CANDIDATE or EXPLICIT_IDS); "approach" (bars_without_correction, move_atr_d1, overlapping_body_pairs, contracting_ranges, nearest_level_on_path; flag stays NOT_EVALUATED until thresholds are approved); "strong_fractals" (THE EDGE Strong High/Low facts, flags VC_AT_FRACTAL and RAIDED_PRIOR_FRACTAL); "fractals_inside_kl" (geometric containment in a KL; see thesis_inputs.execution for IDM in an active DR).
4c. "thesis_inputs" groups closed facts into location, strength (D1/W1), opposite_side (dated KL events and formations), and execution (internal fractals, movement origins, obstacles on both sides). Check the as_of timestamp. The highest applicable range has HTF priority. A tested SNR keeps its formation side until a close beyond the far edge; fully filled FVG has no active remainder.
4d. A single brief stays under 64 KiB: "omitted.fact_details_size_trimmed" names trimmed details; the symbols= batch keeps them (200 000 bytes per asset).
5. Drill down only by following URLs from responses: level "urls" (one per evidence id in "ids"; full evidence + interaction history), fractal "url", "links.evidence" / "links.candles" / "links.structure", and "links.next" for the next page.
6. Pages are pinned to "snapshot_sha256". HTTP 409 SNAPSHOT_CHANGED = new closed candles arrived; refetch the brief.
7. Any error JSON has "error" (code) and "diagnostic.message" (what to fix). HTTP 429 = wait "Retry-After" seconds.

Capitalive never produces narrative, direction, A/B/C, entry, stop, target, RR, probabilities or scores ("trading_enabled": false). Interpretation is up to you and the user. Fields marked NEEDS_SPECIFICATION / NOT_EVALUATED / DISABLED are deliberately not computed.

## Markets
${index.symbols.map(market).join('\n\n')}

## Parameters
- symbol: ${index.symbols.join(' | ')}
- side: bid (default) | ask
- timeframe: MN1 | W1 | D1 | H4
- grid: ny (default; H4 and D1 close at 17:00 America/New_York, DST-aware, built from Capital.com HOUR bars; Sunday 17:00 ET opens Monday's D1) | utc (provider UTC grid: H4 00/04/08..., D1 00:00 UTC). W1 = Sunday-open to Friday-close week, MN1 = UTC calendar month on both grids. "grid.by_tf" in every response states the grid actually used per timeframe.
- pa-evidence filters: kind (FRACTAL, FVG, RAID, TOUCH, RB_TWO_CANDLE, SNR_CLOSED_BREAK, FRACTAL_INSIDE_POI, DEALING_RANGE, PREMIUM_DISCOUNT), lifecycle (ACTIVE, CONSUMED, TESTED, BROKEN, INVALIDATED, UNVERIFIED, CANDIDATE, FILLED, PARTIALLY_FILLED), min_price, max_price, from, to, id, limit (1-50), view=structure|interactions|thesis; use the brief links thesis_events_d1/w1 or thesis_idm_<tf> and follow links.next. Thesis sections: idm, kl_events, new_rb, new_snr, new_fractal3, strong_near_price
- brief: latest=N (last N closed candles per TF, 1-50, default 5); symbols=NAS100,EU50,EURUSD returns all briefs in one response ("briefs".<SYMBOL>, "results".<SYMBOL>.http_status/snapshot_sha256, "batch_sha256"), loaded one after another on the server - use it instead of parallel requests. A failed symbol stays visible as its error; status = worst symbol status.
- pa-candles: timeframe, from, to, limit (1-200), latest=N (last N closed candles, 1-200, without offset/limit)
- Contract specifications (Capital.com Demo, read-only, no account data): ${origin}/api/research-source?symbol=NAS100&mode=market - instrument.lotSize, instrument.marginFactor + marginFactorUnit, instrument.currency, dealingRules.minDealSize / minSizeIncrement / maxDealSize. Point value is not a separate provider field.
- Times are UTC: 2026-11-01, 2026-11-01T00:00:00Z or 2026-11-01T00:00:00.000Z

## Index
- JSON version of this page: ${origin}/api
- Service health: ${origin}/api/health
`;
}
