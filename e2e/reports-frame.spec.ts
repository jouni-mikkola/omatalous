import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The frame of Raportit: one report open at a time beside the list of them all.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a question in the list opens its report and keeps the period; a phone shows the questions open with targets of 44 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Miten rahat ja velat kehittyvät?" })).toBeVisible();
  for (const link of await list.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, "a target of 44 px").toBeGreaterThanOrEqual(44);
    expect(box.x, "inside the page on the left").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "inside the page on the right").toBeLessThanOrEqual(390);
    expect(box.width, "a question takes the width of the page, one under another").toBeGreaterThan(300);
  }
  // the reports that refine the open question stand under its name, with targets of 44 px as well
  const refine = page.getByRole("navigation", { name: "Mihin raha menee?" });
  expect(await refine.getByRole("link").count()).toBeGreaterThanOrEqual(2);
  for (const link of await refine.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, "a refining target of 44 px").toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, "inside the page on the right").toBeLessThanOrEqual(390);
  }
  await expect(refine.getByRole("link", { name: "Rahankäyttö" })).toHaveAttribute("aria-current", "page");
  await list.getByRole("link", { name: "Miten rahat ja velat kehittyvät?" }).click();
  await expect(page.getByRole("heading", { name: "Tilit ja saldot", level: 2 })).toBeVisible();
  await expect(list.getByRole("link", { name: "Miten rahat ja velat kehittyvät?" })).toHaveAttribute("aria-current", "true");
  expect(new URL(page.url()).hash).toMatch(/q=saldot/);
  expect(new URL(page.url()).hash).toContain("period=6m");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll at 390 px").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a household with no shared account has no Yhteiset menot question and no such page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await expect(list.getByRole("link", { name: /yhteiset/i })).toHaveCount(0);
  await expect(list.getByRole("link")).toHaveCount(2);
  await page.goto("/#/reports?q=yhteiset");
  await expect(page.getByRole("heading", { name: "Yhteiset menot", level: 2, exact: true })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
