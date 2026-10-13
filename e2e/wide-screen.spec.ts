import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// From 1600 px a page that stacks its panels stands on the page's twelve columns (a column is 100 px at 1920) and Salasana
// and Tekniset asetukset take six each; under 1600 px they stay under each other.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const [width, side] of [[1920, true], [1600, true], [1280, false]] as const) {
  test(`Asetukset at ${width} px: Salasana and Tekniset asetukset ${side ? "stand side by side on one top edge" : "stand under each other"}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/settings");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const halves = page.locator(".stack > .card.half");
    await expect(halves).toHaveCount(2);
    const [a, b] = [(await halves.nth(0).boundingBox())!, (await halves.nth(1).boundingBox())!];
    if (side) {
      expect(b.y, "the two share a top edge").toBe(a.y);
      expect(b.x, "the second stands right of the first").toBeGreaterThan(a.x + a.width);
      expect(a.width, "six columns of a grid of 100 px columns and 16 px gutters").toBe(width === 1920 ? 6 * 100 + 5 * 16 : a.width);
      expect(a.width).toBe(b.width);
    } else {
      expect(b.x).toBe(a.x);
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    }
    expect(await overflow(page), `Asetukset scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
