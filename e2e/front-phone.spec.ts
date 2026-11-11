import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Nyt on a phone, at 320, 360 and 390 px wide: the answer, its lines under each other, and the chart of the month. Nothing scrolls sideways, no text is cut, and every control that is tapped is 44 px high and wide.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.locator(".home-answer-line")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

/** The elements that stick out of the screen's right edge, as a tag and class with how far. */
const sticking = (page: Page, width: number): Promise<string[]> =>
  page.evaluate((w) => Array.from(document.querySelectorAll("body *")).flatMap((e) => (e.getBoundingClientRect().right > w + 1 ? [`${e.tagName.toLowerCase()}.${String(e.getAttribute("class")).slice(0, 40)} ${Math.round(e.getBoundingClientRect().right - w)}`] : [])).slice(0, 8), width);

/** The elements of `list` whose text does not fit its own box, by their text. */
const cut = (list: Locator): Promise<string[]> =>
  list.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent ?? ""));

/** What of `list` is shorter or narrower than 44 px, with its size. */
const small = (list: Locator): Promise<string[]> =>
  list.evaluateAll((els) =>
    els.flatMap((e) => {
      const r = e.getBoundingClientRect();
      return r.width < 44 || r.height < 44 ? [`${(e.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`] : [];
    }),
  );

for (const width of [320, 360, 390]) {
  test(`${width} px: the lines stand under each other inside the screen, the sum fits, nothing scrolls sideways`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await open(context);
    const seen = watch(page);
    // the lines of the one block in one column: none is beside another
    const blocks = page.locator(".home-answer-line, .nyt-per-day, .nyt-pace, .pace-chart, .nyt-parts");
    let bottom = 0;
    for (const block of await blocks.all()) {
      const box = (await block.boundingBox())!;
      expect(box.x + box.width, "ends on the screen").toBeLessThanOrEqual(width);
      expect(box.y, "starts under the block before").toBeGreaterThanOrEqual(bottom - 1);
      bottom = box.y + box.height;
    }
    expect(await overflow(page), `the page scrolls sideways: ${(await sticking(page, width)).join("; ")}`).toBe(0);
    expect(await cut(page.locator(".home-answer-line, .nyt-per-day, .nyt-pace, .nyt-parts")), "text cut").toEqual([]);
    // the sum of the answer is inside the screen
    for (const cell of await page.locator(".home-answer-line .fig").all()) {
      const box = (await cell.boundingBox())!;
      expect(box.x, "starts on the screen").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "ends on the screen").toBeLessThanOrEqual(width);
    }
    // everything that is tapped on the page is tapped with a thumb
    expect(await small(page.locator("main :is(a, button, select, summary, input):visible, .nav a:visible")), "tap targets under 44 px").toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
