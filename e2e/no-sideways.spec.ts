import { chromium, expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow } from "./helpers.ts";

// No page scrolls sideways at a desktop width or a phone's: the shell and the base layout
// (a report said every page was 6 px too wide at 1280) hold for each top page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const PAGES = ["overview", "transactions", "bills", "reports", "review"];

// A row of tabs never wraps: it scrolls inside itself, the page does not, and the open tab is in sight, the first and the last of the row alike.
for (const tab of ["banks", "server"]) {
  test(`the tabs of Asetukset stay one row at 390 px with the open tab in sight: ${tab}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await page.goto(`/#/settings/${tab}`);
    const row = page.locator("main .tabs").first();
    await expect(row).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const tops = await row.getByRole("link").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size, "one line of tabs").toBe(1);
    // the tab is brought into sight as the row is drawn, so the row is read once it has settled
    await expect.poll(async () => {
      const open = (await row.locator("[aria-current]").boundingBox())!;
      const view = (await row.boundingBox())!;
      return open.x >= view.x - 1 && open.x + open.width <= view.x + view.width + 1;
    }).toBe(true);
    await context.close();
  });
}

for (const width of [1280, 390]) {
  test(`no top page scrolls sideways at ${width} px`, async ({ baseURL }) => {
    // Playwright hides scrollbars when headless; a desktop browser's vertical scrollbar takes width, and a page that
    // measures itself by the viewport (100vw) is then wider than its window
    const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"], ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}) });
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, baseURL });
    const page = await context.newPage();
    for (const id of PAGES) {
      await page.goto(`/#/${id}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await overflow(page), `${id} at ${width} px`).toBeLessThanOrEqual(0);
    }
    // the questions of Raportit are pages of their own (Yhteiset needs a joint account, which the demo has not), and the month's head and the Vertaa choice sit in some of them
    for (const q of ["menot", "tulot", "saldot"]) {
      await page.goto(`/#/reports?q=${q}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await overflow(page), `reports ${q} at ${width} px`).toBeLessThanOrEqual(0);
    }
    await context.close();
    await browser.close();
  });
}
