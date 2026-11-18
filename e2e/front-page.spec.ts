import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, OVERVIEW_TILES, plain, watch } from "./helpers.ts";

// Yhteenveto has four blocks (docs/design/README.md section 1.1): Nyt (what is left before payday), the month (Tulot,
// Menot and Tulos, and under them where the income went), the coming months and the accounts. The demo household of the administrator (e2e/run.mjs
// made it) has pay, rent and everyday spending, so every figure is there. Core's tests hold the figures
// (packages/core/test/nyt.test.ts, overview.test.ts); this spec holds what a household sees of them: each figure is the
// one the server gives, the three fit the first screen of a phone, the blocks under them are the ones of the page, and
// the page does not move when it has loaded.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
/** The page's height at the two widths it is held to: the roadmap's N11. */
const MAX_HEIGHT = { 1440: 1500, 390: 2600 } as const;
/** The longest a page may change in height once its answer has landed. */
const MAX_JUMP = 0.25;

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.locator(OVERVIEW_TILES)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".home-coming tbody tr").first()).toBeVisible({ timeout: 15_000 });
  return page;
}

/** The page's own height, from the top of the page to the bottom of its last block. */
const heightOf = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollHeight);

/** Every sum of money in a text as cents, in the order it stands. */
const sums = (text: string): number[] => (plain(text).match(/[-+]?\d[\d ]*(?:,\d+)?\s?€/g) ?? []).map(cents);

/** What the server says the page tells: the dashboard answer, its Nyt part of core (`nytAnswer`, the roadmap's T63) first. */
async function answerOf(context: BrowserContext) {
  const response = await context.request.get("/api/dashboard?scope=own");
  expect(response.ok()).toBe(true);
  return await response.json();
}

/** A figure of the month (income, spent, result) as cents. */
const monthFigure = async (page: Page, id: string): Promise<number> => cents(await page.locator(`[data-fig=${id}] .fig`).innerText());

for (const width of [390, 1440] as const) {
  test(`at ${width} px the figures are the ones the server gives`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await open(context);
    const seen = watch(page);
    const dashboard = await answerOf(context);
    const { nyt, overview, home, totals } = dashboard;
    expect(nyt?.left.known, "the demo household has a payday and a balance").toBe(true);
    const { left } = nyt;
    // every figure in whole euros, as the server gives it
    const whole = (c: number) => Math.round(c / 100) * 100;
    expect(await monthFigure(page, "income"), "the month's income").toBe(whole(overview.income.cents));
    expect(await monthFigure(page, "spent"), "the month's spending").toBe(whole(home.pace?.spentCents ?? nyt.pace.spentCents));
    expect(await monthFigure(page, "result"), "Tulos").toBe(whole(totals.leftCents));
    expect(cents(await page.locator("[data-tile=left] .fig").innerText()), "what is left before payday").toBe(whole(left.leftCents));
    if (left.days > 0) expect(sums(await page.locator("[data-tile=left] .home-fig-line").innerText())[0]).toBe(whole(left.perDayCents));
    // the month's figures are no list's sum, so they lead nowhere; the one link of Nyt is the figure's, to Laskut' table
    await expect(page.locator(".home-figs a, .home-figs button")).toHaveCount(0);
    await expect(page.locator("[data-tile=left]")).toHaveAttribute("href", "#/bills#laskut-taulukko");
    // no chart and no category bars: the twelve months are on Raportit > Menot
    await expect(page.locator("main .month-bars, main .where-row")).toHaveCount(0);
    // the four blocks in their order, each once, and no notice
    await expect(page.locator("main .home-figs > li")).toHaveCount(3);
    await expect(page.locator("main .home-flow")).toHaveCount(1);
    const classes = await page.locator(".home-now, .home-summary, .home-coming, .holdings").evaluateAll((els) => els.map((e) => e.getAttribute("class") ?? ""));
    const order = classes.map((c) => c.split(" ").find((name) => /^home-|^holdings$/.test(name)));
    expect(order).toEqual(["home-now", "home-summary", "home-coming", "holdings"]);
    expect(await page.locator("main .card h2").allInnerTexts()).toEqual(["Tulevat kuukaudet", "Varat ja velat"]);
    await expect(page.locator("main .notice, main .home-notice")).toHaveCount(0);
    // the buffer line at the foot of Varat ja velat: core's months, and its drill holds the two sums they divide, or core's reason
    const buffer = page.locator(".holdings .home-buffer");
    await expect(buffer).toHaveCount(1);
    const { bufferMonths, bufferNetCents, bufferSpendCents, bufferGap } = home.direction;
    if (bufferMonths === null) {
      expect(plain(await buffer.innerText())).toBe(`Puskuri ${{ "no-balance": "Ei saldoa", history: "Liian lyhyt historia", "no-spending": "Ei menoja" }[bufferGap!]}`);
    } else {
      const months = bufferMonths.toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      await expect(buffer.locator("summary")).toHaveText(`Puskuri ${months} kk`);
      await buffer.locator("summary").click();
      expect(sums(await buffer.locator(".st-num").allInnerTexts().then((all) => all.join(" ")))).toEqual([bufferNetCents, bufferSpendCents]);
    }
    expect(await heightOf(page), `the page is ${await heightOf(page)} px high at ${width} px`).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    expect(await overflow(page)).toBe(0);
    // the one look and the one view: no Väljä/Tiivis and no Kaavio/Taulukko to choose
    for (const name of ["Väljä", "Tiivis", "Kaavio", "Taulukko"]) await expect(page.getByRole("radio", { name }).or(page.getByRole("tab", { name })).or(page.getByRole("button", { name, exact: true }))).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("at 390 px Tulot and Menot stand side by side, Tulos under them, and Tulos is on the first screen", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await open(context);
  const boxes = await Promise.all((await page.locator(".home-figs > li").all()).map(async (item) => (await item.boundingBox())!));
  expect(boxes).toHaveLength(3);
  expect(boxes[1]!.y, "Menot beside Tulot").toBe(boxes[0]!.y);
  expect(boxes[1]!.x, "Menot after Tulot").toBeGreaterThan(boxes[0]!.x);
  expect(boxes[2]!.y, "Tulos under them").toBeGreaterThan(boxes[1]!.y);
  const result = boxes[2]!;
  expect(result.y + result.height, "Tulos ends on the first screen").toBeLessThanOrEqual(844);
  await context.close();
});

test("at 1440 px Tulot, Menot and Tulos stand on one row with Tulos the last and the largest", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const boxes = await Promise.all((await page.locator(".home-figs > li").all()).map(async (item) => (await item.boundingBox())!));
  expect(boxes[0]!.y).toBe(boxes[1]!.y);
  expect(boxes[1]!.y).toBe(boxes[2]!.y);
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  const size = (id: string) => page.locator(`[data-fig=${id}] .fig`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size("result"), "Tulos is the largest figure").toBeGreaterThan(await size("income"));
  await context.close();
});

