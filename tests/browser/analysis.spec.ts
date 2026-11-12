import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { analyzeSeries } from "../../lib/technical-analysis";

test("recorded real MN1: layer switches, side, symbol, PNG link, errors and mobile layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Browser-only replay. No production runtime fallback or generated OHLC.
  await page.route("**/api/candles?**", async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("timeframe") !== "MN1") return route.fulfill({ status: 502, json: { ok: false, error: { message: "Fixture includes MN1 only" } } });
    const symbol = query.get("symbol");
    if (!["EURUSD", "NAS100", "EU50"].includes(symbol ?? "")) return route.fulfill({ status: 404, json: { ok: false, error: { message: "No fixture" } } });
    await route.fulfill({ json: JSON.parse(readFileSync(`tests/fixtures/capital-${symbol}-mn1.json`, "utf8")) });
  });
  await page.goto("/");
  await expect(page.locator(".chart-message[role=alert]")).toContainText("Fixture includes MN1 only");
  await page.getByRole("button", { name: "MN1", exact: true }).click();
  const panel = page.getByRole("region", { name: "Техническая структура Capitalive" });
  await expect(panel).toBeVisible();
  await expect(panel.locator("svg")).toContainText("NAS100 · MN1 · BID");
  const original = await panel.locator("svg").innerHTML();
  await panel.getByLabel("Фракталы", { exact: true }).uncheck();
  await expect(panel.locator("svg")).toContainText("Fractals hidden");
  expect(await panel.locator("svg").innerHTML()).not.toBe(original);
  await panel.getByLabel("FVG", { exact: true }).uncheck();
  await expect(panel.locator("svg")).not.toContainText("FVG:");
  await panel.getByLabel("Диапазоны", { exact: true }).uncheck();
  await panel.getByLabel("EQ / Premium / Discount", { exact: true }).uncheck();
  await expect(panel.getByRole("link", { name: "Открыть PNG" })).toHaveAttribute("href", /fractals=0&fvg=0&ranges=0&eq=0/);
  await page.getByRole("button", { name: "ASK", exact: true }).click();
  await expect(panel.locator("svg")).toContainText("NAS100 · MN1 · ASK");
  await page.getByRole("combobox").selectOption("EURUSD");
  await expect(panel.locator("svg")).toContainText("EURUSD · MN1 · ASK");
  for (const label of ["Фракталы", "FVG", "Диапазоны", "EQ / Premium / Discount"]) await panel.getByLabel(label, { exact: true }).check();
  await panel.screenshot({ path: "verification/capitalive-v2/browser-analysis.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByLabel("Фракталы", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "verification/capitalive-v2/browser-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("H4 explicit range updates exact EQ and both API links; reset restores automatic range", async ({ page }) => {
  const data = JSON.parse(readFileSync("tests/fixtures/capital-NAS100-h4.json", "utf8"));
  const calculated = analyzeSeries(data, "NAS100"), pair = calculated.ranges.alternatives[0];
  await page.route("**/api/candles?**", route => route.fulfill({ json: data }));
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Техническая структура Capitalive" });
  await panel.getByRole("combobox", { name: "H4 Fractal High", exact: true }).selectOption(pair.high!.id);
  await panel.getByRole("combobox", { name: "H4 Fractal Low", exact: true }).selectOption(pair.low!.id);
  await panel.locator("summary").click();
  await expect(panel.getByTestId("range-eq")).toHaveText(String((pair.high!.price + pair.low!.price) / 2));
  for (const label of ["Открыть PNG", "Аудит для ChatGPT"]) {
    const url = new URL((await panel.getByRole("link", { name: label }).getAttribute("href"))!, "https://local");
    expect(url.searchParams.get("range_high")).toBe(pair.high!.id); expect(url.searchParams.get("range_low")).toBe(pair.low!.id);
  }
  await panel.getByRole("button", { name: "Автоматический диапазон" }).click();
  await expect(panel.getByTestId("range-eq")).toHaveText(String(calculated.ranges.selected.equilibrium));
  await expect(panel.getByRole("link", { name: "Открыть PNG" })).not.toHaveAttribute("href", /range_high/);
});
