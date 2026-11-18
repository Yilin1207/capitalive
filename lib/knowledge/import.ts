import { createHash } from "node:crypto";
export type SourceRecord = {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  url: string;
  revision: string;
  source_status: string;
  text_review: string;
  summary: string;
  related_ids: string[];
  image_count: number;
  images_reviewed: number;
  content_characters: number;
  truncated: boolean;
  unknown_block_count: number;
};
const fields = [
  "id",
  "title",
  "category",
  "subcategory",
  "url",
  "revision",
  "source_status",
  "text_review",
  "summary",
  "related_ids",
  "image_count",
  "images_reviewed",
  "content_characters",
  "truncated",
  "unknown_block_count",
];
const idPattern = /^[a-f0-9]{32}$/;
export function validateSource(value: unknown): SourceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid source record");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((k) => !fields.includes(k)))
    throw new Error(
      "Unexpected field: raw Notion content is not accepted in the public catalog",
    );
  for (const key of [
    "id",
    "title",
    "category",
    "subcategory",
    "url",
    "revision",
    "source_status",
    "text_review",
    "summary",
  ])
    if (typeof p[key] !== "string") throw new Error(`Invalid ${key}`);
  const d = p as unknown as SourceRecord;
  if (
    !idPattern.test(d.id) ||
    d.url !== `https://app.notion.com/p/${d.id}` ||
    !Number.isFinite(Date.parse(d.revision)) ||
    !d.title ||
    d.title.length > 300 ||
    !d.summary ||
    d.summary.length > 700 ||
    /notion-file-block:|<image|X-Amz-|Bearer\s|BEGIN .*PRIVATE KEY/i.test(
      d.summary,
    )
  )
    throw new Error("Invalid metadata or unsafe summary");
  if (
    !Array.isArray(d.related_ids) ||
    d.related_ids.some((id) => typeof id !== "string" || !idPattern.test(id))
  )
    throw new Error("Invalid relations");
  for (const n of [
    d.image_count,
    d.images_reviewed,
    d.content_characters,
    d.unknown_block_count,
  ])
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("Invalid coverage count");
  if (
    d.images_reviewed > d.image_count ||
    typeof d.truncated !== "boolean" ||
    !["FETCHED", "UNAVAILABLE"].includes(d.source_status)
  )
    throw new Error("Invalid source state");
  return { ...d, related_ids: [...new Set(d.related_ids)].sort() };
}
export function mergeSources(previous: SourceRecord[], incoming: unknown[]) {
  const byId = new Map(previous.map((d) => [d.id, validateSource(d)])),
    seen = new Map<string, SourceRecord>(),
    changes: {
      id: string;
      from: string | null;
      to: string;
      requires_review: boolean;
    }[] = [];
  for (const raw of incoming) {
    const d = validateSource(raw),
      duplicate = seen.get(d.id);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(d))
        throw new Error(`Conflicting duplicate ${d.id}`);
      continue;
    }
    seen.set(d.id, d);
    const old = byId.get(d.id);
    if (old && Date.parse(d.revision) < Date.parse(old.revision))
      throw new Error(`Revision rollback refused: ${d.id}`);
    const changed = !old || JSON.stringify(old) !== JSON.stringify(d);
    if (changed)
      changes.push({
        id: d.id,
        from: old?.revision ?? null,
        to: d.revision,
        requires_review: !!old && d.revision !== old.revision,
      });
    byId.set(d.id, d);
  }
  // Missing pages are preserved; a refresh must explicitly mark an inaccessible page UNAVAILABLE.
  const documents = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    documents,
    changes,
    checksum: createHash("sha256")
      .update(JSON.stringify(documents))
      .digest("hex"),
  };
}
/** Adapter for fetched Notion MCP structuredContent, plus a separately authored original summary.
 * Original text is inspected only in memory and never returned/persisted. */
export function notionSource(
  page: Record<string, unknown>,
  editorial: {
    category: string;
    subcategory: string;
    summary: string;
    text_review: string;
    images_reviewed: number;
  },
): SourceRecord {
  const id = String(page.id ?? "").replaceAll("-", ""),
    text = String(page.text ?? ""),
    body = text.split("<content>")[1]?.split("</content>")[0];
  if (!idPattern.test(id) || body === undefined)
    throw new Error(
      "An actual fetched page with content is required, not a search hit",
    );
  return validateSource({
    id,
    title: String(page.title ?? "").replace(/^[^\p{L}\p{N}]+/u, ""),
    ...editorial,
    url: `https://app.notion.com/p/${id}`,
    revision: page.page_last_edited_at,
    source_status: "FETCHED",
    related_ids: [
      ...body.matchAll(/https:\/\/app.notion.com\/(?:p\/)?([a-f0-9]{32})/g),
    ]
      .map((m) => m[1])
      .filter((x) => x !== id),
    image_count: [...body.matchAll(/<image /g)].length,
    content_characters: body.length,
    truncated: page.truncated === true,
    unknown_block_count: Number(page.unknown_block_count ?? 0),
  });
}
