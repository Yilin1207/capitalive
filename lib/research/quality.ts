import type {CandleResponse,Timeframe} from '../candle-data';
import type {MarketQuote} from '../quote-normalization';
import {calendarDiagnostics} from './calendars';
export function qualityDimensions(data:Record<Timeframe,CandleResponse>,quote:MarketQuote){return {
 frames:Object.fromEntries(Object.entries(data).map(([tf,d])=>[tf,{requested:d.metadata.requested,returned:d.candles.length,closed:d.candles.filter(c=>c.is_closed).length,insufficient_history:d.metadata.insufficient_history,partial_months:d.candles.filter(c=>c.history_completeness==='partial_validation').map(c=>c.time),discarded_reasons:d.metadata.discarded_reasons,aggregation:d.metadata.aggregation??null,calendar:calendarDiagnostics(d)}])),
 quote:{environment:quote.environment??null,bid:quote.bid,ask:quote.ask,spread:quote.bid!==null&&quote.ask!==null&&quote.ask>=quote.bid?quote.ask-quote.bid:null,provider_timestamp:quote.provider_timestamp??quote.quote_time,provider_timestamp_available:quote.provider_timestamp_available===true,fresh:quote.fresh,market_status:quote.market_status,used_for_historical_inference:false},
 provenance:{provider:'Capital.com',environments:[...new Set(Object.values(data).map(d=>d.environment))],demo_equals_live:'NOT_ESTABLISHED',ohlc_source:'BROKER_BID_ASK_NOT_EXCHANGE_TAPE',volume_evidence:'NONE',fetched_at_is_provider_quote_time:false},
 };}
