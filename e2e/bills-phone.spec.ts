import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Laskut on a phone: the dates of the rows start at one x whatever a row carries beside its day (a late badge, "Kortilla"), and nothing
// a finger taps stands closer than 12 px to the screen edge. Runs on the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const ROW = "#laskut-taulukko table.sub-table tbody tr:not(.rt-detail):not(.rt-group):not(.rt-spacer)";

for (const width of [390, 1440]) {
  test(`${width} px: the dates of the rows start at one x and no control is within 12 px of the screen edge`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/bills");
    const rows = page.locator(ROW);
    await expect(rows.first()).toBeVisible();
    if (process.env.E2E_SHOTS) {
      await page.locator("#laskut-taulukko").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `bills-${width}.png`) });
    }
    const found = await rows.evaluateAll((els) =>
      els.map((row) => {
        const cell = row.querySelector<HTMLElement>("td.next-col")!;
        const range = document.createRange();
        range.selectNodeContents(cell);
        const first = range.getClientRects()[0];
        const tags = Array.from(cell.querySelectorAll(".badge, .sub-card")).map((el) => el.textContent?.trim() ?? "");
        return { name: row.querySelector(".sub-merchant")?.textContent ?? "", left: Math.round(first?.left ?? -1), tags };
      }),
    );
    expect(found.length, "rows").toBeGreaterThan(5);
    // the demo has a row with a tag beside its day and a row without, or the check proves nothing
    expect(found.some((r) => r.tags.length), "a row with a tag").toBe(true);
    expect(found.some((r) => !r.tags.length), "a row without").toBe(true);
    if (phone) expect(new Set(found.map((r) => r.left)), `x of the dates: ${JSON.stringify(found)}`).toHaveProperty("size", 1);

    const edge = await page.locator("#laskut-taulukko").locator("button, a[href], input, select, [tabindex='0']").evaluateAll((els) =>
      els.filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
        const box = el.getBoundingClientRect();
        return { what: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName, left: box.left, right: window.innerWidth - box.right };
      }),
    );
    expect(edge.length, "controls").toBeGreaterThan(0);
    for (const c of edge) {
      expect(c.left, `${c.what}: left edge`).toBeGreaterThanOrEqual(12);
      expect(c.right, `${c.what}: right edge`).toBeGreaterThanOrEqual(12);
    }
    expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
