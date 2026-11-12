import { expect, test } from "@playwright/test";
import { join } from "node:path";

// Every question of Raportit fits the window of a phone and of a desktop: the page does not scroll sideways and the
// heading and the comparison switch stay inside the window.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
// Velat is not here: the demo has no saved loan, so the list does not name it and its address opens another report
const QUESTIONS = ["tulot", "menot", "saldot", "kuukausi"];

for (const width of [390, 1440]) {
  for (const q of QUESTIONS) {
    test(`Raportit ${q} fits ${width} px`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto(`/#/reports?q=${q}`);
      await page.reload();
      await expect(page.locator(".q-title")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".loading")).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `reports-${q}-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `scrollWidth of ${q}`).toBeLessThanOrEqual(width);
      const outside = await page.evaluate((w) => [...document.querySelectorAll<HTMLElement>(".q-title, .compare, .compare button")].filter((e) => e.getBoundingClientRect().right > w + 0.5).map((e) => e.className || e.tagName), width);
      expect(outside, `outside the window in ${q}`).toEqual([]);
      // the running month does not depend on the period, so its page has no switch; the others do
      await expect(page.getByRole("toolbar", { name: "Aikaväli" })).toHaveCount(q === "kuukausi" ? 0 : 1);
      await context.close();
    });
  }
}

// the switch follows the question the page opened, not the address: no `q`, or a `q` with nothing to say, falls back to another one
for (const hash of ["/#/reports?period=12m", "/#/reports?q=nonexistent"]) {
  test(`Raportit ${hash} hides the period switch only on the running month`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(hash);
    await page.reload();
    await expect(page.locator(".q-title")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    // neither address can open the running month: a bare one skips it, and so does a `q` with nothing to say
    await expect(page.locator("#kuukausi")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Aikaväli" })).toHaveCount(1);
    await context.close();
  });
}

// Tulot is repeated nowhere: at most half of the 6 015 px (1440 px) and 8 404 px (390 px) it was with a table for each month.
for (const [width, limit] of [[1440, 3008], [390, 4202]] as const) {
  test(`Tulot stays under ${limit} px tall at ${width} px`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto("/#/reports?q=tulot");
    await page.reload();
    await expect(page.locator(".q-title")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(limit);
    await context.close();
  });
}
