import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// A cell of the category grid in Menot kuukausittain opens the rows behind it in Tapahtumat, filtered by its category and month.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("a heat map cell with spending opens Tapahtumat filtered by its category and month", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?tab=menot");
  const cell = page.locator("#kuukaudet .heat-grid rect.heat-cell:not(.heat-bnone)").first();
  await cell.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/transactions\?.*category=.+/);
  expect(page.url()).toMatch(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Raportit: a period switch keeps the open tab and a tab switch keeps the period", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?tab=menot");
  const toolbar = page.getByRole("toolbar", { name: "Aikaväli" });
  const menot = page.locator("#kuukaudet");
  await expect(menot).toBeVisible();
  await toolbar.getByRole("button", { name: "6 kk" }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/reports\?(tab=menot&period=6m|period=6m&tab=menot)$/);
  await expect(page.getByRole("tab", { name: "Menot" })).toHaveAttribute("aria-selected", "true");
  await expect(menot).toBeVisible();
  await page.goto("/#/reports?period=3m");
  await page.getByRole("tab", { name: "Menot" }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/period=3m/);
  expect(new URL(page.url()).hash).toMatch(/tab=menot/);
  await expect(toolbar.locator("[aria-pressed=true]")).toHaveText("3 kk");
  expect(seen.problems).toEqual([]);
  await context.close();
});
