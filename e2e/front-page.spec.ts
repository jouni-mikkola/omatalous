import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, OVERVIEW_TILES, plain, watch } from "./helpers.ts";

// Yhteenveto has two blocks: Nyt (what is left before payday, its parts behind the figure) and the balance of the days to it.
// The demo household of the administrator (e2e/run.mjs made it) has pay, rent and everyday spending, so every figure is
// there. Core's tests hold the figures (packages/core/test/nyt.test.ts); this spec holds what a household sees of them:
// each figure is the one the server gives, the blocks are the ones of the page, and the page does not move when it has loaded.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
/** The page's height at the two widths it is held to: the roadmap's N11. */
const MAX_HEIGHT = { 1440: 1500, 390: 1500 } as const;
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


/** What the server says the page tells: the dashboard answer, its Nyt part of core (`nytAnswer`, the roadmap's T63) first. */
async function answerOf(context: BrowserContext) {
  const response = await context.request.get("/api/dashboard?scope=own");
  expect(response.ok()).toBe(true);
  return await response.json();
}

for (const width of [390, 1440] as const) {
  test(`at ${width} px the figures are the ones the server gives`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await open(context);
    const seen = watch(page);
    const dashboard = await answerOf(context);
    const { nyt, home } = dashboard;
    expect(nyt?.left.known, "the demo household has a payday and a balance").toBe(true);
    const { leftOnPayday } = home.runway;
    expect(leftOnPayday.known, "and three complete months to expect its everyday spending from").toBe(true);
    // every figure in whole euros, as the server gives it
    const whole = (c: number) => Math.round(c / 100) * 100;
    expect(cents(await page.locator("[data-tile=left] .fig").innerText()), "what is left on payday, in whole euros").toBe(whole(leftOnPayday.leftCents));
    const [, paydayMonth, paydayDay] = leftOnPayday.payday.date.split("-").map(Number);
    // the verdict is the heading of the figure's section: it names the payday while the money is enough, the missing sum when it is not
    const verdict = leftOnPayday.leftCents < 0 ? /^Puuttuu .+ ennen palkkapäivää$/ : `Riittää palkkapäivään ${paydayDay}.${paydayMonth}.`;
    await expect(page.getByRole("heading", { name: verdict, level: 2 })).toHaveCount(1);
    await expect(page.getByRole("region", { name: verdict })).toHaveCount(1);
    if (leftOnPayday.days === 0) expect(plain(await page.locator("[data-tile=left] .home-row-note").innerText())).toBe("Palkkapäivä tänään");
    // the panel behind the figure holds the parts of the answer, in cents, and the four that take off add up to the figure to the cent
    await page.locator(".home-now .fig-open").click();
    const { parts } = leftOnPayday;
    const rowCents = async (row: string) => cents(await page.locator(`.home-rows [data-row=${row}] dd`).innerText());
    expect(await rowCents("balance"), "the accounts today").toBe(parts.balanceCents);
    expect(await rowCents("bills"), "the bills before the payday").toBe(parts.bills.cents);
    expect(await rowCents("spending"), "the expected spending").toBe(parts.spending.cents);
    if (parts.cardBills.count > 0) expect(await rowCents("cards"), "the card bills before the payday").toBe(parts.cardBills.cents);
    expect(parts.balanceCents + parts.bills.cents + parts.cardBills.cents + parts.spending.cents, "the parts of the answer add up to the figure").toBe(leftOnPayday.leftCents);
    // the lowest balance of the days to the payday under it, only while it is unknown: a known one is the figure above. It is no link
    const { lowPoint } = home;
    const low = page.locator(".home-now .home-low");
    if (lowPoint.known) {
      await expect(low).toHaveCount(0);
    } else {
      await expect(low).toHaveCount(1);
      expect(plain(await low.innerText())).toMatch(new RegExp(`^Alin saldo ${lowPoint.days} päivän aikana: \\D+$`));
    }
    await expect(low.locator("a")).toHaveCount(0);
    // the one link of Nyt is the bills row's, to Laskut' table
    await expect(page.locator("[data-tile=bills]")).toHaveAttribute("href", "#/bills#laskut-taulukko");
    // no chart and no category bars: the twelve months are on Raportit > Menot
    await expect(page.locator("main .month-bars, main .where-row")).toHaveCount(0);
    // Nyt first, the balance of the days after it, and none of the blocks that belong to other pages
    const headings = (await page.locator("main .card h2").allInnerTexts()).map((h) => h.replace(/\s+/g, " ").trim());
    expect(headings[0]).toMatch(verdict);
    expect(headings.slice(1).every((h) => h === "Saldo päivä päivältä")).toBe(true);
    await expect(page.locator(".home-summary, .home-coming, .holdings, .home-buffer")).toHaveCount(0);
    await expect(page.locator("main .notice, main .home-notice")).toHaveCount(0);
    // Saldo päivä päivältä: the line runs from today to the payday and each payment of the walk is a dot on it
    if (home.lowPoint?.known && home.lowPoint.line.length > 1) await expect(page.locator(".home-days .balance-steps .bs-bill")).toHaveCount(home.lowPoint.steps.filter((s: { cents: number }) => s.cents < 0).length);
    expect(await heightOf(page), `the page is ${await heightOf(page)} px high at ${width} px`).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    expect(await overflow(page)).toBe(0);
    // the one look and the one view: no Väljä/Tiivis and no Kaavio/Taulukko to choose
    for (const name of ["Väljä", "Tiivis", "Kaavio", "Taulukko"]) await expect(page.getByRole("radio", { name }).or(page.getByRole("tab", { name })).or(page.getByRole("button", { name, exact: true }))).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

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
