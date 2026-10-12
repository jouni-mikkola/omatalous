import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

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

async function signedIn(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

/** The holdings card of Yhteenveto: the only card with a heading Varallisuus on that page. */
const holdingsOf = (page: Page) => page.locator(".card").filter({ has: page.getByRole("heading", { name: "Varallisuus", exact: true }) });

/** The cards of the group Luottokortit, one unit each: the name as a link, then its figures as rows. */
const cardsOf = (page: Page) => holdingsOf(page).locator("section", { has: page.getByRole("heading", { name: "Luottokortit", exact: true }) }).locator(".holding-unit");

/** What the page shows for an account: the amount in its row. */
const amountOf = async (page: Page, name: string): Promise<number> => cents(await holdingsOf(page).locator(".st-row", { hasText: name }).locator(".st-num").innerText());

/** The figures of a card or a loan as one line: each label with its value, the name row left out. */
const figuresOf = async (unit: Locator): Promise<string> => plain((await unit.locator(".st-row", { has: unit.page().locator(".st-num") }).allInnerTexts()).join(" "));

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

test("the demo household: both accounts with their balance and a total at the foot, the card as rows with what is used and its face, no Lainat", async ({ browser }) => {
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
  // the last row of Tilit is the total of the two, and the groups stand side by side
  const sum = holdings.locator(".st-total");
  await expect(sum).toContainText("Tilit yhteensä");
  expect(cents(await sum.locator(".st-num").innerText())).toBe(checking + savings);
  await expect(holdings.locator("section", { has: page.getByRole("heading", { name: "Tilit", exact: true }) }).locator(".st-row").last()).toContainText("Tilit yhteensä");
  const [accountsBox, cardsBox] = await Promise.all(["Tilit", "Luottokortit"].map(async (name) => (await holdings.locator("section", { has: page.getByRole("heading", { name, exact: true }) }).boundingBox())!));
  expect(cardsBox!.x, "the groups are side by side").toBeGreaterThan(accountsBox!.x + accountsBox!.width - 2);
  expect(Math.abs(cardsBox!.y - accountsBox!.y)).toBeLessThanOrEqual(1);

  // the card: a name and rows with its face at the left, no bar; the demo gives it no limit, so what is used alone is told
  const card = cardsOf(page);
  await expect(holdings.locator(".card-face")).toHaveCount(1);
  await expect(holdings.locator("img, .card-meter")).toHaveCount(0);
  await expect(card.locator(".holding-name")).toContainText("Nordea Gold (esimerkki)");
  await expect(card.locator(".st-row")).toHaveCount(2);
  const use = await figuresOf(card);
  expect(use).toMatch(/^Käytetty luotto [\d ]+,\d\d €$/);
  const used = cents(use.replace("Käytetty luotto ", ""));

  // above the month
  const month = await page.getByRole("region", { name: "Tulot ja menot", exact: true }).boundingBox();
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
const colour = (el: Locator) => el.evaluate((node) => getComputedStyle(node).color);

test("a card with a limit shows used, limit and free as rows, and over the limit it says so in words and in colour", async ({ browser }) => {
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
    const card = cardsOf(page);
    await expect(card).toBeVisible();
    return card;
  };

  // within the limit: used, limit and free in that order, all in the colour of the other figures
  let card = await show(stub);
  expect(await figuresOf(card)).toBe("Käytetty luotto 1 240,00 € Luottoraja 3 000,00 € Käytettävissä 1 760,00 €");
  await expect(card.getByText("Luottoraja ylitetty")).toHaveCount(0);
  await expect(card.locator(".holding-bad")).toHaveCount(0);
  const plainInk = await colour(card.locator(".st-num").first());
  // the balance is fresh: no line that dates it
  await expect(card.getByText(/^Saldo päivältä/)).toHaveCount(0);

  // exactly at the limit: nothing free, and not over, so nothing in the colour of what is wrong
  card = await show({ limitCents: LIMIT, usedCents: LIMIT, freeCents: 0, overCents: 0, balanceAt: today });
  expect(await figuresOf(card)).toBe("Käytetty luotto 3 000,00 € Luottoraja 3 000,00 € Käytettävissä 0,00 €");
  await expect(card.locator(".holding-bad")).toHaveCount(0);

  // over the limit: told in words, what is used in the colour of what is wrong, and nothing free is offered
  card = await show({ limitCents: LIMIT, usedCents: 320_000, freeCents: 0, overCents: 20_000, balanceAt: today });
  expect(await figuresOf(card)).toBe("Käytetty luotto 3 200,00 € Luottoraja 3 000,00 € Luottoraja ylitetty 200,00 €");
  await expect(card.locator(".holding-bad")).toHaveCount(1);
  await expect(card.locator(".st-row", { hasText: "Käytetty luotto" }).locator(".holding-bad")).toHaveCount(1);
  expect(await colour(card.locator(".holding-bad"))).not.toBe(plainInk);
  await expect(card.getByText(/Käytettävissä/)).toHaveCount(0);

  // no balance from the bank: the limit alone, a dash for what is used, and no figure that looks like zero
  card = await show({ limitCents: LIMIT, usedCents: null, freeCents: null, overCents: null, balanceAt: null });
  expect(await figuresOf(card)).toBe("Käytetty luotto – Luottoraja 3 000,00 €");

  // an old balance is dated under the figures, and a debt that may be counted twice carries its note
  card = await show({ limitCents: LIMIT, usedCents: 124_000, freeCents: 176_000, overCents: 0, balanceAt: week }, true);
  await expect(card.getByText(/^Saldo päivältä \d{1,2}\.\d{1,2}\.\d{4}$/)).toBeVisible();
  await expect(holdingsOf(page).locator(".st-note")).toHaveText("Sama velka voi olla summassa kahdesti: katso Lainat.");

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
  const row = holdings.locator(".holding-unit", { hasText: "Kodin laina" });
  await expect(row).toContainText("Esimerkkirahoitus Oy");
  expect(await figuresOf(row)).toBe("Lainaa jäljellä 120 000,00 € Kuukausierä 1 000,00 €");
  const used = cents((await figuresOf(cardsOf(page))).replace("Käytetty luotto ", ""));
  // each group ends with its total (one card has none), and the debts of the block are a row under all three groups, the card in them
  expect(used, "the demo card owes something").toBeGreaterThan(0);
  await expect(holdings.locator(".st-total .st-name")).toHaveText(["Tilit yhteensä", "Lainat yhteensä"]);
  await expect(holdings.locator(".holding-foot .st-name")).toHaveText("Velat yhteensä");
  const firstTotal = cents(plain(await holdings.locator(".holding-foot .st-num").innerText()));

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
  test(`at ${width} px nothing scrolls sideways, the groups are under each other, and a card's rows are inside the screen`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 844 } });
    const page = await signedIn(context, "/#/overview");
    const seen = watch(page);
    const holdings = holdingsOf(page);
    await expect(holdings.locator(".holding-unit", { hasText: "Kodin laina" })).toBeVisible();
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    const use = (await cardsOf(page).boundingBox())!;
    const groups = await holdings.locator(".st-cols > section").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })));
    expect(groups.length).toBe(3);
    groups.slice(1).forEach((g, i) => expect(g.top, "a group starts under the one before").toBeGreaterThanOrEqual(groups[i]!.bottom - 2));
    expect(use.x + use.width, "the card's rows are inside the screen").toBeLessThanOrEqual(width);
    expect(use.width, "and take the width of the group").toBeGreaterThan(width - 100);
    // the name stands whole above its rows
    await expect(cardsOf(page).locator(".holding-name")).toContainText("Nordea Gold (esimerkki)");

    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