test("the coming months tell the figures the month heads of Laskut tell", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const response = await context.request.get("/api/reports?scope=own&reports=billCalendar");
  expect(response.ok()).toBe(true);
  const { billCalendar } = await response.json();
  const rows = page.locator(".home-coming tbody tr");
  await expect(rows).toHaveCount(3);
  for (const [i, month] of billCalendar.months.slice(0, 3).entries()) {
    const [, bills, income, after] = await rows.nth(i).locator("th, td").allInnerTexts();
    expect(sums(bills!)[0], `${month.month}: the bills`).toBe(month.billsCents);
    if (month.estimateCents > 0) expect(sums(bills!)[1], `${month.month}: their estimated part`).toBe(month.estimateCents);
    if (month.incomeCents > 0) expect(sums(income!)[0], `${month.month}: the pays`).toBe(month.incomeCents);
    if (month.incomeCents > 0 && month.afterCents !== null) expect(sums(after!)[0], `${month.month}: after the bills`).toBe(month.afterCents);
    // a sum that is not known is said so and is no 0
    if (month.incomeCents > 0 && month.afterCents === null) expect(plain(after!)).toBe("Ei tiedossa");
  }
  // the same three months on Laskut's own heads
  await page.goto("/#/bills");
  await expect(page.locator(".bill-sums").first()).toBeVisible({ timeout: 15_000 });
  const heads = (await page.locator(".bill-sums").allInnerTexts()).slice(0, 3);
  for (const [i, month] of billCalendar.months.slice(0, 3).entries()) expect(sums(heads[i]!)[0], `${month.month}: Laskut' head`).toBe(month.billsCents);
  await context.close();
});

test("what belongs to Laskut and Raportit is not on the page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  for (const gone of ["Asuminen", "Miksi kuu poikkeaa", "Huomioitavaa"]) await expect(page.locator("main").getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Näytä maksut" })).toHaveCount(0);
  await expect(page.locator(".home-reliability, .wf")).toHaveCount(0);
  await context.close();
});

test("with the answer 3 s late the page keeps its place: its height changes less than 25 % when it has loaded", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  await context.route(/\/api\/dashboard(\?|$)/, async (route) => {
    await new Promise((done) => setTimeout(done, 3000));
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.locator(".home-skeleton")).toBeVisible();
  const before = await heightOf(page);
  await expect(page.locator(".home-skeleton")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(OVERVIEW_TILES)).toBeVisible();
  const after = await heightOf(page);
  expect(Math.abs(after - before) / after, `the page was ${before} px high loading and ${after} px loaded`).toBeLessThan(MAX_JUMP);
  await context.close();
});
