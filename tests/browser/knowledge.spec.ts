import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildIntelligence } from "../../lib/knowledge/intelligence";
import { detectFractals } from "../../lib/knowledge/detectors";
import { closedFrame } from "../../lib/knowledge/data";
import {encodeIntelligence} from '../../lib/knowledge/wire';
import type { CandleResponse, Timeframe } from "../../lib/candle-data";
import type { MarketQuote } from "../../lib/quote-normalization";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/htf-EURUSD.json", "utf8"),
) as { data: Record<Timeframe, CandleResponse>; quote: MarketQuote };
test("knowledge catalog searches original summaries and exposes uncertainties", async ({
  page,
}) => {
  await page.goto("/knowledge");
  await expect(page.getByText(/Импортировано 85\/85/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Поиск по материалам и правилам" })
    .fill("EDGE.RB");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await page.locator("summary").filter({ hasText: "EDGE.RB.v1" }).click();
  await expect(page.getByText(/Reviewed diagrams place the RB reference/)).toBeVisible();
  const response = await page.request.get("/api/knowledge?q=EDGE.RB");
  expect(response.status()).toBe(200);
  expect((await response.json()).rules[0].id).toBe("EDGE.RB.v1");
});
test("intelligence renders recorded analysis, selects concrete H4 fractals and clears stale data on errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let fail = false;
  await page.route("**/api/intelligence?**", async (route) => {
    if (fail)
      return route.fulfill({
        status: 502,
        json: { ok: false, error: { message: "Provider unavailable" } },
      });
    const q = new URL(route.request().url()).searchParams,
      side = q.get("side") === "ask" ? "ask" : "bid",
      high = q.get("high_id"),
      low = q.get("low_id");
    return route.fulfill({
      json: encodeIntelligence(buildIntelligence(fixture.data, side, fixture.quote, {
        ...(high && low
          ? { ranges: { H4: { high_id: high, low_id: low } } }
          : {}),
      })),
    });
  });
  await page.goto("/intelligence");
  await page
    .getByRole("button", { name: "Получить анализ", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: /Narrative:/ })).toBeVisible();
  await expect(page.getByTestId("narrative-review")).toContainText("Trading Research Desk");
  await expect(page.getByTestId("target-status")).toContainText("TARGET_UNVERIFIED");
  const p = detectFractals(closedFrame(fixture.data.H4, "bid")),
    h = p.find(
      (h) =>
        h.polarity === "high" &&
        p.some(
          (l) =>
            l.polarity === "low" &&
            l.segment === h.segment &&
            l.price < h.price,
        ),
    )!,
    l = p.find(
      (l) =>
        l.polarity === "low" && l.segment === h.segment && l.price < h.price,
    )!;
  await page
    .getByRole("combobox", { name: "H4 High", exact: true })
    .selectOption(h.id);
  await page
    .getByRole("combobox", { name: "H4 Low", exact: true })
    .selectOption(l.id);
  await page
    .getByRole("button", { name: "Применить H4 диапазон", exact: true })
    .click();
  await expect(page.getByTestId("selected-range")).toContainText("EQ:");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: "Цена", exact: true })
    .selectOption("ask");
  await expect(page.getByRole("heading", { name: /Narrative:/ })).toHaveCount(
    0,
  );
  fail = true;
  await page
    .getByRole("button", { name: "Получить анализ", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Provider unavailable",
  );
  await expect(page.getByTestId("selected-range")).toHaveCount(0);
  expect(errors).toEqual([]);
});
