import "server-only";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import type { ArchivedQuote } from "./tick-data";

type Row = { payload: string };
type Database = { query: (sql: string, values?: (string | number | null)[]) => Promise<Row[]>; close: () => Promise<void> };
let database: Promise<Database> | undefined;
export function archiveConfigured() { return Boolean(process.env.DATABASE_URL || (process.env.ARCHIVE_SQLITE_PATH && !process.env.VERCEL)); }

const schema = [
  `CREATE TABLE IF NOT EXISTS capital_ticks (id TEXT PRIMARY KEY, environment TEXT NOT NULL, symbol TEXT NOT NULL, source_type TEXT NOT NULL, provider_ms BIGINT, received_ms BIGINT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS capital_ticks_lookup ON capital_ticks (environment, symbol, provider_ms, received_ms)`,
  `CREATE INDEX IF NOT EXISTS capital_ticks_latest ON capital_ticks (environment, symbol, source_type, provider_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS capital_edges (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS capital_worker (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`,
];
async function connect(): Promise<Database> {
  let db: Database;
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000, statement_timeout: 5000 });
    pool.on("error", () => console.error({ event: "archive_pool_error" }));
    db = { query: async (sql, values = []) => (await pool.query(sql, values)).rows as Row[], close: () => pool.end() };
  } else if (process.env.ARCHIVE_SQLITE_PATH && !process.env.VERCEL) {
    const path = resolve(process.env.ARCHIVE_SQLITE_PATH);
    await mkdir(dirname(path), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(path);
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    db = { query: async (sql, values = []) => {
      // All SQL is static and placeholders occur in numerical order.
      const stmt = sqlite.prepare(sql.replace(/\$\d+/g, "?"));
      return stmt.all(...values) as Row[];
    }, close: async () => sqlite.close() };
  } else { throw new Error("ARCHIVE_NOT_CONFIGURED"); }
  try { for (const statement of schema) await db.query(statement); }
  catch (error) { await db.close(); throw error; }
  return db;
}
async function db() {
  if (!database) database = connect().catch(error => { database = undefined; throw error; });
  return database;
}
export async function closeArchive() { const current = database; database = undefined; if (current) await (await current).close(); }
export async function ensureArchive() { await db(); }

export async function saveQuote(quote: ArchivedQuote) {
  if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid > quote.ask
    || !Number.isFinite(Date.parse(quote.received_at_utc)) || !Number.isFinite(Date.parse(quote.fetched_at_utc))
    || (quote.provider_timestamp !== null && !Number.isFinite(Date.parse(quote.provider_timestamp)))) throw new Error("INVALID_ARCHIVE_QUOTE");
  const canonical = { ...quote, age_seconds: quote.provider_timestamp === null ? null : (Date.parse(quote.fetched_at_utc) - Date.parse(quote.provider_timestamp)) / 1000 };
  const payload = JSON.stringify(canonical);
  const id = createHash("sha256").update(payload).digest("hex");
  await (await db()).query(`INSERT INTO capital_ticks (id, environment, symbol, source_type, provider_ms, received_ms, payload) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [id, quote.environment, quote.symbol, quote.source_type, quote.provider_timestamp ? Date.parse(quote.provider_timestamp) : null, Date.parse(quote.received_at_utc), payload]);
}

export async function findQuote(symbol: string, environment: string, at: number, mode: "exact" | "before" | "known_before" | "latest_ws") {
  const filter = mode === "latest_ws" ? "source_type = 'WEBSOCKET' AND provider_ms <= $3"
    : mode === "exact" ? "provider_ms = $3" : "provider_ms <= $3";
  const values: (string | number)[] = [environment, symbol, at];
  if (mode === "known_before") values.push(at);
  const rows = await (await db()).query(`SELECT payload FROM capital_ticks WHERE environment = $1 AND symbol = $2 AND ${filter}${mode === "known_before" ? " AND received_ms <= $4" : ""} ORDER BY provider_ms DESC, received_ms ASC LIMIT 1`, values);
  return rows.length ? JSON.parse(rows[0].payload) as ArchivedQuote : null;
}

export async function saveWorkerStatus(environment: string, status: unknown) {
  await (await db()).query("INSERT INTO capital_worker (id, payload) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET payload = excluded.payload", [environment, JSON.stringify(status)]);
}
export async function readWorkerStatus(environment: string): Promise<unknown | null> {
  const rows = await (await db()).query("SELECT payload FROM capital_worker WHERE id = $1", [environment]);
  return rows.length ? JSON.parse(rows[0].payload) : null;
}
export async function saveEdgeOnce<T>(id: string, event: T): Promise<T> {
  await (await db()).query("INSERT INTO capital_edges (id, payload) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, JSON.stringify(event)]);
  const rows = await (await db()).query("SELECT payload FROM capital_edges WHERE id = $1", [id]);
  return JSON.parse(rows[0].payload) as T;
}
