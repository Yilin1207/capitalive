import CandleChart from "@/app/candle-chart";
import { PUBLIC_SYMBOLS, VERIFIED_MARKETS } from "@/lib/capital";
import "./market-feed.css";

export default function Home() {
  return (
    <main>
      <div className="eyebrow">MARKET DATA · READ ONLY</div>
      <h1>Capitalive 2.0</h1>
      <p className="intro">Свечи Capital.com: MN1 · W1 · D1 · H4. Фракталы, диапазоны и FVG для EURUSD, NAS100 и EU50.</p>
      <CandleChart instruments={PUBLIC_SYMBOLS.map(symbol => ({ symbol, name: VERIFIED_MARKETS[symbol].name }))} />
      <nav className="api-links" aria-label="Public API">
        <a href="/api/quotes">GET /api/quotes</a>
        <a href="/api/candles?symbol=NAS100&timeframe=H4&limit=200">GET /api/candles</a>
        <a href="/api/structure?symbol=NAS100&w1=20&d1=30&h4=40">GET /api/structure</a>
        <a href="/api/market-audit?symbol=EURUSD">GET /api/market-audit</a>
        <a href="/api/chart?symbol=EURUSD&timeframe=H4">GET /api/chart · PNG</a>
        <a href="/api/markets">GET /api/markets</a>
        <a href="/api/health">GET /api/health</a>
      </nav>
      <footer>Source: Capital.com Public API · Lightweight Charts™ by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a>.<br />
        TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.
      </footer>
    </main>
  );
}
