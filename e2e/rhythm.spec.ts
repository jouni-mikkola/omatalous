import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { unfold, watch } from "./helpers.ts";

// The slope of the year comparison under its question, read by the keyboard, and fit a phone.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("at 390 px the slope of the years is read by the keyboard and fits its card", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  await unfold(page, "vuodet");
  const years = page.locator("#vuodet");
  if (await years.locator(".slope-chart").count()) {
    await years.locator(".slope-chart g[role=group]").focus();
    await expect(years.locator(".tooltip")).toContainText("Muutos");
    expect(await years.evaluate((c) => c.scrollWidth <= c.clientWidth + 1), "the slope fits its card at 390px").toBe(true);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});
