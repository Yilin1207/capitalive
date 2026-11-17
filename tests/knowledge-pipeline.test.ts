import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildIntelligence,
  resolveHierarchy,
} from "../lib/knowledge/intelligence";
import { intelligenceHttp } from "../lib/knowledge/http";
import {encodeIntelligence,decodeIntelligence} from '../lib/knowledge/wire';
import { GET } from "../app/api/intelligence/route";
import { marketAudit } from "../lib/market-audit";
import catalog from "../knowledge/the-edge/catalog.json";
import { closedFrame } from "../lib/knowledge/data";
import {
  detectFractals,
  pivotLevels,
  selectRange,
  type KeyLevel,
} from "../lib/knowledge/detectors";
import { unavailable, type MarketQuote } from "../lib/quote-normalization";
import {
  knowledgeCoverage,
  searchKnowledge,
  provenance,
} from "../lib/knowledge/rules";
import type { CandleResponse, Timeframe } from "../lib/candle-data";
const fixture = () =>
  JSON.parse(readFileSync("tests/fixtures/htf-EURUSD.json", "utf8")) as {
    data: Record<Timeframe, CandleResponse>;
    quote: MarketQuote;
  };

test('V4 detail endpoint binds evidence to an as_of snapshot and returns only closed interactions',async()=>{
  const f=fixture(),deps={getCandles:async(_s:string,tf:Timeframe)=>f.data[tf],getAnalysisQuote:async()=>f.quote};
  const r=buildIntelligence(f.data,'bid',f.quote),id=r.levels.detected_levels[0].id;
  const query=new URLSearchParams({symbol:'EURUSD',side:'bid',as_of:r.as_of,level_id:id,evidence_sha256:r.narrative.human_review.evidence_sha256});
  const response=await intelligenceHttp(new Request(`https://local/api/intelligence?${query}`),deps as never),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.schema_version,'pa-evidence-v1');assert.equal(body.formation.id,id);
  assert.equal(body.interactions.omitted,0);assert.equal(body.interactions.total,body.interactions.events.length);
  for(const e of body.interactions.events){assert.ok(e.time>=body.formation.confirmed_at);assert.ok(e.confirmed_at<=r.as_of);}
  query.set('evidence_sha256','0'.repeat(64));assert.equal((await intelligenceHttp(new Request(`https://local/api/intelligence?${query}`),deps as never)).status,409);
  query.delete('evidence_sha256');query.set('level_id','missing');assert.equal((await intelligenceHttp(new Request(`https://local/api/intelligence?${query}`),deps as never)).status,404);
  query.set('as_of','2099-01-01T00:00:00.000Z');assert.equal((await intelligenceHttp(new Request(`https://local/api/intelligence?${query}`),deps as never)).status,400);
});
test("MN1/W1 context cannot be outvoted by H4; conflicting HTF KL stays neutral", () => {
  const { data } = fixture(),
    p = detectFractals(closedFrame(data.W1, "bid"))[0],
    base = pivotLevels([p])[0];
  const l = (
    id: string,
    timeframe: Timeframe,
    role: KeyLevel["role"],
  ): KeyLevel => ({ ...base, id, timeframe, role, lower: 1, upper: 2 });
  assert.equal(
    resolveHierarchy(
      [l("M", "MN1", "resistance"), l("H", "H4", "support")],
      1.5,
    ).candidate_bias,
    "Bearish",
  );
  assert.equal(
    resolveHierarchy(
      [l("M", "MN1", "resistance"), l("W", "W1", "support")],
      1.5,
    ).bias,
    "Neutral",
  );
  assert.equal(
    resolveHierarchy([l("H", "H4", "support")], 1.5).bias,
    "Neutral",
  );
});
test("recorded provider data: closed provenance, separate evidence/quality/risk, no trade probability", () => {
  const f = fixture(),
    r = buildIntelligence(f.data, "bid", f.quote);
  assert.deepEqual(r.pipeline, [
    "DATA_QUALITY",
    "MN1",
    "W1",
    "D1",
    "H4",
    "NARRATIVE",
    "EXECUTION",
    "RISK",
    "VERDICT",
  ]);
  assert.equal(r.assessment.probability_tp, null);
  assert.equal(r.risk.allowed, false);
  assert.equal(r.execution.order, null);
  assert.equal(r.journal.signal_input, false);
  const events = r.frames.flatMap((f) => f.findings);
  assert.ok(events.length > 0);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  for (const e of events) {
    assert.ok(
      e.rule_id &&
        e.sources.length &&
        e.invalidation &&
        e.counterarguments.length,
    );
    assert.ok(e.confirmed_at <= r.as_of);
    assert.ok(e.candle_evidence.every((c) => c.closed_at <= e.confirmed_at));
  }
  // The HTTP limit applies to the lossless wire representation, including V5.1 context.
  const wire=encodeIntelligence(r);
  assert.ok(Buffer.byteLength(JSON.stringify(wire)) < 4_250_000);
  assert.deepEqual(decodeIntelligence(wire),r);
  const noQuote = buildIntelligence(
    f.data,
    "bid",
    unavailable("EURUSD", "EURUSD"),
  );
  assert.deepEqual(noQuote.narrative, r.narrative);
  assert.equal(noQuote.data_quality.quote_used_as_closed_evidence, false);
});
test("incomplete/mixed datasets suppress narrative; Bid/Ask remain separate", () => {
  const f = fixture(),
    bid = buildIntelligence(f.data, "bid", f.quote),
    ask = buildIntelligence(f.data, "ask", f.quote);
  assert.notEqual(
    bid.data_quality.reference_price,
    ask.data_quality.reference_price,
  );
  assert.ok(
    ask.frames.flatMap((f) => f.findings).every((e) => e.side === "ask"),
  );
  f.data.MN1.candles = [];
  assert.equal(
    buildIntelligence(f.data, "bid", f.quote).verdict.status,
    "INSUFFICIENT_DATA",
  );
  const mixed = fixture();
  mixed.data.D1.symbol = "NAS100";
  assert.throws(()=>buildIntelligence(mixed.data, "bid", mixed.quote),/INVALID_DATASET_IDENTITY/);
});
test("historical prefix does not acquire signals or context from later OHLC", () => {
  const f = fixture(),
    asOf = f.data.H4.candles.at(-50)!.time;
  const full = buildIntelligence(f.data, "bid", f.quote, { as_of: asOf });
  for (const d of Object.values(f.data))
    d.candles = d.candles.filter((c) => c.time < asOf);
  const prefix = buildIntelligence(f.data, "bid", f.quote, { as_of: asOf });
  assert.deepEqual(prefix.frames, full.frames);
  assert.deepEqual(prefix.narrative, full.narrative);
  assert.deepEqual(prefix.levels, full.levels);
  assert.deepEqual(prefix.target_selection, full.target_selection);
});
test("explicit H4 pivot pair builds requested DR; wrong side/variant IDs reject", () => {
  const f = fixture(),
    frame = closedFrame(f.data.H4, "bid"),
    p = detectFractals(frame);
  let pair: { high_id: string; low_id: string } | undefined;
  for (const h of p.filter((p) => p.polarity === "high")) {
    const l = p.find(
      (l) =>
        l.polarity === "low" && l.segment === h.segment && l.price < h.price,
    );
    if (l) {
      pair = { high_id: h.id, low_id: l.id };
      break;
    }
  }
  assert.ok(pair);
  const r = buildIntelligence(f.data, "bid", f.quote, { ranges: { H4: pair } });
  assert.deepEqual(
    r.frames.find((f) => f.timeframe === "H4")!.range?.high_id,
    pair.high_id,
  );
  assert.equal(
    selectRange(
      closedFrame(f.data.H4, "ask"),
      detectFractals(closedFrame(f.data.H4, "ask")),
      pair,
    ).range,
    null,
  );
});
test("HTTP returns genuine analysis JSON and fails invalid parameters/provider errors explicitly", async () => {
  const f = fixture(),
    deps = {
      getCandles: async (_s: string, tf: Timeframe) => f.data[tf],
      getAnalysisQuote: async () => ({
        ...f.quote,
        cache_hit: false,
        evaluated_at: f.data.H4.fetched_at,
      }),
    };
  const ok = await intelligenceHttp(
    new Request("http://localhost/api/intelligence?symbol=EURUSD"),
    deps,
  );
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type")!, /application\/json/);
  assert.equal((await ok.json()).schema_version, "edge-knowledge-5");
  const invalid = await intelligenceHttp(
    new Request("http://localhost/api/intelligence?symbol=EURUSD&high_id=x"),
    deps,
  );
  assert.equal(invalid.status, 400);
  const provider = await intelligenceHttp(
    new Request("http://localhost/api/intelligence?symbol=EURUSD"),
    {
      ...deps,
      getCandles: async () => {
        throw new Error("offline");
      },
    },
  );
  assert.equal(provider.status, 502);
  assert.notEqual(
    GET,
    intelligenceHttp,
    "Next route context must not be interpreted as injected dependencies",
  );
});
test("catalog has 85 unique fetched metadata summaries, searchable rules and honest validation states", () => {
  const all = searchKnowledge();
  assert.equal(all.documents.length, 85);
  assert.equal(new Set(all.documents.map((d) => d.id)).size, 85);
  assert.ok(all.documents.every((d) => d.summary.length > 20 && !d.truncated));
  assert.ok(searchKnowledge("FVG").rules.length > 0);
  assert.equal(knowledgeCoverage().validated, 0);
  assert.equal(knowledgeCoverage().stale_rules.length, 0);
});
test("source revision change gates rule provenance and narrative until re-review", () => {
  const source = catalog.documents.find(
      (d) => d.id === "419e05dadd18817692d6efb4d9a1db5d",
    )!,
    old = source.revision;
  try {
    source.revision = "2026-12-01T00:00:00.000Z";
    assert.equal(
      provenance("EDGE.FRACTAL_3.v1").specification,
      "NEEDS_SPECIFICATION",
    );
    const f = fixture(),
      r = buildIntelligence(f.data, "bid", f.quote);
    assert.equal(r.verdict.status, "INSUFFICIENT_DATA");
    assert.ok(
      r.frames
        .flatMap((f) => f.findings)
        .filter((e) => e.rule_id === "EDGE.FRACTAL_3.v1")
        .every((e) => e.state === "NEEDS_SPECIFICATION"),
    );
  } finally {
    source.revision = old;
  }
});
test("market-audit retains 2.1 default and embeds knowledge only on explicit opt-in using the same OHLC", async () => {
  const f = fixture(),
    deps = {
      getCandles: async (_s: string, tf: Timeframe) => f.data[tf],
      getAnalysisQuote: async () => ({
        ...f.quote,
        cache_hit: false,
        evaluated_at: f.data.H4.fetched_at,
      }),
    };
  const plain = await marketAudit(
      new Request(
        "http://localhost/api/market-audit?symbol=EURUSD&view=priority",
      ),
      deps,
    ),
    a = await plain.json();
  assert.equal(plain.status, 200);
  assert.equal(a.knowledge_intelligence, undefined);
  const rich = await marketAudit(
      new Request(
        "http://localhost/api/market-audit?symbol=EURUSD&view=priority&knowledge=1",
      ),
      deps,
    ),
    b = await rich.json();
  assert.equal(rich.status, 200);
  assert.equal(b.knowledge_intelligence.symbol, "EURUSD");
  assert.equal(b.knowledge_intelligence.schema_version, "pa-engine-v6");
  assert.equal(b.knowledge_intelligence.mode, "PA_ONLY");
  assert.equal(b.knowledge_intelligence.narrative, undefined);
  assert.equal(b.knowledge_intelligence.narrative_method, undefined);
  assert.equal(b.knowledge_intelligence.target_selection, undefined);
  assert.equal(b.schema_version, a.schema_version);
  assert.deepEqual(b.analysis, a.analysis);
  assert.equal(
    (
      await marketAudit(
        new Request(
          "http://localhost/api/market-audit?symbol=EURUSD&knowledge=2",
        ),
        deps,
      )
    ).status,
    400,
  );
});
