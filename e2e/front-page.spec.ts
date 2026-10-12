import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The first page (Yhteenveto) opens with what the household has and owes: accounts, cards, loans. The demo household of
// the administrator that e2e/run.mjs made has a checking and a savings account and a card with no limit, and no saved
// loan; this spec saves one through the loans route and removes it at the end, so the specs after it find the household
// as they expect. Every figure on the page must be the one Raportit > Saldot and Lainat give. The demo card has no limit
// and the app has no way to give it one, so the card with a limit is the page's own answer changed on its way, with
// figures as the bank and core would give them (core's tests hold the figures; this spec holds what a household sees of
// them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };

test.describe.configure({ mode: "serial" });

/** Spaces, no-break spaces and the typographic minus as a reader sees them. */
const plain = (s: string) => s.replace(/[\s  ]+/g, " ").replace(/−/g, "-").trim();
/** "1 058,40 €" → 105840 */
const cents = (s: string) => Math.round(Number(plain(s).replace(/[ €]/g, "").replace(",", ".")) * 100);

async function signedIn(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

/** The holdings card of Yhteenveto: the only card with a heading Varallisuus on that page. */
const holdingsOf = (page: Page) => page.locator(".card").filter({ has: page.getByRole("heading", { name: "Varallisuus", exact: true }) });

/** What the page shows for an account: the amount in its row. */
const amountOf = async (page: Page, name: string): Promise<number> => cents(await holdingsOf(page).locator(".holding-row", { hasText: name }).locator(".holding-amount").innerText());

/** Raportit > Saldot as a table: the figure of today for each account, by the account's name, in whole euros. */
async function saldot(page: Page): Promise<Record<string, number>> {
  await page.goto("/#/reports?period=year");
  const section = page.locator("#saldot");
  await section.getByRole("button", { name: "Taulukko" }).click();
  const heads = (await section.locator("thead th").allInnerTexts()).map(plain);
  const today = (await section.locator("tbody tr", { hasText: "(tänään)" }).locator("td").allInnerTexts()).map(plain);
  expect(today.length, "Saldot has a row for today").toBe(heads.length);
  // the first two columns are the month and the total
  return Object.fromEntries(heads.slice(2).map((name, i) => [name, cents(today[i + 2]!) / 100]));
}

let loanId = "";
test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  if (loanId) await context.request.delete(`/api/loans/${loanId}`, { headers: FETCH });
  await context.close();
});

test("the demo household: both accounts with their balance and a total, the card with what is used and no bar, no Lainat", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await signedIn(context, "/#/overview");
  const seen = watch(page);
  expect((await (await context.request.get("/api/loans")).json()).loans, "no saved loan before this spec").toEqual([]);

  const holdings = holdingsOf(page);
  await expect(holdings).toBeVisible();
  await expect(holdings.getByRole("heading", { level: 2 })).toHaveText(["Varallisuus"]);
  await expect(holdings.getByRole("heading", { level: 3 })).toHaveText(["Tilit", "Luottokortit"]);
  const checking = await amountOf(page, "Käyttötili (esimerkki)");
  const savings = await amountOf(page, "Säästötili (esimerkki)");
  // the first row of Tilit is the total of the two, and the groups stand side by side
  const sum = holdings.locator(".holding-row").first();
  await expect(sum).toContainText("Yhteensä");
  expect(cents(await sum.locator(".holding-amount").innerText())).toBe(checking + savings);
  const [accountsBox, cardsBox] = await Promise.all(["Tilit", "Luottokortit"].map(async (name) => (await holdings.locator(".holding-group", { has: page.getByRole("heading", { name, exact: true }) }).boundingBox())!));
  expect(cardsBox!.x, "the groups are side by side").toBeGreaterThan(accountsBox!.x + accountsBox!.width - 2);
  expect(Math.abs(cardsBox!.y - accountsBox!.y)).toBeLessThanOrEqual(1);

  // the card: its name makes the face gold, the demo gives it no limit, so what is used alone is told and there is no bar
  const card = holdings.locator(".holding-card");
  await expect(card.locator(".card-face-gold")).toBeVisible();
  await expect(card.locator(".card-face")).toHaveAttribute("aria-hidden", "true");
  const face = (await card.locator(".card-face").boundingBox())!;
  expect([face.width, face.height]).toEqual([132, 83]);
  await expect(card.locator(".holding-name")).toContainText("Nordea Gold (esimerkki)");
  await expect(card.locator(".card-meter")).toHaveCount(0);
  const use = plain(await card.locator(".holding-figures").innerText());
  expect(use).toMatch(/^Käytetty luotto [\d ]+,\d\d €$/);
  const used = cents(use.replace("Käytetty luotto ", ""));

  // above the month
  const month = await page.getByRole("region", { name: "Menot", exact: true }).boundingBox();
  expect((await holdings.boundingBox())!.y, "the holdings are above the month").toBeLessThan(month!.y);

  // the figures are Saldot's, whole euros against the cents shown here
  const balances = await saldot(page);
  expect(Math.abs(checking / 100 - balances["Käyttötili (esimerkki)"]!)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(savings / 100 - balances["Säästötili (esimerkki)"]!)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(used / 100 - Math.abs(balances["Nordea Gold (esimerkki)"]!))).toBeLessThanOrEqual(0.5);

  expect(seen.problems).toEqual([]);
  await context.close();
});

