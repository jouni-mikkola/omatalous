import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Tarkistettavat on a phone and a wide screen: a progress line with at least one item done, the card as wide as its page and its rows and text capped, the payees of an item's rows start at one x whatever the date
// beside them, a payee of 24 characters is not cut, and the skip button is the one verb. Runs on the demo household that
// e2e/run.mjs makes; the demo's car financing, a row of Täydennä lainat, is named by a payee of exactly 24 characters.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const width of [390, 1440]) {
  test(`${width} px: the payees of the rows start at one x and none is cut, the progress line is not empty, the card has the page width and its text a measure, the skip button is Ohita`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/review");
    const skip = page.getByRole("button", { name: "Ohita", exact: true });
    await expect(skip.or(page.getByRole("button", { name: /^Ohita/ }))).toBeVisible();
    if (process.env.SHOTS_DIR) await page.screenshot({ path: join(process.env.SHOTS_DIR, `review-${width}.png`) });
    await expect(skip).toBeVisible();
    // the line is hidden from assistive technology (the heading says the place), so it is read from the page
    const line = await page.locator(".review-item > .review-progress").evaluate((el) => ({ value: (el as HTMLProgressElement).value, max: (el as HTMLProgressElement).max }));
    expect(line.value, "the progress line is not empty").toBeGreaterThanOrEqual(1);
    expect(line.max).toBeGreaterThanOrEqual(line.value);
    // the card fills the page's column; the evidence rows and the question keep a measure, so a sum stays near its payee
    const widths = await page.evaluate(() => ({
      page: document.querySelector(".review")!.getBoundingClientRect().width,
      card: document.querySelector(".review-item")!.getBoundingClientRect().width,
      rows: document.querySelector(".review-row-list")?.getBoundingClientRect().width ?? 0,
      question: document.querySelector(".review-q")!.getBoundingClientRect().width,
    }));
    expect(widths.card, `card ${widths.card} of page ${widths.page}`).toBeGreaterThanOrEqual(widths.page - 2);
    if (width >= 1000) {
      expect(widths.rows, "the rows keep a measure").toBeLessThanOrEqual(widths.card * 0.7);
      expect(widths.question, "the question keeps a measure").toBeLessThanOrEqual(widths.card * 0.7);
    }

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
      // the debts of Täydennä lainat are headed by their payee's name, which wraps and is never cut either
      const debts = await page.locator(".review-debt-name").evaluateAll((els) =>
        els.map((h) => {
          const box = h.getBoundingClientRect();
          return { text: h.firstChild?.textContent ?? "", right: Math.round(box.right), clipped: h.scrollWidth > h.clientWidth };
        }),
      );
      for (const d of debts) {
        expect(d.clipped, `${d.text} is cut`).toBe(false);
        expect(d.right, `${d.text} leaves the screen`).toBeLessThanOrEqual(width);
        longest = Math.max(longest, d.text.length);
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
