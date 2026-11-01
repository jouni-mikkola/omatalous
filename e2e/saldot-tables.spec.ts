import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { overflow, watch } from "./helpers.ts";

// The month tables of Saldot have no search box (one row per month), and the legend of the forecast chart stands under
// the heading of its own chart, not above the heading of the five-year chart.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [1440, 390]) {
  test(`at ${width} px the month tables of Saldot have no search and the forecast legend is under its heading`, async ({ browser }) => {
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

      const chart = page.locator("figure:has(#forecast-chart-q)");
      await expect(chart).toBeVisible();
      const heading = await chart.locator("#forecast-chart-q").boundingBox();
      const legend = await page.locator(".forecast-legend").boundingBox();
      const plot = await chart.locator("svg").first().boundingBox();
      expect(legend!.y, "the legend is under the heading of the chart it explains").toBeGreaterThan(heading!.y);
      expect(legend!.y, "and above its plot").toBeLessThan(plot!.y);
      await expect(chart.locator(".forecast-legend")).toHaveCount(1);
      await expect(page.getByRole("searchbox", { name: /Seuraavat 12 kuukautta/ })).toHaveCount(0);
      expect(await overflow(page), `Saldot scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
