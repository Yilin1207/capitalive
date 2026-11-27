// Synthetic contract transport fixture, not market data or an expert label.
export function syntheticDeskReport(symbol='EURUSD'){
  const start='2026-11-15T00:00:00.000Z',confirmed='2026-11-15T12:00:00.000Z',now='2026-11-15T14:00:00.000Z';
  const group=()=>({items:[] as string[],total:0,omitted:0});
  const evidence=Object.fromEntries(['high','low'].map((polarity,i)=>[`e${i}`,{
    id:`${symbol}:H4:bid:FRACTAL:2026-11-15T08:00:00.000Z:3:${polarity}:2026-11-15T04:00:00.000Z`,timeframe:'H4',kind:'FRACTAL',origin:start,confirmed_at:confirmed,
    lower:i?1.1:1.2,upper:i?1.1:1.2,variant:3,polarity,direction:null,detector_state:'OBSERVED',data_status:'PARTIAL',rule:'EDGE.FRACTAL_3.v1',candle_refs:[0,1,2],candle_evidence_sha256:'0'.repeat(64),dependencies:[],lifecycle:null}]));
  const frames=['MN1','W1','D1','H4'].map((timeframe,i)=>({timeframe,fetched_at:now,last_closed_at:['2026-11-01T00:00:00.000Z','2026-11-09T00:00:00.000Z',start,confirmed][i],closed_candles:3,data_status:'PARTIAL',warnings:[],discarded_rows:0,
    structure:{bias:'Neutral',events:group(),swing_bias:'Neutral',swing_basis:'NEEDS_SPECIFICATION',swing_evidence:[]},fractals:[3].flatMap(variant=>['high','low'].map(polarity=>({variant,polarity,...group()}))),
    snr:group(),rb:group(),fvg:group(),ifvg:group(),liquidity:{raids:group(),idm:group(),strong:group(),irl:group()},dealing_range:null,range_status:'EXPLICIT_SELECTION_REQUIRED',
    range_candidate:timeframe==='H4'?{high:'e0',low:'e1',lower:1.1,upper:1.2,equilibrium:1.15,confirmed_at:confirmed,method:'LATEST_FRACTAL3_PROJECT_CANDIDATE',review_required:true}:null}));
  return {schema_version:'desk-report-v2',symbol,status:'PARTIAL',generated_at:now,as_of:now,expires_at:'2026-11-15T14:02:00.000Z',error:null,published_at:null as string|null,
    freshness:{quote_retrieved_at:now,quote_status:'FRESH',data_quality:'PARTIAL',stale_reasons:[] as string[],quote_max_seconds:120,h4_max_delay_seconds:600,h4_delay_seconds:0,source_age_seconds:0,delivery_max_seconds:120},
    source:{provider:'Capital.com',environment:'demo',analysis_schema:'edge-knowledge-5',price_side:'bid',engine_commit:null,evidence_sha256:'0'.repeat(64),demo_live_equivalence:'NOT_ESTABLISHED',full_ohlc_published:false},
    quote:{bid:1.15,ask:1.1501,spread:0.0001,provider_timestamp:now,retrieved_at:now,source_type:'REST',market_status:'TRADEABLE',provider_age_seconds:0,fresh:true,used_as_closed_evidence:false},frames,
    scenario:{candidate_narrative:'Neutral',confirmed_narrative:null,status:'REVIEW_REQUIRED',evidence_quality:{status:'PARTIAL',human_reviewed:false,independently_validated:false,probability:null},
      A:{selected:null,...group()},B:{selected:null,validated:null,status:'TARGET_UNVERIFIED',...group(),role_eligible:0},C:null,invalidations:{entry:null,KL:false,narrative:false},blockers:[],action:'WAIT'},
    evidence,rules:{'EDGE.FRACTAL_3.v1':{version:1,status:'TESTED',specification:'EXECUTABLE',basis:'DOCUMENTED',source_revisions:[]}},
    candle_windows:[[start,'2026-11-15T04:00:00.000Z'],['2026-11-15T04:00:00.000Z','2026-11-15T08:00:00.000Z'],['2026-11-15T08:00:00.000Z',confirmed]],
    coverage:{selection_policy:'RECENT_PER_CATEGORY_PLUS_ENGINE_SCENARIO_AND_REFERENCED_DEPENDENCIES',findings_total:2,findings_included:2,findings_omitted:0,selected_evidence_complete:true,all_findings_included:true,stale_reasons:[],raw_ohlc_included:false},trading_enabled:false};
}

export function syntheticContextReport(symbol='EURUSD'){
  const r=syntheticDeskReport(symbol);
  return {...r,research_context:{revision:'context-5.1',review_required:true,author_structure:{status:'NEEDS_SPECIFICATION',reason:'AUTHOR_SIGNIFICANCE_NOT_DEFINED'},candidate_narrative:'Neutral',confirmed_narrative:null,
    observed_price_behaviour:r.frames.map(f=>({timeframe:f.timeframe,reference_close:null,reference_at:null,last_close_change:null,last_observed_fractal_leg:null,significance:'NOT_ASSESSED',trend_confirmed:false,evidence_ids:[]})),
    executive_evidence:{items:[],total:0,omitted:0,selection_policy:'SYNTHETIC_EMPTY_CONTEXT'},conflicts:[],
    dealing_range_reviews:r.frames.map(f=>({timeframe:f.timeframe,selected:null,candidates:{items:[],total:0,omitted:0}})),paths:[],
    full_inspection:{path:'/api/intelligence',mode:'inspection',snapshot_sha256:r.source.evidence_sha256,as_of:r.as_of,requires_authorization:true}}};
}
