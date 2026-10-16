import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { stubCockpit, type Cockpit } from "./cockpit-stub.ts";
import { overflow, watch } from "./helpers.ts";

// Yhteenveto on a phone, at 320, 360 and 390 px wide: the waterfall of the month, the sentence of the joint pools and the ticks
// beside the balances. Nothing scrolls sideways, no text is cut, and every control that is tapped is 44 px high and wide.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

async function open(context: BrowserContext, how: Cockpit): Promise<Page> {
  await stubCockpit(context, how);
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".wf")).toBeVisible();
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
  test(`${width} px: the waterfall has a row for each bar, the sentence and the ticks fit, nothing scrolls sideways`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await open(context, { settlement: "uneven" });
    const seen = watch(page);
    const rows = page.locator(".wf-row");
    expect(await rows.count(), "income, four categories, the rest, transfers and Yli jäi").toBe(8);
    // the figure is at the right edge of its row, the bar under the name; both are on the screen
    for (const row of await rows.all()) {
      for (const part of [row.locator(".wf-fig"), row.locator(".wf-track")]) {
        const box = (await part.boundingBox())!;
        expect(box.x, "starts on the screen").toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, "ends on the screen").toBeLessThanOrEqual(width);
      }
    }
    expect(await overflow(page), `the page scrolls sideways: ${(await sticking(page, width)).join("; ")}`).toBe(0);
    expect(await cut(page.locator(".wf-label, .wf-fig, .wf-settle p")), "text cut").toEqual([]);
    // down is hatched and up is solid: the pattern is the cue besides colour
    expect(await page.locator(".wf-down .wf-bar").first().evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("repeating-linear-gradient");
    expect(await page.locator(".wf-up .wf-bar").first().evaluate((e) => getComputedStyle(e).backgroundImage)).not.toContain("repeating-linear-gradient");
    // the three ticks of the demo's accounts: ✓, !, and none
    await expect(page.locator(".holding-tick-ok")).toHaveAttribute("title", "Täsmää pankin saldoon");
    await expect(page.locator(".holding-tick-diff")).toHaveAttribute("title", "Täsmää pankin saldoon: ei täsmää");
    expect(await cut(page.locator(".holding-account .st-num, .holding-account .st-name")), "balance rows cut").toEqual([]);
    // the controls of the new parts are tapped with a thumb
    expect(await small(page.locator("button.wf-hit, .wf-settle a")), "tap targets under 44 px").toEqual([]);
    // and so is everything else that is tapped on the page
    expect(await small(page.locator("main :is(a, button, select, summary, input):visible, .nav a")), "tap targets under 44 px").toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("390 px: the bar of Yli jäi opens its rows, an empty month says so in a sentence, an even pool says so", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const page = await open(context, { settlement: "even" });
  await expect(page.locator(".wf-settle")).toContainText("Yhteiset menot ovat tasan.");
  await page.getByRole("button", { name: "Näytä rivit: Yli jäi" }).tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator("table.why-rows tbody tr").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await context.close();

  const empty = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await stubCockpit(empty, { empty: true, settlement: "none" });
  const blank = await empty.newPage();
  await blank.goto("/#/overview");
  await expect(blank.locator(".wf-empty")).toHaveText("Tässä kuussa ei ole vielä tapahtumia.");
  await expect(blank.locator(".wf-settle")).toHaveCount(0);
  expect(await overflow(blank)).toBe(0);
  await empty.close();
});
