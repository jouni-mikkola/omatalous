import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { unfold, watch } from "./helpers.ts";

// A chart and its table are one part (ADR 0018): the table stands under the chart, a click on a mark keeps that mark's
// row, and the arrow keys move the readout, which a screen reader hears through aria-live.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

/** The balance line of Raportit > Saldot: days as marks, its rows keyed by month. */
const PART = "figure:has(#saldot-kaavio-q)";

test("a click on a mark keeps its row in the table under the chart, and the way back shows them all", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=saldot");
  const part = page.locator(PART);
  await expect(part).toBeVisible();
  await expect(part.getByRole("button", { name: "Taulukko" })).toHaveCount(0);
  const rows = part.locator("table.rt tbody tr");
  const all = await rows.count();
  expect(all, "the months stand under the chart").toBeGreaterThan(1);

  // a click at the middle of the plot picks the nearest month
  const plot = part.locator("svg rect.hit-pick");
  await expect(plot).toBeVisible();
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(rows).toHaveCount(1);
  await expect(part.locator(".rt-filter")).toContainText("Näytämme vain rivin");

  await part.getByRole("button", { name: "Näytä kaikki rivit" }).click();
  await expect(rows).toHaveCount(all);
  await expect(part.locator(".rt-filter")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an arrow key moves the readout and aria-live says the value; Enter picks the month", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=saldot");
  const part = page.locator(PART);
  const plot = part.locator("svg rect.hit-pick");
  await expect(plot).toBeVisible();
  const live = part.locator('.chart > [aria-live="polite"]');
  await plot.focus();
  const first = (await live.innerText()).trim();
  expect(first, "focus reads the newest month out").not.toBe("");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await live.innerText()).trim()).not.toBe(first);
  expect((await live.innerText()).trim()).toMatch(/\d/);

  await page.keyboard.press("Enter");
  await expect(part.locator("table.rt tbody tr")).toHaveCount(1);
  // Escape closes the readout, a second one lets the pick go
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(part.locator(".rt-filter")).toHaveCount(0);
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
  await expect(part.locator(".rt-filter")).toContainText("Näytämme vain rivin");
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
