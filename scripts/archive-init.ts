import { closeArchive, ensureArchive } from "../lib/archive";

async function main() {
  try {
    await ensureArchive();
    console.info(JSON.stringify({ archive: "ready", schema_initialized: true }));
  } finally { await closeArchive(); }
}
main().catch(() => { console.error("Archive initialization failed; check database configuration/connectivity."); process.exitCode = 1; });
