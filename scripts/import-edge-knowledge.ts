import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { mergeSources, type SourceRecord } from "../lib/knowledge/import";
const args = process.argv.slice(2),
  input = args.find((a) => !a.startsWith("--"));
if (!input)
  throw new Error(
    "Usage: npm run knowledge:import -- <reviewed-mcp-manifest.json> [--apply]",
  );
const path = resolve("knowledge/the-edge/catalog.json"),
  previous = JSON.parse(readFileSync(path, "utf8"));
const payload = JSON.parse(readFileSync(resolve(input), "utf8"));
if (!Array.isArray(payload.documents))
  throw new Error(
    "Expected a reviewed documents array; raw texts are forbidden",
  );
const result = mergeSources(
  previous.documents as SourceRecord[],
  payload.documents,
);
const report = {
  dry_run: !args.includes("--apply"),
  count: result.documents.length,
  changes: result.changes,
  checksum: result.checksum,
};
if (args.includes("--apply") && result.changes.length) {
  const lock = `${path}.lock`,
    fd = openSync(lock, "wx");
  try {
    const current = JSON.parse(readFileSync(path, "utf8"));
    if (JSON.stringify(current) !== JSON.stringify(previous))
      throw new Error("Catalog changed concurrently; retry");
    mkdirSync("knowledge/the-edge/revisions", { recursive: true });
    const old = mergeSources([], previous.documents),
      oldPath = resolve(`knowledge/the-edge/revisions/${old.checksum}.json`);
    if (!existsSync(oldPath))
      writeFileSync(oldPath, JSON.stringify(previous, null, 2) + "\n", {
        flag: "wx",
      });
    const next = {
      ...previous,
      imported_at: new Date().toISOString(),
      documents: result.documents,
    };
    writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2) + "\n");
    renameSync(`${path}.tmp`, path);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
console.log(JSON.stringify(report, null, 2));
