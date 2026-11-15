import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Tarkistettavat on a phone: no bar of nothing above the card, the payees of an item's rows start at one x whatever the date
// beside them, a payee of 24 characters is not cut, and the skip button is the one verb. Runs on the demo household that
// e2e/run.mjs makes; the demo's car financing item carries a payee of exactly 24 characters.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [390, 1440]) {
  test(`${width} px: the payees of the rows start at one x and none is cut, no empty bar, the skip button is Ohita`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/review");
    const skip = page.getByRole("button", { name: "Ohita", exact: true });
    await expect(skip.or(page.getByRole("button", { name: /^Ohita/ }))).toBeVisible();
    if (process.env.SHOTS_DIR) await page.screenshot({ path: join(process.env.SHOTS_DIR, `review-${width}.png`) });
    await expect(skip).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);

    let longest = 0;
    let measured = 0;
    for (let i = 0; i < 12 && (await skip.count()); i++) {
      const rows = await page.locator(".review-row-list li").evaluateAll((els) =>
        els.map((li) => {
          const name = li.querySelector<HTMLElement>(".review-row-name")!;
          const box = name.getBoundingClientRect();
          // a name wrapped onto two lines is whole; a clipped one has more width than its box
          return { text: name.textContent ?? "", left: Math.round(box.left), right: Math.round(box.right), clipped: name.scrollWidth > name.clientWidth || getComputedStyle(name).textOverflow === "ellipsis" };
        }),
      );
      if (rows.length) {
        measured++;
        expect(new Set(rows.map((r) => r.left)), `x of the payees: ${JSON.stringify(rows)}`).toHaveProperty("size", 1);
        for (const r of rows) {
          expect(r.clipped, `${r.text} is cut`).toBe(false);
          expect(r.right, `${r.text} leaves the screen`).toBeLessThanOrEqual(width);
          longest = Math.max(longest, r.text.length);
        }
      }
      await skip.click();
    }
    expect(measured, "items with rows").toBeGreaterThan(0);
    expect(longest, "the longest payee seen").toBeGreaterThanOrEqual(24);
    expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
