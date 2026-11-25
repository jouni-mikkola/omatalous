import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { unfold, watch } from "./helpers.ts";

// A chart and its table are one part (ADR 0023): the table is folded under the chart, a click on a mark opens it on that
// mark's row, and the arrow keys move the readout, which a screen reader hears through aria-live.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a month chart: its table is folded, a pick opens it on that month and Escape lets go", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=tulot");
  const fold = page.locator("details.chart-fold").first();
  await expect(fold).toBeVisible({ timeout: 20_000 });
  await expect(fold).not.toHaveAttribute("open", "");
  await expect(fold.locator("summary")).toContainText("Kuukaudet taulukkona");
  const chart = page.locator("svg g[tabindex='0']").first();
  await chart.focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("open", "");
  await expect(fold.locator("table.rt tbody tr")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(fold.locator(".rt-filter")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a slope chart: arrows move between the lines and Enter keeps that category's row", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  await unfold(page, "vuodet");
  const part = page.locator("figure:has(#vuodet-slope-q)");
  const group = part.locator("svg g[tabindex='0']").first();
  test.skip((await group.count()) === 0, "the demo household has no comparable year");
  await group.focus();
  const live = part.locator('.chart > [aria-live="polite"]');
  const first = (await live.innerText()).trim();
  expect(first).not.toBe("");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await live.innerText()).trim()).not.toBe(first);
  await page.keyboard.press("Enter");
  await expect(part.locator("table.rt tbody tr")).toHaveCount(1);
  await expect(part.locator(".rt-filter .chip")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the slope of Ruoka is read like the other charts: focus and the arrows read a line out", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=12m&q=menot");
  await unfold(page, "ruoka");
  const part = page.locator("figure:has(#ruoka-kauppa-q)");
  const marks = part.locator("svg g.slope-mark");
  test.skip((await marks.count()) === 0, "the demo household has no basket to compare");
  await marks.first().focus();
  const live = part.locator('.chart [aria-live="polite"]').first();
  await expect.poll(async () => (await live.innerText()).trim()).toMatch(/\d/);
  expect(seen.problems).toEqual([]);
  await context.close();
});