/** The card as the answer of the first page gives it, and the loans if the test wants a row of them. */
interface CardStub {
  limitCents: number | null;
  usedCents: number | null;
  freeCents: number | null;
  overCents: number | null;
  balanceAt?: string | null;
}
const LIMIT = 300_000;
/** How much of its track the bar of a card fills, 0 to 1. */
const filled = (card: Locator) =>
  card.locator(".card-meter").evaluate((svg) => svg.querySelector(".card-meter-used")!.getBoundingClientRect().width / svg.querySelector(".card-meter-track")!.getBoundingClientRect().width);
const fillColour = (card: Locator) => card.locator(".card-meter-used").evaluate((el) => getComputedStyle(el).fill);

test("a card with a limit shows used, limit and free beside a bar, and over the limit it says so in words and in colour", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const week = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const page = await context.newPage();
  const seen = watch(page);
  let stub: CardStub = { limitCents: LIMIT, usedCents: 124_000, freeCents: 176_000, overCents: 0, balanceAt: today };
  let twice = false;
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    // a read still on its way when the page reloads has no response left to change
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    json.holdings.cards = json.holdings.cards.map((c: object) => ({ ...c, ...stub }));
    if (twice) {
      json.holdings.loans = [{ id: "typed-1", name: "Kulutusluotto", lender: "Esimerkkirahoitus Oy", kind: "consumer", ownerName: null, leftCents: 500_000, monthlyPaymentCents: null, source: "typed", maybeTwice: true }];
    }
    await route.fulfill({ response, json });
  });
  const show = async (next: CardStub, note = false) => {
    stub = next;
    twice = note;
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const card = holdingsOf(page).locator(".holding-card");
    await expect(card).toBeVisible();
    return card;
  };
  const useOf = async (card: Locator) => plain(await card.locator(".holding-figures").innerText());

  // within the limit: used, limit and free in that order, and a bar 41 % full in the colour of use
  let card = await show(stub);
  expect(await useOf(card)).toBe("Käytetty luotto 1 240,00 € Luottoraja 3 000,00 € Käytettävissä 1 760,00 €");
  await expect(card.locator(".card-meter")).not.toHaveClass(/over/);
  await expect(card.getByText("Luottoraja ylitetty")).toHaveCount(0);
  expect(await filled(card)).toBeCloseTo(0.41, 2);
  const inUse = await fillColour(card);
  // the balance is fresh: no line that dates it
  await expect(card.getByText(/^Saldo päivältä/)).toHaveCount(0);

  // exactly at the limit: a full bar, nothing free, and not over
  card = await show({ limitCents: LIMIT, usedCents: LIMIT, freeCents: 0, overCents: 0, balanceAt: today });
  expect(await useOf(card)).toBe("Käytetty luotto 3 000,00 € Luottoraja 3 000,00 € Käytettävissä 0,00 €");
  await expect(card.locator(".card-meter")).not.toHaveClass(/over/);
  expect(await filled(card)).toBeCloseTo(1, 2);
  expect(await fillColour(card)).toBe(inUse);

  // over the limit: told in words, the bar full and in another colour, and nothing free is offered
  card = await show({ limitCents: LIMIT, usedCents: 320_000, freeCents: 0, overCents: 20_000, balanceAt: today });
  expect(await useOf(card)).toBe("Käytetty luotto 3 200,00 € Luottoraja 3 000,00 € Luottoraja ylitetty 200,00 €");
  await expect(card.locator(".card-meter")).toHaveClass(/over/);
  expect(await filled(card)).toBeCloseTo(1, 2);
  expect(await fillColour(card)).not.toBe(inUse);
  await expect(card.getByText(/Käytettävissä/)).toHaveCount(0);

  // no balance from the bank: the limit alone, no bar, and no figure that looks like zero
  card = await show({ limitCents: LIMIT, usedCents: null, freeCents: null, overCents: null, balanceAt: null });
  expect(await useOf(card)).toBe("Käytetty luotto Ei tiedossa Luottoraja 3 000,00 €");
  await expect(card.locator(".card-meter")).toHaveCount(0);

  // an old balance is dated under the figures, and a debt that may be counted twice carries its note
  card = await show({ limitCents: LIMIT, usedCents: 124_000, freeCents: 176_000, overCents: 0, balanceAt: week }, true);
  await expect(card.getByText(/^Saldo päivältä \d{1,2}\.\d{1,2}\.\d{4}$/)).toBeVisible();
  await expect(holdingsOf(page).locator(".holding-note")).toHaveText("Sama velka voi olla summassa kahdesti: katso Lainat.");

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a saved loan is a row with what is left and the payment a month, and its figures are Lainat's", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const saved = await context.request.post("/api/loans", {
    headers: FETCH,
    data: {
      name: "Kodin laina", lender: "Esimerkkirahoitus Oy", kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: today,
      rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100_000, endDate: null, limitCents: null, seriesKey: null,
    },
  });
  expect(saved.ok(), `POST /api/loans answered ${saved.status()}: ${await saved.text()}`).toBe(true);
  loanId = (await saved.json()).loan.id;

  const page = await signedIn(context, "/#/overview");
  const seen = watch(page);
  const holdings = holdingsOf(page);
  await expect(holdings.getByRole("heading", { level: 3 })).toHaveText(["Tilit", "Luottokortit", "Lainat"]);
  const row = holdings.locator(".holding-loan", { hasText: "Kodin laina" });
  await expect(row).toContainText("Esimerkkirahoitus Oy");
  expect(plain(await row.locator(".holding-figures").innerText())).toBe("Lainaa jäljellä 120 000,00 € Kuukausierä 1 000,00 €");
  const used = cents(plain(await holdings.locator(".holding-card .holding-figures").innerText()).replace("Käytetty luotto ", ""));
  // one line under Lainat holds the debt total, and the card is in it, so it is the debts
  expect(used, "the demo card owes something").toBeGreaterThan(0);
  await expect(holdings.locator(".holding-total .holding-name")).toHaveText("Velat yhteensä");
  const firstTotal = cents(plain(await holdings.locator(".holding-total .holding-amount").innerText()));

  // Lainat: the same loan with the same figure, and the debt total is the card and the loan
  await page.goto("/#/reports?period=year");
  const lainat = page.locator("#lainat");
  await expect(lainat.getByRole("heading", { name: "Lainat" })).toBeVisible();
  const loan = lainat.locator(".loan-list li", { hasText: "Kodin laina" });
  await expect(loan).toContainText(/Velkaa\s*120\s000,00\s€/);
  const total = plain(await lainat.locator(".kv > div", { hasText: "Velkaa yhteensä" }).locator(".v").innerText());
  expect(cents(total) / 100).toBe(Math.round((used + 12_000_000) / 100));
  // the first page gives the cents, Lainat whole euros
  expect(Math.round(firstTotal / 100)).toBe(cents(total) / 100);

  expect(seen.problems).toEqual([]);
  await context.close();
});

