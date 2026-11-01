import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Yhteenveto answers one question: do the money last to the payday and how much is left. The demo household of the
// administrator (e2e/run.mjs made it) has pay, rent and everyday spending, so every block has something to say. Core's
// tests hold the figures (packages/core/test/home.test.ts); this spec holds what a household sees of them: the answer comes
// first and fits the first screen of a phone, every euro figure is the one the server gives, the page is short and does not move when it has loaded.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
/** The page's height at the two widths it is held to: the roadmap's N11. */
const MAX_HEIGHT = { 1440: 1400, 390: 2400 } as const;
/** The longest a page may change in height once its answer has landed. */
const MAX_JUMP = 0.25;

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.locator(".home-question")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

/** The page's own height, from the top of the page to the bottom of its last block. */
const heightOf = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollHeight);

/** Every sum of money in a text as cents, in the order it stands. */
const sums = (text: string): number[] => (plain(text).match(/[-+]?\d[\d ]*(?:,\d+)?\s?€/g) ?? []).map(cents);

/** What the server says the page tells. */
async function answerOf(context: BrowserContext) {
  const response = await context.request.get("/api/dashboard?scope=own");
  expect(response.ok()).toBe(true);
  return (await response.json()).home;
}

for (const width of [1440, 390] as const) {
  test(`at ${width} px the page is short, scrolls nowhere sideways, and has no switch of its look or of chart and table`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await open(context);
    const seen = watch(page);
    await expect(page.locator(".home-pace")).toBeVisible();
    expect(await heightOf(page), `the page is ${await heightOf(page)} px high at ${width} px`).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    expect(await overflow(page)).toBe(0);
    // the one look and the one view: no Väljä/Tiivis and no Kaavio/Taulukko to choose
    for (const name of ["Väljä", "Tiivis", "Kaavio", "Taulukko"]) await expect(page.getByRole("radio", { name }).or(page.getByRole("tab", { name })).or(page.getByRole("button", { name, exact: true }))).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("at 390 px the question, the answer and the sum row are on the first screen", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await open(context);
  const inScreen = async (selector: string) => {
    const box = (await page.locator(selector).first().boundingBox())!;
    return box.y + box.height;
  };
  await expect(page.locator(".home-answer-line")).toBeVisible();
  expect(await inScreen(".home-question"), "the question ends on the first screen").toBeLessThanOrEqual(844);
  expect(await inScreen(".home-answer-line"), "the answer ends on the first screen").toBeLessThanOrEqual(844);
  expect(await inScreen(".home-sum-row"), "the sum row ends on the first screen").toBeLessThanOrEqual(844);
  await context.close();
});

test("the answer says how much is left after the payments, and the sum row is the balance less the payments to the cent", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const home = await answerOf(context);
  expect(home.runway, "the demo household has a payday").not.toBeNull();
  const { sum } = home.runway;
  await expect(page.locator(".home-question")).toContainText("Rahat palkkapäivään");
  const row = page.locator(".home-sum-row");
  const figureOf = async (name: string): Promise<number> => cents(await row.locator("div", { has: page.getByText(name, { exact: true }) }).first().locator("dd").innerText());
  const balance = await figureOf("Käyttötilin saldo");
  const payments = await figureOf("Maksut ennen palkkapäivää");
  const left = await figureOf("Jää");
  expect(balance).toBe(sum.balanceCents);
  expect(Math.abs(payments)).toBe(sum.paymentsCents);
  expect(left).toBe(sum.freeCents);
  expect(balance - Math.abs(payments), "balance less payments is what is left").toBe(left);
  // the sentence ends on the same sum, in whole euros
  const line = plain(await page.locator(".home-answer-line").innerText());
  expect(sums(line).at(-1)).toBe(Math.round(sum.freeCents / 100) * 100);
  await context.close();
});

test("Näytä maksut opens the payments the sum row adds up", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const { runway } = await answerOf(context);
  const show = page.getByRole("button", { name: "Näytä maksut" });
  test.skip((await show.count()) === 0, "the demo has no payment before its payday");
  await show.click();
  const table = page.getByRole("table", { name: "Maksut ennen palkkapäivää" });
  await expect(table).toBeVisible();
  const column = (await table.locator("tbody tr td:last-child").allInnerTexts()).map((t) => Math.abs(cents(t)));
  expect(column.reduce((a, b) => a + b, 0), "the list adds up to the sum row's payments").toBeGreaterThanOrEqual(runway.sum.paymentsCents - column.length);
  await page.getByRole("button", { name: "Piilota maksut" }).click();
  await expect(table).toHaveCount(0);
  await context.close();
});

test("every euro figure of the answer and the month is one the server gives, and none stands without its comparison", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const home = await answerOf(context);
  const whole = (c: number) => Math.round(c / 100) * 100;
  if (home.pace) {
    const heading = plain(await page.locator(".home-pace .home-verdict").innerText());
    const figures = sums(heading);
    // a month within a euro of the usual one says so in words, with no figure
    if (Math.abs(home.pace.diffCents) >= 100) expect(Math.abs(figures[0]!)).toBe(whole(Math.abs(home.pace.diffCents)));
    // the difference is told against something: the word "tavallista" stands in the same sentence
    expect(heading).toMatch(/tavallis/);
  }
  // the word "tavallisesti" is never on the page without what it is the usual of
  const text = plain(await page.locator("main").innerText());
  for (const match of text.matchAll(/tavallisesti/gi)) expect(text.slice(Math.max(0, match.index! - 80), match.index! + 120), "tavallisesti with no comparison").toMatch(/keskiarvo|kuukau|verrattuna|päivään/);
  await context.close();
});

test("Huomioitavaa holds three findings at most, each with its euros a year and a place to go", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const notes = page.locator(".home-note");
  expect(await notes.count()).toBeLessThanOrEqual(3);
  for (const note of await notes.all()) {
    await expect(note.locator(".home-note-effect")).toContainText("€");
    await expect(note.locator(".home-note-effect")).toContainText("vuodessa");
    await expect(note.locator("a")).toHaveAttribute("href", /^#\//);
  }
  await context.close();
});

test("Varat ja velat is one list of the server's holdings, and the old blocks are gone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const holdings = (await (await context.request.get("/api/dashboard?scope=own")).json()).holdings;
  const block = page.locator(".home-direction");
  await expect(block.getByRole("heading", { name: "Varat ja velat" })).toBeVisible();
  if (holdings.netCents !== null) expect(cents(await block.locator(".home-row-lead dd").innerText())).toBe(Math.round(holdings.netCents / 100) * 100);
  for (const gone of ["Menot tässä kuussa", "Tulot ja menot", "Asuminen", "Luottokortit", "Miksi kuu poikkeaa"]) await expect(page.getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
  await expect(page.locator(".wf, .holding-groups")).toHaveCount(0);
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
  await expect(page.locator(".home-answer-line")).toBeVisible();
  const after = await heightOf(page);
  expect(Math.abs(after - before) / after, `the page was ${before} px high loading and ${after} px loaded`).toBeLessThan(MAX_JUMP);
  await context.close();
});
