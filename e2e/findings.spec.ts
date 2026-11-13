import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// The first page shows no question: Tarkistettavat, the header's link with its count, is the one place that asks, and Raportit has no list of findings of its own. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Yhteenveto shows no question, the header's link opens Tarkistettavat, and Raportit has no Havainnot", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  await expect(page.locator(".home-tiles")).toBeVisible();
  await expect(page.getByRole("region", { name: "Huomioitavaa", exact: true })).toHaveCount(0);
  await expect(page.locator("main .home-note, main .review-item")).toHaveCount(0);
  await page.getByRole("link", { name: /^Tarkistettavat/ }).click();
  await expect(page).toHaveURL(/#\/review/);
  await page.goto("/#/reports?q=tulot");
  await expect(page.locator(".q-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Havainnot" })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
