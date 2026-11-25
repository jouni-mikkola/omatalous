import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The frame of Raportit: one report open at a time under the tabs of them all.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a report in the list opens its page and keeps the period; a phone shows the tabs in one row with targets of 44 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Menot kategorioittain" })).toBeVisible();
  for (const link of await list.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, "a target of 44 px").toBeGreaterThanOrEqual(44);
  }
  expect(await list.evaluate((el) => getComputedStyle(el).overflowX), "the tabs scroll sideways when they do not fit").toBe("auto");
  await expect(list.getByRole("link", { name: "Tulot ja menot" })).toHaveAttribute("aria-current", "true");
  await list.getByRole("link", { name: "Menot kategorioittain" }).click();
  await expect(page.locator("h2.q-title", { hasText: "Menot kategorioittain" })).toBeVisible();
  await expect(list.getByRole("link", { name: "Menot kategorioittain" })).toHaveAttribute("aria-current", "true");
  expect(new URL(page.url()).hash).toMatch(/q=menot/);
  expect(new URL(page.url()).hash).toContain("period=6m");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll at 390 px").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// Twelve months share a phone's width, so a column cannot be 44 px wide there: the least it keeps is the floor of a target (WCAG 2.5.8)
test("a month of the chart on Tulot ja menot is a column as high as a thumb and as wide as the floor of a target on a phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=tulot");
  const months = page.locator("a.mb-link");
  await expect(months.first()).toBeAttached();
  const { tapMin, tapFloor } = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { tapMin: Number.parseFloat(style.getPropertyValue("--tap-min")), tapFloor: Number.parseFloat(style.getPropertyValue("--tap-floor")) };
  });
  expect([tapMin, tapFloor], "the tokens of the target rule").toEqual([44, 24]);
  const columns = await page.locator("a.mb-link rect").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  expect(columns.length, "the months of the chart").toBeGreaterThan(0);
  for (const box of columns) {
    expect(box.height, "a month's column is as high as a thumb (--tap-min)").toBeGreaterThanOrEqual(tapMin);
    expect(box.width, "a month's column is as wide as the floor of a target (--tap-floor)").toBeGreaterThanOrEqual(tapFloor);
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
