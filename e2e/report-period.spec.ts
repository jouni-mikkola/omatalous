import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Raportit: a period switch keeps the open tab and a tab switch keeps the period", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  const toolbar = page.getByRole("toolbar", { name: "Aikaväli" });
  const menot = page.locator("#kuukaudet");
  await expect(menot).toBeVisible();
  await toolbar.getByRole("button", { name: "6 kk" }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/reports\?(q=menot&period=6m|period=6m&q=menot)$/);
  await expect(page.getByRole("link", { name: /^Rahankäyttö/, includeHidden: false }).first()).toHaveAttribute("aria-current", "page");
  await expect(menot).toBeVisible();
  await page.goto("/#/reports?period=3m");
  await page.getByRole("link", { name: /^Rahankäyttö/ }).first().click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/period=3m/);
  expect(new URL(page.url()).hash).toMatch(/q=menot/);
  await expect(toolbar.locator("[aria-pressed=true]")).toHaveText("3 kk");
  expect(seen.problems).toEqual([]);
  await context.close();
});
