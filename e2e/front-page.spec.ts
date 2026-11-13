import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Yhteenveto opens on four tiles (docs/design/README.md section 1.1): what is left before payday, the month's spending
// and income, and what the household has net. The demo household of the administrator (e2e/run.mjs made it) has pay,
// rent and everyday spending, so every tile has a figure. Core's tests hold the figures (packages/core/test/nyt.test.ts,
// overview.test.ts); this spec holds what a household sees of them: each tile is the figure the server gives, the tiles
// fit the first screen of a phone, the blocks under them are the ones of the page, and the page does not move when it
// has loaded.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
/** The page's height at the two widths it is held to: the roadmap's N11. */
const MAX_HEIGHT = { 1440: 1500, 390: 2600 } as const;
/** The longest a page may change in height once its answer has landed. */
const MAX_JUMP = 0.25;

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.locator(".home-tiles")).toBeVisible({ timeout: 15_000 });
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

/** A tile's figure as cents. */
const tileFigure = async (page: Page, id: string): Promise<number> => cents(await page.locator(`[data-tile=${id}] .fig`).innerText());

for (const width of [390, 1440] as const) {
  test(`at ${width} px the tiles are the figures the server gives`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await open(context);
    const seen = watch(page);
    const dashboard = await answerOf(context);
    const { nyt, overview, holdings, home } = dashboard;
    expect(nyt?.left.known, "the demo household has a payday and a balance").toBe(true);
    const { left } = nyt;
    // every tile in whole euros, as the server gives it
    const whole = (c: number) => Math.round(c / 100) * 100;
    expect(await tileFigure(page, "left"), "what is left before payday").toBe(whole(left.leftCents));
    if (left.days > 0) expect(sums(await page.locator("[data-tile=left] .home-tile-line").innerText())[0]).toBe(whole(left.perDayCents));
    expect(await tileFigure(page, "spent"), "the month's spending").toBe(whole(home.pace?.spentCents ?? nyt.pace.spentCents));
    expect(await tileFigure(page, "income"), "the month's earned income").toBe(whole(overview.income.cents));
    expect(await tileFigure(page, "net"), "the accounts less the debts").toBe(whole(holdings.netCents));
    if (overview.net) expect(sums(await page.locator("[data-tile=net] .home-tile-line").innerText())[0]).toBe(whole(Math.abs(overview.net.changeCents)));
    // each tile leads to its rows
    // what is left, the spending and the income open their own rows in the panel, as no list adds up to them
    for (const id of ["left", "spent", "income"]) await expect(page.locator(`[data-tile=${id}] button.why-door`)).toHaveCount(1);
    await expect(page.locator("[data-tile=net] a")).toHaveAttribute("href", "#/reports?q=saldot");
    // the bars are the server's largest categories, in its order and with its sums
    const { top } = (await (await context.request.get("/api/dashboard?scope=own")).json()) as { top: { rows: { label: string; cents: number }[] } };
    const bars = page.locator(".where-row");
    await expect(bars).toHaveCount(top.rows.length);
    for (const [i, row] of top.rows.entries()) {
      await expect(bars.nth(i).locator(".where-name")).toHaveText(row.label);
      expect(cents(await bars.nth(i).locator(".where-sum").innerText())).toBe(Math.round(row.cents / 100) * 100);
    }
    // four tiles, and under them the month, the categories and the accounts: each once, and no notice
    await expect(page.locator("main .home-tile")).toHaveCount(4);
    expect(await page.locator("main .card h2").allInnerTexts()).toEqual(["Kuukausi", "Suurimmat menot", "Varat ja velat"]);
    await expect(page.locator("main .notice, main .home-notice")).toHaveCount(0);
    expect(await heightOf(page), `the page is ${await heightOf(page)} px high at ${width} px`).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    expect(await overflow(page)).toBe(0);
    // the one look and the one view: no Väljä/Tiivis and no Kaavio/Taulukko to choose
    for (const name of ["Väljä", "Tiivis", "Kaavio", "Taulukko"]) await expect(page.getByRole("radio", { name }).or(page.getByRole("tab", { name })).or(page.getByRole("button", { name, exact: true }))).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("at 390 px the four tiles, two by two, and the month's line are on the first screen", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await open(context);
  const boxes = await Promise.all((await page.locator(".home-tile").all()).map(async (tile) => (await tile.boundingBox())!));
  expect(boxes[0]!.y, "two on a row").toBe(boxes[1]!.y);
  expect(boxes[2]!.y, "the second row under the first").toBeGreaterThan(boxes[0]!.y);
  for (const selector of [".home-tiles", ".home-pace-line"]) {
    const box = (await page.locator(selector).first().boundingBox())!;
    expect(box.y + box.height, `${selector} ends on the first screen`).toBeLessThanOrEqual(844);
  }
  await context.close();
});

test("what belongs to Laskut and Raportit is not on the page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  for (const gone of ["Tulot ja menot", "Asuminen", "Miksi kuu poikkeaa", "Huomioitavaa"]) await expect(page.locator("main").getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
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
  await expect(page.locator(".home-tiles")).toBeVisible();
  const after = await heightOf(page);
  expect(Math.abs(after - before) / after, `the page was ${before} px high loading and ${after} px loaded`).toBeLessThan(MAX_JUMP);
  await context.close();
});
