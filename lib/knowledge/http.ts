import "server-only";
import { getCandles, HistoryError } from "../candles";
import { getAnalysisQuote } from "../analysis-quote";
import { analysisParams } from "../analysis-http";
import {
  checkHistoryRequest,
  historyJson,
  historyFailure,
} from "../history-http";
import { HISTORY, type CandleResponse, type Timeframe } from "../candle-data";
import { buildIntelligence, type IntelligenceOptions } from "./intelligence";
import {reviewErrors,type HumanReview} from './human-review';
import {encodeIntelligence} from './wire';
import { TF_ORDER } from "./detectors";
import {closedFrame,type Frame} from './data';import {interactionHistory} from './interaction-history';
export async function intelligenceHttp(
  request: Request,
  dependencies = { getCandles, getAnalysisQuote },
) {
  try {
    checkHistoryRequest(request);
    const params = new URL(request.url).searchParams;
    const levelId=params.get('level_id');
    if(levelId!==null&&(!levelId||levelId.length>1600))throw new HistoryError('INVALID_LEVEL_ID','Expected an evidence ID',400);
    const evidenceHash=params.get('evidence_sha256');
    if(evidenceHash!==null&&!/^[a-f0-9]{64}$/.test(evidenceHash))throw new HistoryError('INVALID_EVIDENCE_HASH','Expected SHA-256',400);
    const requestedAsOf=params.get('as_of');
    if(requestedAsOf!==null&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(requestedAsOf)||!Number.isFinite(Date.parse(requestedAsOf))||Date.parse(requestedAsOf)>Date.now()))throw new HistoryError('INVALID_AS_OF','Expected historical UTC timestamp',400);
    let review:HumanReview|undefined;
    if(request.method==='POST'){
      const text=await request.text();if(Buffer.byteLength(text)>24_000)throw new HistoryError('REVIEW_TOO_LARGE','Review exceeds 24 KB',413);
      let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new HistoryError('INVALID_REVIEW','Expected JSON review',400);}
      const errors=reviewErrors(parsed);if(errors.length)throw new HistoryError('INVALID_REVIEW',errors.join('; '),400);review=parsed as HumanReview;
    }
    const { symbol, side } = analysisParams(
      new URLSearchParams({
        symbol: params.get("symbol") ?? "NAS100",
        side: params.get("side") ?? "bid",
      }),
    );
    const high = params.get("high_id"),
      low = params.get("low_id");
    const target = params.get("target_id");
    const anchor=params.get('anchor_id');if(anchor!==null&&(!anchor||anchor.length>500))throw new HistoryError('INVALID_ANCHOR_SELECTION','anchor_id must contain 1-500 characters',400);
    const ranges:NonNullable<IntelligenceOptions['ranges']>={};
    for(const tf of TF_ORDER){const h=params.get(tf==='H4'?'high_id':`${tf.toLowerCase()}_high_id`),l=params.get(tf==='H4'?'low_id':`${tf.toLowerCase()}_low_id`);if(h!==null||l!==null){if(!h||!l||h.length>500||l.length>500)throw new HistoryError('INVALID_RANGE_SELECTION',`Both ${tf} pivot IDs required`,400);ranges[tf]={high_id:h,low_id:l};}}
    if(target !== null && (!target || target.length > 500))
      throw new HistoryError("INVALID_TARGET_SELECTION", "target_id must contain 1–500 characters", 400);
    if (
      (high !== null || low !== null) &&
      (!high || !low || high.length > 500 || low.length > 500)
    )
      throw new HistoryError(
        "INVALID_RANGE_SELECTION",
        "Both high_id and low_id are required",
        400,
      );
    const data = {} as Record<Timeframe, CandleResponse>;
    for (const tf of TF_ORDER)
      data[tf] = await dependencies.getCandles(symbol, tf, HISTORY[tf].limit);
    const quote = await dependencies.getAnalysisQuote(symbol),
      body = buildIntelligence(data, side, quote, {
        ...(requestedAsOf?{as_of:requestedAsOf}:{}),
        ...(anchor?{anchor_id:anchor}:{}),
        ...(review?{human_review:review,as_of:review.as_of}:{}),
        ...(target ? {target_id:target} : {}),
        ranges,
      });
    if(review&&body.narrative.human_review.evidence_sha256!==review.evidence_sha256)throw new HistoryError('STALE_REVIEW_EVIDENCE','Closed data, selections or source revisions changed; reload and review again',409);
    if(evidenceHash&&body.narrative.human_review.evidence_sha256!==evidenceHash)throw new HistoryError('SNAPSHOT_CHANGED','Evidence belongs to another snapshot; do not combine the responses',409);
    for(const tf of TF_ORDER)if(ranges[tf]&&body.frames.find(f=>f.timeframe===tf)?.range_blocker)throw new HistoryError('INVALID_RANGE_SELECTION',`Invalid closed ${tf} pivot pair`,400);
    if(anchor&&body.narrative.A?.id!==anchor)throw new HistoryError('INVALID_ANCHOR_SELECTION','Selected A must be an active qualified MN1/W1 level',400);
    if (high && body.frames.find((f) => f.timeframe === "H4")?.range_blocker)
      throw new HistoryError(
        "INVALID_RANGE_SELECTION",
        "IDs must identify valid closed H4 knowledge pivots on the selected price side",
        400,
      );
    if(levelId){
      const level=body.levels.detected_levels.find(l=>l.id===levelId),formation=body.frames.flatMap(f=>f.findings).find(f=>f.id===levelId),state=body.levels.states.find(s=>s.id===levelId);
      if(!level||!formation||!state)throw new HistoryError('LEVEL_NOT_IN_SNAPSHOT','Requested level is not present in this snapshot',404);
      const frames=Object.fromEntries(TF_ORDER.map(tf=>[tf,closedFrame(data[tf],side,body.as_of)])) as Record<Timeframe,Frame>;
      return historyJson({ok:true,schema_version:'pa-evidence-v1',symbol,price_side:side,as_of:body.as_of,evidence_sha256:body.narrative.human_review.evidence_sha256,formation,state,
        interactions:interactionHistory({...level,side,role:level.initial_role,source_finding:formation,qualified:formation.state==='OBSERVED'},frames,body.as_of)});
    }
    const wire=encodeIntelligence(body);
    if (Buffer.byteLength(JSON.stringify(wire)) > 4_250_000)
      throw new HistoryError(
        "INTELLIGENCE_RESPONSE_TOO_LARGE",
        "No evidence was dropped; use a smaller local dataset for complete offline analysis",
        503,
      );
    return historyJson(wire);
  } catch (error) {
    return historyFailure(error);
  }
}
