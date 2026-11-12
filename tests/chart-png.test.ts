import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chartPng } from "../lib/chart-png";

test("bundled font renders distinct real Latin/digit glyphs with system fonts disabled", async () => {
  const render = (text: string) => chartPng(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="70"><rect width="150" height="70" fill="white"/><text x="5" y="50" font-family="Noto Sans" font-size="45">${text}</text></svg>`);
  const a = await sharp(render("A")).raw().toBuffer(), b = await sharp(render("B")).raw().toBuffer();
  const one = await sharp(render("1")).raw().toBuffer(), eight = await sharp(render("8")).raw().toBuffer();
  assert.ok(!a.equals(b), "A and B must not both render as the same missing-glyph box");
  assert.ok(!one.equals(eight), "Price digits must have distinct glyphs");
  assert.ok(a.some(value => value < 100), "Text must be visible, not omitted");
});
