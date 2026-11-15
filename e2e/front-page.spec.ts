import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, OVERVIEW_TILES, plain, watch } from "./helpers.ts";

// Yhteenveto opens on the month (docs/design/README.md section 1.1): Tulot, Menot and Tulos, and under them where the
// income went. What is left before payday stands with the bills. The demo household of the administrator (e2e/run.mjs
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
    // the month's figures are no list's sum, so they lead nowhere; what is left before payday leads to its list
    await expect(page.locator(".home-figs a, .home-figs button")).toHaveCount(0);
    await expect(page.locator("[data-tile=left]")).toHaveAttribute("href", "#/bills#ennen-palkkapaivaa");
    // the bars are the server's largest categories, in its order and with its sums
    const top = overview.categories;
    const bars = page.locator(".where-row");
    await expect(bars).toHaveCount(top.rows.length);
    for (const [i, row] of top.rows.entries()) {
      await expect(bars.nth(i).locator(".where-name")).toHaveText(row.label);
      expect(cents(await bars.nth(i).locator(".where-sum").innerText())).toBe(Math.round(row.cents / 100) * 100);
    }
    // twelve months, each opening its rows, the running one to today
    const months = page.locator("svg a.mb-link");
    await expect(months).toHaveCount(overview.months.length);
    await expect(months.last()).toHaveAttribute("href", `#/transactions?from=${overview.months.at(-1)!.month}-01&to=${nyt.from}`);
    // the bills to the payday end on the tile's own sum of them
    expect(cents(await page.locator(".home-bills tfoot td").last().innerText())).toBe(whole(left.billsCents));
    // three figures and the use of the income, and under them the months, the bills, the categories and the accounts: each once, and no notice
    await expect(page.locator("main .home-figs > li")).toHaveCount(3);
    await expect(page.locator("main .home-flow")).toHaveCount(1);
    expect(await page.locator("main .card h2").allInnerTexts()).toEqual(["Tulot ja menot", "Tulevat laskut", "Menot kategorioittain", "Tilit ja kortit"]);
    await expect(page.locator("main .notice, main .home-notice")).toHaveCount(0);
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
