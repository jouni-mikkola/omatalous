import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow } from "./helpers.ts";

// Yhteenveto does not scroll sideways when the usual month is far bigger than this one so far (a late payday): the tick of the
// usual bar (.wf-usual) stays on the track instead of stretching the page.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [390, 1440]) {
  test(`Yhteenveto at ${width} px: a usual income twice the month's does not scroll the page sideways`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    // every bar of the waterfall gets a usual twice its own size; the income's end is then past every edge of this month
    await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const w = json.waterfall;
      if (w) for (const b of w.bars) if (b.key !== "transfers") (b.usualCents = b.cents * 2), (b.vsUsualCents = b.cents - b.usualCents);
      await route.fulfill({ response, json });
    });
    await page.goto("/#/overview?period=month");
    await expect(page.locator(".wf-row").first()).toBeVisible({ timeout: 15_000 });
    const ticks = page.locator(".wf-usual");
    expect(await ticks.count(), "the ticks are drawn").toBeGreaterThan(0);
    for (const tick of await ticks.all()) {
      const track = (await tick.locator("xpath=..").boundingBox())!;
      const box = (await tick.boundingBox())!;
      expect(box.x + box.width / 2, "tick inside its track").toBeGreaterThanOrEqual(track.x - 1);
      expect(box.x + box.width / 2, "tick inside its track").toBeLessThanOrEqual(track.x + track.width + 1);
    }
    expect(await overflow(page), "the page scrolls sideways").toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await context.close();
  });
}
