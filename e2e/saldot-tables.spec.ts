import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { overflow, watch } from "./helpers.ts";

// The month tables of Saldot have no search box (one row per month). The forecast chart left with the extra report
// sections (6fbd30df7), so its legend is not checked any more.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [1440, 390]) {
  test(`at ${width} px the month tables of Saldot have no search`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/reports?q=saldot");
      const balances = page.locator("figure:has(#saldot-kaavio-q)");
      await expect(balances).toBeVisible();
      await expect(balances.locator("table.rt tbody tr").first()).toBeVisible();
      expect(await balances.locator("table.rt tbody tr").count(), "long enough to have had a search box").toBeGreaterThan(10);
      await expect(balances.getByRole("searchbox")).toHaveCount(0);

      await expect(page.getByRole("searchbox", { name: /Seuraavat 12 kuukautta/ })).toHaveCount(0);
      expect(await overflow(page), `Saldot scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
