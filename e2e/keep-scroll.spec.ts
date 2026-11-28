import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// A period chip changes the address without changing the page: the reader stays where they are. The router put such a
// change at the top of the page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

test("1440 px: a period chip of Raportit keeps the scroll", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=tulot");
  const chip = page.getByRole("toolbar", { name: "Aikaväli" }).getByRole("button", { name: "3 kk" });
  await expect(chip).toBeVisible();
  await expect(page.locator("#tulot-ja-menot")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(200);
  await chip.dispatchEvent("click");
  await expect.poll(() => new URL(page.url()).hash).toContain("period=3m");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.waitForLoadState("networkidle");
  expect(Math.abs((await scrollY(page)) - before), "the page stays where it was when the period changes").toBeLessThanOrEqual(60);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("another page still opens at the top", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/reports?q=tulot");
  await expect(page.locator("#tulot-ja-menot")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await scrollY(page)).toBeGreaterThan(200);
  await page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Laskut" }).click();
  await expect(page).toHaveURL(/#\/bills/);
  await expect.poll(() => scrollY(page)).toBe(0);
  await context.close();
});
