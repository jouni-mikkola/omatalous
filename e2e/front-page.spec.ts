import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Nyt answers one question: how much can we still spend before payday (docs/design/README.md section 1.1). The demo
// household of the administrator (e2e/run.mjs made it) has pay, rent and everyday spending, so the answer has a sum.
// Core's tests hold the figures (packages/core/test/nyt.test.ts); this spec holds what a household sees of them: the
// answer is the sum core gives, it is the only block of the page, it fits the first screen of a phone, and the page is
// short and does not move when it has loaded. The sum opens the balance and the bills it is made of, and the pace line
// opens this month's rows (the action of section 1.1).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
/** The page's height at the two widths it is held to: the roadmap's N11. */
const MAX_HEIGHT = { 1440: 1400, 390: 2400 } as const;
/** The longest a page may change in height once its answer has landed. */
const MAX_JUMP = 0.25;

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  await expect(page.locator(".home-answer-line")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

/** The page's own height, from the top of the page to the bottom of its last block. */
const heightOf = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollHeight);

/** Every sum of money in a text as cents, in the order it stands. */
const sums = (text: string): number[] => (plain(text).match(/[-+]?\d[\d ]*(?:,\d+)?\s?€/g) ?? []).map(cents);

/** What the server says the page tells: the Nyt answer of core (`nytAnswer`, the roadmap's T63). */
async function answerOf(context: BrowserContext) {
  const response = await context.request.get("/api/dashboard?scope=own");
  expect(response.ok()).toBe(true);
  return (await response.json()).nyt;
}

for (const width of [390, 1440] as const) {
  test(`at ${width} px the answer is the sum left before payday that the server gives, and the page has no other card`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await open(context);
    const seen = watch(page);
    const nyt = await answerOf(context);
    expect(nyt?.left.known, "the demo household has a payday and a balance").toBe(true);
    const { left } = nyt;
    // the answer: the sentence names the payday and ends on the sum, in whole euros
    const line = page.locator(".home-answer-line");
    await expect(line).toContainText("Palkkapäivään");
    await expect(line).toContainText("jää");
    expect(cents(await line.locator(".fig").innerText()), "the answer is the sum of core, in whole euros").toBe(Math.round(left.leftCents / 100) * 100);
    // the two figures it is made of, to the cent: the sum opens them, and balance less bills is the sum
    await expect(page.locator(".nyt-parts")).toHaveCount(0);
    await line.getByRole("button").click();
    const [balance, bills] = sums(await page.locator(".nyt-parts").innerText());
    expect(balance).toBe(left.balanceCents);
    expect(bills).toBe(left.billsCents);
    expect(balance! - bills!, "balance less bills is what is left").toBe(left.leftCents);
    // the comparison: the sum per day left, and the month's spending to today
    if (left.days > 0) expect(sums(await page.locator(".nyt-per-day").innerText())[0]).toBe(Math.round(left.perDayCents / 100) * 100);
    expect(sums(await page.locator(".nyt-pace").innerText())[0]).toBe(Math.round(nyt.pace.spentCents / 100) * 100);
    if (nyt.pace.usual) await expect(page.locator(".nyt-pace")).toContainText("tavallinen");
    // no other card: the answer is the one block of the page
    await expect(page.locator("main .card")).toHaveCount(0);
    await expect(page.locator("main section")).toHaveCount(1);
    await expect(page.locator("main .page-grid.front > *")).toHaveCount(1);
    expect(await heightOf(page), `the page is ${await heightOf(page)} px high at ${width} px`).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    expect(await overflow(page)).toBe(0);
    // the one look and the one view: no Väljä/Tiivis and no Kaavio/Taulukko to choose
    for (const name of ["Väljä", "Tiivis", "Kaavio", "Taulukko"]) await expect(page.getByRole("radio", { name }).or(page.getByRole("tab", { name })).or(page.getByRole("button", { name, exact: true }))).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("the sum opens a balance and bills that give it to the cent, and the pace line opens this month's rows", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  const seen = watch(page);
  const nyt = await answerOf(context);
  expect(nyt?.left.known, "the demo household has a payday and a balance").toBe(true);
  const { left } = nyt;
  // the sum is a button named by the whole sentence; closed, the page has no parts
  const sum = page.getByRole("button", { name: /^Palkkapäivään .* jää .*€$/ });
  await expect(sum).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".nyt-parts")).toHaveCount(0);
  await sum.click();
  await expect(sum).toHaveAttribute("aria-expanded", "true");
  const parts = page.locator(".nyt-parts");
  await expect(parts).toContainText("Saldo");
  await expect(parts).toContainText("laskut ennen palkkapäivää");
  const [balance, bills] = sums(await parts.innerText());
  expect(balance, "the balance of core").toBe(left.balanceCents);
  expect(bills, "the bills of core").toBe(left.billsCents);
  expect(balance! - bills!, "balance less bills is the sum, to the cent").toBe(left.leftCents);
  expect(cents(await sum.locator(".fig").innerText()), "the answer is that sum in whole euros").toBe(Math.round((balance! - bills!) / 100) * 100);
  // a second click closes them
  await sum.click();
  await expect(parts).toHaveCount(0);
  // the pace line is a link to the rows of the running month to today, the period Tapahtumat calls Tämä kuu
  const today: string = nyt.from;
  await page.locator(".nyt-pace").getByRole("link", { name: /^Käytetty / }).click();
  await expect(page).toHaveURL(new RegExp(`#/transactions\\?from=${today.slice(0, 7)}-01&to=${today}$`));
  await expect(page).toHaveTitle(/^Tapahtumat/);
  await expect(page.locator(".tx-fchip.set")).toContainText("Tämä kuu");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("at 390 px the answer and what it is a day are on the first screen", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await open(context);
  for (const selector of [".home-answer-line", ".nyt-pace"]) {
    const box = (await page.locator(selector).first().boundingBox())!;
    expect(box.y + box.height, `${selector} ends on the first screen`).toBeLessThanOrEqual(844);
  }
  await context.close();
});

test("the page is the answer alone: the findings, the payment list, Varat ja velat and the old blocks are gone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await open(context);
  for (const gone of ["Huomioitavaa", "Kuukausi", "Varat ja velat", "Menot tässä kuussa", "Tulot ja menot", "Asuminen", "Luottokortit", "Miksi kuu poikkeaa"]) await expect(page.locator("main").getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Näytä maksut" })).toHaveCount(0);
  await expect(page.locator(".home-notable, .home-note, .home-sum-row, .home-direction, .home-reliability, .wf, .holding-groups")).toHaveCount(0);
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
