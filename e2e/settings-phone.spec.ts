import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { auditTables } from "./table-audit.ts";

// Decision: whether Asetukset works on a phone for a reader who has set a larger text size. Jäsenet, Turvallisuus and
// Palvelin ja ylläpito at 390 px with a finger, at the default size and at 200 %: nothing scrolls sideways, every link,
// button and summary reaches 44 px, no two targets overlap and axe finds nothing in a table. 200 % is the browser's
// default font size doubled, which is what the rem tokens follow.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const PAGES = ["members", "security", "server"];
const TOP = ["overview", "transactions", "bills", "reports", "review"];

for (const scale of [100, 200]) {
  test(`Asetukset, 390 px with a finger and text at ${scale} %: nothing scrolls sideways and every target is 44 px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 900 }, bypassCSP: true, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const problems: string[] = [];
    for (const id of PAGES) {
      await page.goto(`/#/settings/${id}`);
      // a hash-only navigation keeps the old document: reload so the page is read from the start
      await page.reload();
      await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
      await page.addStyleTag({ content: `html { font-size: ${scale}%; }` });
      // the body is 14 px at the default size: the rem tokens follow the root
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBeCloseTo((14 * scale) / 100, 1);
      problems.push(...(await auditTables(page, 390, true)).map((p) => `${id}: ${p}`));
    }
    expect(problems).toEqual([]);
    await context.close();
  });
}

test("the top pages, 390 px with a finger and text at 200 %: nothing scrolls sideways and every target is 44 px", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 900 }, bypassCSP: true, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const problems: string[] = [];
  for (const id of TOP) {
    await page.goto(`/#/${id}`);
    await page.reload();
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main .loading, main .skel")).toHaveCount(0, { timeout: 15_000 });
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    // the body is 14 px at the default size: at 200 % the rem tokens have doubled it
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), id).toBeCloseTo(28, 1);
    problems.push(...(await auditTables(page, 390, true)).map((p) => `${id}: ${p}`));
  }
  expect(problems).toEqual([]);
  await context.close();
});
