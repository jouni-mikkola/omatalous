import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { openBillFolds, overflow, watch } from "./helpers.ts";

// Laskut on a phone: the three cards of the kinds (Nyt, Arvio, Tavallinen) share one row at 100 % and keep their text inside, the
// days of the rows start at one x whatever a row carries beside its day (a status, "Kortilla"), and nothing a finger taps stands
// closer than 12 px to the screen edge. Runs on the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const ROW = "#laskut-taulukko table.sub-table tbody tr:not(.rt-detail):not(.rt-group):not(.rt-spacer):not(.rt-subrow)";

// the phone is also read with the text at 200 %, the browser's default size doubled, which the rem tokens follow
for (const { width, scale } of [{ width: 390, scale: 100 }, { width: 390, scale: 200 }, { width: 1440, scale: 100 }]) {
  test(`${width} px, text at ${scale} %: the days of the rows start at one x, the sums of a month fit and no control is within 12 px of the screen edge`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/bills");
    const rows = page.locator(ROW);
    await expect(rows.first()).toBeVisible();
    if (scale !== 100) {
      await page.addStyleTag({ content: `html { font-size: ${scale}%; }` });
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBeCloseTo((14 * scale) / 100, 1);
    }
    // the cards: Nyt, Arvio, Tavallinen in that order, in one row at the normal text size, and the text of none runs out of its card
    const cards = page.locator(".kind-cards .kind-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator(".kind-chip")).toHaveText(["Nyt", "Arvio", "Tavallinen"]);
    const boxes = await cards.evaluateAll((els) => els.map((el) => ({ top: Math.round(el.getBoundingClientRect().top), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, over: el.scrollWidth - el.clientWidth })));
    for (const b of boxes) {
      expect(b.over, "a card's text runs out of it").toBeLessThanOrEqual(1);
      expect(b.left, "a card's left edge").toBeGreaterThanOrEqual(0);
      expect(b.right, "a card's right edge").toBeLessThanOrEqual(width);
    }
    if (scale === 100) expect(new Set(boxes.map((b) => b.top)), "the three cards share a row").toHaveProperty("size", 1);
    // one month starts open; on a phone each closed month's head is one line: its name and one figure, a target of a finger's size
    await expect(page.locator("#laskut-taulukko .bill-month[aria-expanded=true]")).toHaveCount(1);
    if (phone) {
      const closed = await page.locator("#laskut-taulukko .bill-sums[data-closed]").evaluateAll((els) => els.map((el) => [...el.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.textContent ?? "")));
      expect(closed.length, "closed months").toBeGreaterThan(5);
      for (const shown of closed) expect(shown, "figures of a closed month").toHaveLength(1);
      if (scale === 100) {
        // the figure stands beside the name, inside the band of the opener: the head is one line
        const heads = await page.locator("#laskut-taulukko tr.rt-group:has(.bill-sums[data-closed])").evaluateAll((els) =>
          els.map((el) => {
            const name = el.querySelector(".bill-month")!.getBoundingClientRect();
            const figure = el.querySelector(".bill-line")!.getBoundingClientRect();
            return { text: el.textContent ?? "", top: figure.top - name.top, bottom: name.bottom - figure.bottom };
          }),
        );
        for (const h of heads) {
          expect(h.top, `${h.text}: figure above the name`).toBeGreaterThanOrEqual(-1);
          expect(h.bottom, `${h.text}: figure below the name`).toBeGreaterThanOrEqual(-1);
        }
      }
      for (const box of await page.locator("#laskut-taulukko .bill-month").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box, "a month's opener").toBeGreaterThanOrEqual(44);
    }
    if (process.env.E2E_SHOTS) {
      await page.locator("#laskut-taulukko").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `bills-${width}.png`) });
    }
    // a second month opened, so the rows of two months are compared
    await page.locator("#laskut-taulukko .bill-month[aria-expanded=false]").first().click();
    await expect(page.locator("#laskut-taulukko .bill-month[aria-expanded=true]")).toHaveCount(2);
    // and their folded rows opened, so the rows a card pays ("Kortilla") and the paid ones are among them
    await openBillFolds(page.locator("#laskut-taulukko"));
    // the sums of a month's head stay inside the page, wrapped when the room is short
    await expect(page.locator(".bill-sums").first()).toBeVisible();
    const sums = await page.locator(".bill-sums > span").evaluateAll((els) => els.map((el) => ({ text: el.textContent?.trim() ?? "", right: el.getBoundingClientRect().right })));
    for (const s of sums) expect(s.right, `${s.text}: right edge`).toBeLessThanOrEqual(width);
    const found = await rows.evaluateAll((els) =>
      els.flatMap((row) => {
        const cell = row.querySelector<HTMLElement>("th[scope=row]");
        // the one row that stands for a later month's monthly bills has no day
        if (!cell?.textContent?.trim()) return [];
        const range = document.createRange();
        range.selectNodeContents(cell);
        const first = range.getClientRects()[0];
        const block = row.closest(".rt-wrap")?.hasAttribute("data-block") ?? false;
        let head = row.previousElementSibling;
        while (head && !head.classList.contains("rt-group")) head = head.previousElementSibling;
        return [{ name: row.querySelector(".sub-merchant")?.textContent ?? "", month: head?.textContent ?? "", left: Math.round(first?.left ?? -1), block }];
      }),
    );
    expect(found.length, "rows").toBeGreaterThan(5);
    if (phone) {
      const inBlocks = found.filter((r) => r.block);
      // the days of two months are one column
      expect(new Set(inBlocks.map((r) => r.month)).size, "months with rows").toBeGreaterThan(1);
      expect(new Set(inBlocks.map((r) => r.left)), `x of the days: ${JSON.stringify(found)}`).toHaveProperty("size", 1);
    }

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
