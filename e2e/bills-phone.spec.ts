import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Laskut on a phone: the dates of the rows start at one x whatever a row carries beside its day (a late badge, "Kortilla"), and nothing
// a finger taps stands closer than 12 px to the screen edge. Runs on the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const ROW = "#laskut-taulukko table.sub-table tbody tr:not(.rt-detail):not(.rt-group):not(.rt-spacer)";

// the phone is also read with the text at 200 %, the browser's default size doubled, which the rem tokens follow
for (const { width, scale } of [{ width: 390, scale: 100 }, { width: 390, scale: 200 }, { width: 1440, scale: 100 }]) {
  test(`${width} px, text at ${scale} %: the dates of the rows start at one x, the days of the bars are apart and no control is within 12 px of the screen edge`, async ({ browser }) => {
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
    // the day labels under the bars stand apart and inside the page, and the next payment names its day
    await expect(page.locator(".pb-axis")).toBeAttached();
    const labels = await page.locator(".pb-axis li").evaluateAll((els) =>
      els.flatMap((li) => {
        if (!li.textContent?.trim()) return [];
        const range = document.createRange();
        range.selectNodeContents(li);
        const box = range.getBoundingClientRect();
        return [{ text: li.textContent.trim(), left: box.left, right: box.right }];
      }),
    );
    expect(labels.length, "day labels").toBeGreaterThan(1);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.left, `${labels[i - 1]!.text} and ${labels[i]!.text} overlap`).toBeGreaterThanOrEqual(labels[i - 1]!.right - 0.5);
    for (const l of labels) {
      expect(l.left, `${l.text}: left edge`).toBeGreaterThanOrEqual(0);
      expect(l.right, `${l.text}: right edge`).toBeLessThanOrEqual(width);
    }
    await expect(page.locator(".bills-next-day"), "the day of the next payment").toHaveText(/^\p{L}{2} \d{1,2}\.\d{1,2}\./u);
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
        // the short list of what has ended has three columns that fit a phone: it stays a table, with its days in their column
        const block = row.closest(".rt-wrap")?.hasAttribute("data-block") ?? false;
        return { name: row.querySelector(".sub-merchant")?.textContent ?? "", left: Math.round(first?.left ?? -1), tags, block };
      }),
    );
    expect(found.length, "rows").toBeGreaterThan(5);
    // the demo has a row with a tag beside its day and a row without, or the check proves nothing
    expect(found.some((r) => r.tags.length), "a row with a tag").toBe(true);
    expect(found.some((r) => !r.tags.length), "a row without").toBe(true);
    if (phone) expect(new Set(found.filter((r) => r.block).map((r) => r.left)), `x of the dates: ${JSON.stringify(found)}`).toHaveProperty("size", 1);

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
