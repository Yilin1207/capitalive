export default function Home() {
  return (
    <main>
      <h1>Capital.com Market Feed</h1>
      <p>
        <a href="/api/quotes">GET /api/quotes</a>
      </p>
      <p>
        <a href="/api/markets">GET /api/markets</a>
      </p>
      <p>
        <a href="/api/health">GET /api/health</a>
      </p>
      <p>Source: Capital.com Public API</p>
    </main>
  );
}