for (const width of [390, 360]) {
  test(`at ${width} px nothing scrolls sideways, the groups are under each other, a card is one row with its figures beside the face and the month is within two screens`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 844 } });
    const page = await signedIn(context, "/#/overview");
    const seen = watch(page);
    const holdings = holdingsOf(page);
    await expect(holdings.locator(".holding-loan", { hasText: "Kodin laina" })).toBeVisible();
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    const face = (await holdings.locator(".card-face").boundingBox())!;
    const use = (await holdings.locator(".holding-card-text").boundingBox())!;
    const groups = await holdings.locator(".holding-group").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })));
    expect(groups.length).toBe(3);
    groups.slice(1).forEach((g, i) => expect(g.top, "a group starts under the one before").toBeGreaterThanOrEqual(groups[i]!.bottom - 2));
    expect(face.x + face.width, "the face is inside the screen").toBeLessThanOrEqual(width);
    expect(use.x + use.width, "the figures are inside the screen").toBeLessThanOrEqual(width);
    // the proportions of a real card, and the figures at the right of the face on the same row
    expect(face.width / face.height).toBeGreaterThan(1.55);
    expect(face.width / face.height).toBeLessThan(1.62);
    expect(use.x, "the figures are beside the face").toBeGreaterThanOrEqual(face.x + face.width);
    expect(use.y, "on the face's row").toBeLessThan(face.y + face.height);
    // the name stands whole beside the face
    await expect(holdings.locator(".holding-card .holding-name")).toContainText("Nordea Gold (esimerkki)");
    // two accounts, a card and a loan: the month's first figure is no further than two screens down
    const top = await page.getByRole("region", { name: "Menot", exact: true }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(top, "the month starts within two screens").toBeLessThan(2 * 844);

    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
