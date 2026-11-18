import test from "node:test";
import assert from "node:assert/strict";
import { mergeSources, notionSource } from "../lib/knowledge/import";
const id = "a".repeat(32),
  page = {
    id,
    title: "Synthetic document",
    text: "<content>Test definition.</content>",
    page_last_edited_at: "2026-01-01T00:00:00Z",
  };
const editorial = {
  category: "Test",
  subcategory: "Synthetic",
  summary: "Original test summary, not market data.",
  text_review: "REVIEWED",
  images_reviewed: 0,
};
test("MCP import rejects search results, keeps no raw text and is idempotent/deduplicated", () => {
  assert.throws(() => notionSource({ id, title: "search hit" }, editorial));
  const d = notionSource(page, editorial);
  assert.ok(!("text" in d));
  assert.equal(mergeSources([], [d, d]).documents.length, 1);
  assert.equal(mergeSources([d], [d]).changes.length, 0);
  assert.throws(() => mergeSources([], [{ ...d, text: "private original" }]));
  assert.throws(() =>
    mergeSources([], [d, { ...d, summary: "conflicting duplicate" }]),
  );
});
test("revisions preserved and stale/partial source metadata remains explicit", () => {
  const a = notionSource(page, editorial),
    b = notionSource(
      { ...page, page_last_edited_at: "2026-02-01T00:00:00Z", truncated: true },
      editorial,
    );
  assert.equal(mergeSources([a], [b]).changes[0].requires_review, true);
  assert.equal(mergeSources([a], []).documents.length, 1);
  assert.throws(() => mergeSources([b], [a]));
});
