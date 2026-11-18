import { readFileSync } from "node:fs";
import { assessRisk } from "../lib/knowledge/risk";
// Read a user-supplied private ledger; never persist it or send it to a broker.
const path = process.argv[2];
if (!path)
  throw new Error("Usage: npm run knowledge:risk -- <private-ledger.json>");
const input = JSON.parse(readFileSync(path, "utf8"));
if (
  !input ||
  !Array.isArray(input.positions) ||
  input.positions.some((p: unknown) => !p || typeof p !== "object") ||
  !input.candidate ||
  typeof input.candidate !== "object" ||
  !input.policy ||
  typeof input.policy !== "object"
)
  throw new Error("Expected positions, candidate and policy objects");
console.log(
  JSON.stringify(
    assessRisk(input.positions, input.candidate, input.policy),
    null,
    2,
  ),
);
