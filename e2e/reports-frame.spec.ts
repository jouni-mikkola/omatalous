import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The frame of Raportit: one report open at a time beside the list of them all.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a report in the list opens its page and keeps the period; a phone shows the reports open with targets of 44 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Varat ja velat" })).toBeVisible();
  for (const link of await list.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, "a target of 44 px").toBeGreaterThanOrEqual(44);
    expect(box.x, "inside the page on the left").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "inside the page on the right").toBeLessThanOrEqual(390);
    expect(box.width, "a report takes the width of the page, one under another").toBeGreaterThan(300);
  }
  await expect(list.getByRole("link", { name: "Tulot ja menot" })).toHaveAttribute("aria-current", "true");
  await list.getByRole("link", { name: "Varat ja velat" }).click();
  await expect(page.getByRole("heading", { name: "Varat ja velat", level: 2 })).toBeVisible();
  await expect(list.getByRole("link", { name: "Varat ja velat" })).toHaveAttribute("aria-current", "true");
  expect(new URL(page.url()).hash).toMatch(/q=saldot/);
  expect(new URL(page.url()).hash).toContain("period=6m");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll at 390 px").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a month of the chart on Tulot ja menot is a column as high as a thumb and 24 px wide on a phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=tulot");
  const months = page.locator("a.mb-link");
  await expect(months.first()).toBeAttached();
  const columns = await page.locator("a.mb-link rect").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  expect(columns.length, "the months of the chart").toBeGreaterThan(0);
  for (const box of columns) {
    expect(box.height, "a month's column is as high as a thumb").toBeGreaterThanOrEqual(44);
    expect(box.width, "a month's column is 24 px wide").toBeGreaterThanOrEqual(24);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a household with no shared account has no Yhteiset menot report and no such page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await expect(list.getByRole("link", { name: /yhteiset/i })).toHaveCount(0);
  await expect(list.locator("[aria-current]")).toHaveText("Menot kategorioittain");
  await page.goto("/#/reports?q=yhteiset");
  await expect(page.getByRole("heading", { name: "Yhteiset menot", level: 2, exact: true })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
