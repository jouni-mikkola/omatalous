import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { auditTables, openAll } from "./table-audit.ts";

// Every page that has a table, at the width of a phone and of a desktop, in both looks, with every chart's Taulukko choice
// and every details open: the page does not scroll sideways, no table scrolls inside its frame, every table is shown (a
// table that exists is on the page, not hidden behind a rule) and axe finds nothing in any table.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const ROUTES = [
  "/#/overview?period=month",
  "/#/bills",
  "/#/transactions",
  "/#/transactions?view=merchants",
  "/#/reports?tab=virta",
  "/#/reports?tab=menot",
  "/#/reports?tab=varat",
  "/#/settings",
  "/#/settings?section=technical",
  "/#/optimise",
  "/#/review",
];

for (const look of ["light", "night"] as const) {
  for (const width of [1440, 390]) {
    test(`every table: ${look}, ${width} px`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      const problems: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route);
        // A hash-only navigation keeps the old document's completed load state. Reload before auditing the new view.
        await page.reload();
        await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
        if (look === "night") await page.evaluate(() => document.documentElement.setAttribute("data-look", "night"));
        problems.push(...(await auditTables(page, width)).map((p) => `${route}: ${p}`));
        if (process.env.E2E_SHOTS) {
          const name = route.replace(/^\/#\//, "").replace(/[^a-z0-9]+/g, "-");
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name}-${look}-${width}.png`), fullPage: true });
        }
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}

// A table that folds its months into a list (a desktop only just narrower than the grid) keeps its total's months within
// reach: the total has its own button, and opening it shows the figures.
test("a folded total opens its months, at 1100 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1100, height: 900 }, bypassCSP: true });
  const page = await context.newPage();
  await page.goto("/#/reports?tab=menot");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('button:text-is("Taulukko")').first()).toBeVisible({ timeout: 15_000 });
  await openAll(page);
  const folded = page.locator('.rt-wrap[data-block]:has(tfoot td.rt-series)');
  const n = await folded.count();
  expect(n, "a table with months folds at this width").toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const table = folded.nth(i);
    const button = table.locator("tfoot .rt-fold");
    await expect(button, "the total of a folded table has the button").toHaveCount(await table.locator("tfoot tr").count());
    await button.first().click();
    await expect(table.locator("tfoot tr[data-series-open] td.rt-series").first()).toBeVisible();
  }
  await context.close();
});
