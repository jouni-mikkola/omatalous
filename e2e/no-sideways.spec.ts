import { chromium, expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow } from "./helpers.ts";

// No page scrolls sideways at a desktop width or a phone's, in the light look or the night one: the shell and the base layout
// (a report said every page was 6 px too wide at 1280) hold for each top page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const PAGES = ["overview", "transactions", "bills", "reports", "review"];

for (const width of [1280, 390]) {
  test(`no top page scrolls sideways at ${width} px, in either look`, async ({ baseURL }) => {
    // Playwright hides scrollbars when headless; a desktop browser's vertical scrollbar takes width, and a page that
    // measures itself by the viewport (100vw) is then wider than its window
    const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"], ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}) });
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, baseURL });
    const page = await context.newPage();
    for (const id of PAGES) {
      await page.goto(`/#/${id}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      for (const look of ["", "night"]) {
        await page.evaluate((l) => (l ? document.documentElement.setAttribute("data-look", l) : document.documentElement.removeAttribute("data-look")), look);
        expect(await overflow(page), `${id} at ${width} px, ${look || "light"} look`).toBeLessThanOrEqual(0);
      }
    }
    await context.close();
    await browser.close();
  });
}
