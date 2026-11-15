import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The frame of Raportit: one report open at a time beside the list of them all.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a report in the list opens its page and keeps the period; a phone shows the list open with targets of 44 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?period=6m");
  const list = page.getByRole("navigation", { name: "Raportit" });
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Tilit ja saldot" })).toBeVisible();
  for (const link of await list.getByRole("link").all()) expect((await link.boundingBox())!.height, "a target of 44 px").toBeGreaterThanOrEqual(44);
  await list.getByRole("link", { name: "Tilit ja saldot" }).click();
  await expect(page.getByRole("heading", { name: "Tilit ja saldot", level: 2 })).toBeVisible();
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
  await page.goto("/#/reports?q=yhteiset");
  await expect(page.getByRole("heading", { name: "Yhteiset menot", level: 2, exact: true })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