/** The first and the last day of the month `back` months before the one `today` is in. */
const monthDays = (today: string, back: number): { from: string; to: string } => {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const day = (months: number, d: number) => new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10);
  return { from: day(back, 1), to: day(back - 1, 0) };
};
const monthOf = (page: Page) => page.getByRole("region", { name: "Tulot ja menot", exact: true });
const dashboardAsks = (page: Page): string[] => {
  const asked: string[] = [];
  page.on("request", (r) => /\/api\/dashboard(\?|$)/.test(r.url()) && asked.push(r.url()));
  return asked;
};

for (const width of [1280, 390]) {
  test(`at ${width} px the page is a statement of blocks in one order, each the width of the page: Varallisuus, Erääntyvät maksut, Asuminen, Tulot ja menot, Ilmoitukset`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await signedIn(context, "/#/overview");
    const seen = watch(page);
    await expect(monthOf(page)).toBeVisible();
    const region = (name: string) => page.getByRole("region", { name, exact: true });
    const blocks = [holdingsOf(page), region("Erääntyvät maksut"), region("Asuminen"), monthOf(page)];
    const boxes = await Promise.all(blocks.map(async (block) => (await block.first().boundingBox())!));
    boxes.slice(1).forEach((box, i) => {
      expect(box.y, "a block starts under the one before, never beside it").toBeGreaterThanOrEqual(boxes[i]!.y + boxes[i]!.height);
      expect([box.x, box.width], "every block is the width of the page").toEqual([boxes[0]!.x, boxes[0]!.width]);
    });
    // Ilmoitukset is the last block when the household has something to be told
    const notices = page.getByRole("heading", { name: "Ilmoitukset", exact: true });
    if ((await notices.count()) > 0) expect((await notices.boundingBox())!.y).toBeGreaterThanOrEqual(boxes[3]!.y + boxes[3]!.height);
    // the first thing in the page's column is the card Varallisuus: no line, strip or notice stands above it
    const first = page.locator("main .stack").first().locator("> *").first();
    await expect(first).toContainText("Varallisuus");
    // no line of when the data was fetched or how many accounts it holds, on the page or in the header
    await expect(page.locator(".data-scope")).toHaveCount(0);
    await expect(page.getByText(/Mukana \d+ tili|haettu viimeksi|^Haettu \d/)).toHaveCount(0);
    if (width >= 1040) {
      // one grid of three columns: the right group of Erääntyvät maksut and of Tulot ja menot start on its first line, the sums of Asuminen on its second
      const wide = async (block: Locator) => (await block.locator(".st-cols-3 > .st-wide").boundingBox())!;
      const [due, home, month] = [await wide(blocks[1]!), await wide(blocks[2]!), await wide(blocks[3]!)];
      const line = (n: number) => boxes[0]!.x + (boxes[0]!.width * n) / 3;
      expect(due.x).toBe(month.x);
      expect(Math.abs(due.x - line(1))).toBeLessThanOrEqual(2);
      expect(Math.abs(home.x + home.width - line(2))).toBeLessThanOrEqual(2);
      // the groups of Varallisuus stand on the same lines: the second starts on the first, a third one on the second
      const starts = await blocks[0]!.locator(".st-cols > section").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
      expect(starts.length).toBeGreaterThan(1);
      starts.slice(1).forEach((x, i) => expect(Math.abs(x - line(i + 1)), "a group of Varallisuus starts on a third").toBeLessThanOrEqual(2));
    }
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("Tulot ja menot is two tables and no sentence: the two months' figures side by side, two rows under a rule, the chart, and beside them the table of themes with its sums, its bars, its open and closed rows and a link to the rows of a category", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await signedIn(context, "/#/overview");
  const seen = watch(page);
  const block = monthOf(page);
  await expect(block.getByRole("heading", { level: 2 })).toHaveText(["Tulot ja menot"]);
  // the months' table: the month and the month before counted to the same day as its heads, Tulot and Menot as its rows
  const months = block.locator(".month-table");
  const heads = (await months.locator("thead th").allInnerTexts()).map(plain);
  expect(heads).toHaveLength(2);
  expect(heads[0]).toMatch(/^[A-ZÄÖ][a-zäö]+kuu$/);
  expect(heads[1]).toMatch(/^[A-ZÄÖ][a-zäö]+kuu \d{1,2}\.\d{1,2}\. mennessä$/);
  const rows = months.locator("tbody tr");
  expect(await rows.locator("th").allInnerTexts()).toEqual(["Tulot", "Menot"]);
  for (const figure of await rows.locator("td").allInnerTexts()) expect(plain(figure)).toMatch(/^[\d ]+,\d\d €$/);
  await expect(rows.locator("td")).toHaveCount(4);
  await expect(rows.getByRole("link", { name: "Tulot", exact: true })).toHaveAttribute("href", /^#\/reports#/);
  await expect(rows.getByRole("link", { name: "Menot", exact: true })).toHaveAttribute("href", /^#\/transactions\?from=/);
  // no sentence: no line under a figure, no comparison in words, no strip of how the income was used
  await expect(block.locator(".st-sub, .st-note, .bridge")).toHaveCount(0);
  for (const gone of [/kuussa \d/, "Tulojen käyttö", "tavallisesta", "Ei vertailua"]) await expect(block.getByText(gone)).toHaveCount(0);
  // under the rule two rows of a label and one figure; the labels open the month before and Laskut
  const more = block.locator(".month-more .st-row");
  await expect(more).toHaveCount(2);
  await expect(more.nth(0).getByRole("link", { name: /^Säästöaste, [a-zäö]+kuu$/ })).toHaveAttribute("href", "#/overview?period=last-month");
  expect(plain(await more.nth(0).locator(".st-num").innerText())).toMatch(/^-?\d+ %$/);
  await expect(more.nth(1).getByRole("link", { name: "Kiinteät menot kuukaudessa", exact: true })).toHaveAttribute("href", "#/bills");
  // the chart stays under the table, the categories are beside both
  const box = async (l: Locator) => (await l.boundingBox())!;
  const [table, chart, categoriesHead] = [await box(months), await box(block.getByRole("heading", { name: "Menojen kertymä" })), await box(block.getByRole("heading", { name: "Menot kategorioittain" }))];
  expect(chart.y).toBeGreaterThan(table.y + table.height);
  expect(categoriesHead.x, "the categories are beside the figures").toBeGreaterThan(table.x + table.width);

  // the table of themes stands where the list of the month was: core's themes over the last complete months, whichever month is chosen
  const answer = ((await (await context.request.get("/api/dashboard")).json()).themes ?? null) as Themes | null;
  expect(answer, "the demo household has three complete months, so core has its themes").not.toBeNull();
  const { window: span, themes } = answer!;
  const categories = block.getByRole("table", { name: "Menot kategorioittain", exact: true });
  expect(plain(await block.locator(".themes-head").innerText())).toBe(`Menot kategorioittain ${monthYear(span.first)}–${monthYear(span.last)}`);
  const hasChange = themes.some((t) => t.changePct !== null || t.lines.some((l) => l.changePct !== null));
  expect((await categories.locator("thead th").allInnerTexts()).map(plain)).toEqual(["Kuukaudessa", ...(span.months === 12 ? ["Vuodessa"] : []), ...(hasChange ? ["Muutos"] : [])]);
  // the seven largest themes as the answer has them and the rest in one row; every sum is the answer's
  const named = themes.slice(0, 7);
  const rest = themes.slice(7);
  const themeRows = categories.locator("tbody tr.themes-row");
  expect((await themeRows.locator("th").allInnerTexts()).map(plain)).toEqual([...named.map((t) => t.heading), ...(rest.length ? [`Muut (${rest.length})`] : [])]);
  const column = async (name: string) => (await categories.locator(`tbody tr.themes-row td.${name}`).allInnerTexts()).map(cents);
  const total = categories.locator("tbody tr.themes-total");
  expect(await total.locator("th").innerText()).toBe("Yhteensä");
  expect(cents(await total.locator("td.themes-month").innerText()), "Yhteensä a month is the answer's").toBe(answer!.totalMonthlyCents);
  expect((await column("themes-month")).reduce((a, b) => a + b, 0), "the column adds up to Yhteensä as printed").toBe(answer!.totalMonthlyCents);
  if (span.months === 12) {
    expect(cents(await total.locator("td.themes-year").innerText())).toBe(answer!.totalYearCents);
    expect((await column("themes-year")).reduce((a, b) => a + b, 0)).toBe(answer!.totalYearCents);
  }
  // the bar is one colour on theme rows only, as long as the theme against the largest
  const bars = await categories.locator(".category-bar span").evaluateAll((els) => els.map((el) => ({ colour: getComputedStyle(el).backgroundColor, width: el.getBoundingClientRect().width, row: el.closest("tr")!.className })));
  expect(new Set(bars.map((b) => b.colour)).size, "one bar colour").toBe(1);
  expect(bars.every((b) => b.row === "themes-row")).toBe(true);
  expect(bars).toHaveLength(named.filter((t) => t.monthlyCents > 0).length);
  expect(bars[1]!.width / bars[0]!.width, "the second bar against the first").toBeCloseTo(named[1]!.monthlyCents / named[0]!.monthlyCents, 1);
  await expect(categories.locator(".legend-swatch, .swatch, .dot")).toHaveCount(0);
  await expect(page.getByText("±")).toHaveCount(0);
  await expect(block.getByRole("link", { name: "Kauppiaat", exact: true })).toBeVisible();
  await expect(block.getByRole("link", { name: "Menot kuukausittain", exact: true })).toBeVisible();
  // no sentence under the table: nothing but the large purchases, and only when there are some
  await expect(block.locator(".themes-large")).toHaveCount(answer!.large.rows.length > 0 ? 1 : 0);

  // Ruoka is open when the page opens and the others are closed; the button closes it and opens it again
  const food = categories.getByRole("button", { name: "Ruoka", exact: true });
  const lines = categories.locator("tbody tr.themes-line");
  const foodLines = themes.find((t) => t.id === "food")!.lines;
  await expect(categories.locator("button[aria-expanded=true]")).toHaveCount(1);
  await expect(food).toHaveAttribute("aria-expanded", "true");
  await expect(lines.locator("th")).toHaveText(foodLines.map((l) => l.heading));
  await food.click();
  await expect(food).toHaveAttribute("aria-expanded", "false");
  await expect(lines).toHaveCount(0);
  await food.click();
  await expect(lines).toHaveCount(foodLines.length);
  // the lines of a category are links to its rows over the window's days; each theme opens by itself
  const days = `from=${span.first}-01&to=${monthLastDay(span.last)}`;
  for (const line of foodLines) await expect(categories.getByRole("link", { name: line.heading, exact: true })).toHaveAttribute("href", `#/transactions?category=${line.id}&${days}`);
  const car = themes.find((t) => t.id === "car");
  if (car && named.includes(car)) {
    await categories.getByRole("button", { name: "Auto", exact: true }).click();
    await expect(lines).toHaveCount(foodLines.length + car.lines.length);
    // the lines of Auto say what a row was for: none of them is a category, so none is a link
    for (const line of car.lines) await expect(lines.filter({ hasText: line.heading }).getByRole("link")).toHaveCount(0);
    await categories.getByRole("button", { name: "Auto", exact: true }).click();
    await expect(lines).toHaveCount(foodLines.length);
  }
  // Muut (n) opens to its themes, which are no links
  if (rest.length) {
    await categories.getByRole("button", { name: `Muut (${rest.length})`, exact: true }).click();
    await expect(lines).toHaveCount(foodLines.length + rest.length);
    await expect(categories.getByRole("link", { name: rest[0]!.heading, exact: true })).toHaveCount(0);
  }

  // a category's name opens its rows of the window in Tapahtumat
  await categories.getByRole("link", { name: foodLines[0]!.heading, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/transactions\\?category=${foodLines[0]!.id}&${days}`));
  expect(seen.problems).toEqual([]);
  await context.close();
});

/** What the specs below read of the answer's themes. */
interface Themes {
  window: { first: string; last: string; months: number };
  themes: { id: string; heading: string; monthlyCents: number; yearCents: number | null; changePct: number | null; lines: { id: string; heading: string; monthlyCents: number; yearCents: number | null; changePct: number | null }[] }[];
  totalMonthlyCents: number;
  totalYearCents: number | null;
  large: { cents: number; count: number; rows: { id: string; date: string; payee: string; cents: number }[] };
}
/** "2025-10" as the heading of the table writes it: "10/2025". */
const monthYear = (month: string) => `${Number(month.slice(5))}/${month.slice(0, 4)}`;
/** The last day of "2026-09". */
const monthLastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);

/** The first page with the themes of its answer changed on their way, as no household of the demo has them; null is no themes. */
async function withThemes(browser: Browser, width: number, change: (themes: Themes) => Themes | null): Promise<{ context: BrowserContext; page: Page; seen: { problems: string[] }; answer: Themes }> {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  let answer = null as Themes | null;
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return route.continue();
    answer = json.themes;
    if (json.themes) json.themes = change(json.themes);
    await route.fulfill({ response, json });
  });
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(monthOf(page)).toBeVisible();
  return { context, page, seen, answer: answer! };
}

/**
 * A change to the demo's themes that gives the table every column and row it can have, and one label too long for a phone:
 * the first theme has +4 %, Ruoka -7 % with +9 % on its first line and the long label on its second.
 */
const LONG = "Ravintolat, kahvilat, pikaruoka ja muut ulkona syömiseen menevät kulut";
const pctOf = (id: string, i: number) => (id === "food" ? -7 : i === 0 ? 4 : null);
const rich = (t: Themes): Themes => ({
  ...t,
  themes: t.themes.map((x, i) => ({
    ...x,
    changePct: pctOf(x.id, i),
    lines: x.lines.map((l, j) => ({ ...l, heading: x.id === "food" && j === 1 ? LONG : l.heading, changePct: x.id === "food" && j === 0 ? 9 : null })),
  })),
  large: {
    cents: 189_900,
    count: 2,
    rows: [
      { id: "a", date: "2026-03-14", payee: "ESIMERKKI OY", cents: 149_900 },
      { id: "b", date: "2026-01-05", payee: "Esimerkkikone Oy", cents: 65_000 },
      { id: "c", date: "2025-11-20", payee: "Esimerkkikone Oy", cents: -25_000 },
    ],
  },
});

test("Menot kategorioittain: Muutos, Muut and Suuret hankinnat draw what the answer holds, a row without a change has an empty cell, and money back alone has no number", async ({ browser }) => {
  const { context, page, seen, answer } = await withThemes(browser, 1280, rich);
  const block = monthOf(page);
  const categories = block.getByRole("table", { name: "Menot kategorioittain", exact: true });
  expect((await categories.locator("thead th").allInnerTexts()).map(plain)).toEqual(["Kuukaudessa", ...(answer.window.months === 12 ? ["Vuodessa"] : []), "Muutos"]);
  const change = categories.locator("tbody tr.themes-row td.themes-change");
  const rest = answer.themes.slice(7);
  expect((await change.allInnerTexts()).map(plain), "a row without a change has an empty cell, and so has the rest row").toEqual([...answer.themes.slice(0, 7).map((t, i) => { const pct = pctOf(t.id, i); return pct === null ? "" : `${pct > 0 ? "+" : "-"}${Math.abs(pct)} %`; }), ...(rest.length ? [""] : [])]);
  expect(await categories.locator("tbody tr.themes-total td.themes-change").innerText(), "nor does the total").toBe("");
  await expect(categories.locator("tbody tr.themes-line td.themes-change").first()).toHaveText("+9 %");
  await expect(categories.locator("tbody tr.themes-line td.themes-change").nth(1)).toHaveText("");
  // Muut (n) opens to the themes it holds
  expect(rest.length, "the demo has more than seven themes").toBeGreaterThan(0);
  await categories.getByRole("button", { name: `Muut (${rest.length})`, exact: true }).click();
  await expect(categories.locator("tbody tr.themes-line th")).toHaveText([...answer.themes.find((t) => t.id === "food")!.lines.map((l, j) => (j === 1 ? LONG : l.heading)), ...rest.map((t) => t.heading)]);
  // Suuret hankinnat: a row of its own under the table, the window's sum at its right, closed until opened
  const large = block.getByRole("button", { name: "Suuret hankinnat (2)", exact: true });
  await expect(large).toHaveAttribute("aria-expanded", "false");
  const row = block.locator(".themes-large > .st-row");
  expect(cents(await row.locator(".st-num").innerText())).toBe(189_900);
  const [tableBox, rowBox] = [(await categories.boundingBox())!, (await row.boundingBox())!];
  expect(tableBox.y + tableBox.height, "the row is under the table").toBeLessThanOrEqual(rowBox.y);
  await expect(block.locator(".themes-large-rows")).toHaveCount(0);
  await large.click();
  expect((await block.locator(".themes-large-rows li").allInnerTexts()).map(plain)).toEqual(["14.3.2026 ESIMERKKI OY 1 499,00 €", "5.1.2026 Esimerkkikone Oy 650,00 €", "20.11.2025 Esimerkkikone Oy -250,00 €"]);
  await large.click();
  await expect(block.locator(".themes-large-rows")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();

  // money back alone: the same row, with no number in brackets and the sum below zero
  const back = await withThemes(browser, 1280, (t) => ({ ...t, large: { cents: -25_000, count: 0, rows: [{ id: "c", date: "2025-11-20", payee: "Esimerkkikone Oy", cents: -25_000 }] } }));
  await expect(monthOf(back.page).getByRole("button", { name: "Suuret hankinnat", exact: true })).toBeVisible();
  expect(cents(await monthOf(back.page).locator(".themes-large > .st-row .st-num").innerText())).toBe(-25_000);
  await expect(monthOf(back.page).getByText(/Suuret hankinnat \(/)).toHaveCount(0);
  // and none at all when the answer has no row
  const none = await withThemes(browser, 1280, (t) => ({ ...t, large: { cents: 0, count: 0, rows: [] } }));
  await expect(monthOf(none.page).locator(".themes-large")).toHaveCount(0);
  for (const other of [back, none]) {
    expect(other.seen.problems).toEqual([]);
    await other.context.close();
  }
});

test("Menot kategorioittain: a window of seven months has no Vuodessa", async ({ browser }) => {
  const { context, page, seen } = await withThemes(browser, 1280, (t) => ({
    ...t,
    window: { first: "2026-03", last: "2026-09", months: 7 },
    themes: t.themes.map((x) => ({ ...x, yearCents: null, lines: x.lines.map((l) => ({ ...l, yearCents: null })) })),
    totalYearCents: null,
  }));
  const block = monthOf(page);
  const categories = block.getByRole("table", { name: "Menot kategorioittain", exact: true });
  expect(plain(await block.locator(".themes-head").innerText())).toBe("Menot kategorioittain 3/2026–9/2026");
  expect((await categories.locator("thead th").allInnerTexts()).map(plain)).toEqual(["Kuukaudessa"]);
  await expect(block.getByText("Vuodessa")).toHaveCount(0);
  await expect(categories.locator("td.themes-year")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Menot kategorioittain draws the month's list when core has no themes", async ({ browser }) => {
  const { context, page, seen } = await withThemes(browser, 1280, () => null);
  const block = monthOf(page);
  const month = plain(await block.locator(".month-table thead th").first().innerText());
  await expect(block.locator(".themes-table, .themes-head, .themes-large")).toHaveCount(0);
  const categories = block.getByRole("table", { name: "Menot kategorioittain", exact: true });
  expect((await categories.locator("thead th").allInnerTexts()).map(plain)).toEqual(["Kategoria", month, "Muutos"]);
  const bars = await categories.locator(".category-bar span").evaluateAll((els) => els.map((el) => ({ colour: getComputedStyle(el).backgroundColor, width: el.getBoundingClientRect().width })));
  expect(new Set(bars.map((b) => b.colour)).size, "one bar colour").toBe(1);
  expect(bars[0]!.width, "the first row is the largest, and its bar the longest of the named").toBeGreaterThanOrEqual(Math.max(...bars.slice(0, 9).map((b) => b.width)));
  await expect(categories.locator(".legend-swatch, .swatch, .dot")).toHaveCount(0);
  // a change is whole euros with its sign, and a change of nothing prints nothing
  for (const change of await categories.locator("tbody td:last-child").allInnerTexts()) expect(plain(change)).toMatch(/^([+-][\d ]+ €)?$/);
  await expect(page.getByText("±")).toHaveCount(0);
  await expect(block.getByRole("link", { name: "Kauppiaat", exact: true })).toBeVisible();
  await expect(block.getByRole("link", { name: "Menot kuukausittain", exact: true })).toBeVisible();
  // a category's name opens its rows of the month in Tapahtumat
  const name = categories.locator("tbody tr").first().getByRole("link");
  await expect(name).toHaveAttribute("href", /^#\/transactions\?category=[\w-]+&from=\d{4}-\d\d-01&to=\d{4}-\d\d-\d\d$/);
  await name.click();
  await expect(page).toHaveURL(/#\/transactions\?category=[\w-]+&from=/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

for (const width of [1000, 700, 390]) {
  test(`Menot kategorioittain at ${width} px does not scroll sideways with every column and row open; a label that does not fit is cut and has its text in title`, async ({ browser }) => {
    const { context, page, seen, answer } = await withThemes(browser, width, rich);
    const block = monthOf(page);
    const categories = block.getByRole("table", { name: "Menot kategorioittain", exact: true });
    await categories.getByRole("button", { name: /^Muut \(/ }).click();
    await block.getByRole("button", { name: "Suuret hankinnat (2)", exact: true }).click();
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    const cut = categories.locator("th.st-cut", { hasText: LONG });
    await expect(cut).toHaveAttribute("title", LONG);
    // a phone has the label and two sums: no bar and no change
    const phone = width < 600;
    const shown = await categories.locator("thead th").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent!.trim()));
    expect(shown, "the columns").toEqual(phone ? ["Kuukaudessa", "Vuodessa"] : ["Kuukaudessa", ...(answer.window.months === 12 ? ["Vuodessa"] : []), "Muutos"]);
    expect(await categories.locator("td.category-bar").first().isVisible(), "the bar").toBe(!phone);
    // no figure is cut by its column
    const cutFigures = await categories.locator("td.st-num").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 1).length);
    expect(cutFigures, "a figure that does not fit its column").toBe(0);
    if (phone) expect(await cut.evaluate((el) => el.scrollWidth > el.clientWidth), "the long label is cut").toBe(true);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("Asuminen is on the page when the answer has no Erääntyvät maksut, and Erääntyvät maksut when it has", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  let without = true;
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    if (without) json.ahead = null;
    await route.fulfill({ response, json });
  });
  const show = async () => {
    await page.goto("/#/overview");
    await page.reload();
    await expect(monthOf(page)).toBeVisible();
  };
  // no window to the next pay: the home's block is drawn by its own answer and the other block is not drawn
  await show();
  await expect(page.getByRole("region", { name: "Asuminen", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erääntyvät maksut", exact: true })).toHaveCount(0);
  // the near miss: with the window, both are on the page
  without = false;
  await show();
  await expect(page.getByRole("region", { name: "Asuminen", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erääntyvät maksut", exact: true })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the month switch is in the block it changes and nowhere else, and the running month asks once", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const asked = dashboardAsks(page);
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(monthOf(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(asked, "one request for the running month").toHaveLength(1);
  // one switch in the whole page, inside the card; the shell draws none above the page
  await expect(page.getByRole("group", { name: "Kuukausi" })).toHaveCount(1);
  await expect(monthOf(page).getByRole("group", { name: "Kuukausi" })).toHaveCount(1);
  await expect(page.getByRole("toolbar", { name: "Aikaväli" })).toHaveCount(0);
  await expect(monthOf(page).getByRole("group", { name: "Kuukausi" }).getByRole("button")).toHaveCount(2);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("with the month before chosen Varallisuus and Erääntyvät maksut still tell today and the block tells that month; the address #/overview?period=last-month opens it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const before = monthDays(today, 1);
  const page = await context.newPage();
  const seen = watch(page);
  const asked = dashboardAsks(page);
  await page.goto("/#/overview?period=last-month");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(monthOf(page).getByRole("link", { name: "Menot", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // the bookmark opens the month before, with its button pressed
  const switchOf = monthOf(page).getByRole("group", { name: "Kuukausi" });
  await expect(switchOf.locator("button[aria-pressed=true]")).toHaveText(await switchOf.getByRole("button").nth(1).innerText());
  // two requests: the running month for what is above the block, the month before for the block
  expect(asked.some((u) => u.includes(`from=${today.slice(0, 7)}-01&to=${today}`)), "the running month is asked for").toBe(true);
  expect(asked.some((u) => u.includes(`from=${before.from}&to=${before.to}`)), "the month before is asked for").toBe(true);
  expect(asked).toHaveLength(2);
  // the bars are that month's: the link of Menot and the merchants name its days
  await expect(monthOf(page).getByRole("link", { name: "Menot", exact: true })).toHaveAttribute("href", `#/transactions?from=${before.from}&to=${before.to}`);
  await expect(monthOf(page).getByRole("link", { name: "Kauppiaat" })).toHaveAttribute("href", new RegExp(`from=${before.from}&to=${before.to}`));
  // today's blocks are there, and the running month's chart is not
  await expect(holdingsOf(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Erääntyvät maksut", exact: true })).toBeVisible();
  await expect(monthOf(page).getByRole("heading", { name: "Menojen kertymä" })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("switching the month keeps the page: Varallisuus and the switch stay while the month's answer is on its way", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const before = monthDays(today, 1);
  const page = await context.newPage();
  const seen = watch(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // the answer for the month before is held back until the page has been looked at
  await page.route(/\/api\/dashboard\?/, async (route) => {
    if (route.request().url().includes(`from=${before.from}`)) await held;
    await route.continue().catch(() => {});
  });
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(monthOf(page).getByRole("heading", { name: "Menojen kertymä" })).toBeVisible();
  await monthOf(page).getByRole("group", { name: "Kuukausi" }).getByRole("button").nth(1).click();
  await expect(page).toHaveURL(/period=last-month/);
  // waiting: the head with the switch, and what is above the block, are on the page
  await expect(monthOf(page).getByRole("group", { name: "Kuukausi" })).toBeVisible();
  await expect(holdingsOf(page)).toBeVisible();
  await expect(monthOf(page).getByText("Ladataan…")).toBeVisible();
  release();
  await expect(monthOf(page).getByRole("link", { name: "Menot", exact: true })).toHaveAttribute("href", `#/transactions?from=${before.from}&to=${before.to}`);
  await expect(monthOf(page).getByText("Ladataan…")).toHaveCount(0);
  // and back: the running month's chart is there again
  await monthOf(page).getByRole("group", { name: "Kuukausi" }).getByRole("button").first().click();
  await expect(monthOf(page).getByRole("heading", { name: "Menojen kertymä" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

for (const period of ["month", "last-month"]) {
  test(`at 390 px with the ${period === "month" ? "running month" : "month before"} chosen nothing scrolls sideways and the switch is two equal buttons under the heading`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 } });
    const page = await signedIn(context, `/#/overview?period=${period}`);
    const seen = watch(page);
    await expect(monthOf(page).getByRole("link", { name: "Menot", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), "the page scrolls sideways at 390 px").toBeLessThanOrEqual(1);
    const switchOf = monthOf(page).getByRole("group", { name: "Kuukausi" });
    const heading = (await monthOf(page).getByRole("heading", { level: 2 }).boundingBox())!;
    const group = (await switchOf.boundingBox())!;
    const a = (await switchOf.getByRole("button").first().boundingBox())!;
    const b = (await switchOf.getByRole("button").nth(1).boundingBox())!;
    expect(group.y, "the switch is under the heading").toBeGreaterThan(heading.y + heading.height - 2);
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    expect(group.width, "the buttons take the width of the card").toBeGreaterThan(300);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
