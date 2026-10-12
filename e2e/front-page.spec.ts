import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
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

test("the demo household: both accounts with their balance and a total at the foot, the card as rows with what is used, no drawn card, no Lainat", async ({ browser }) => {
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

  // the card: a name and rows, nothing drawn; the demo gives it no limit, so what is used alone is told
  const card = cardsOf(page);
  await expect(holdings.locator("svg, img, .card-face, .card-meter")).toHaveCount(0);
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
    await expect(page.locator(".data-scope, .sync-status")).toHaveCount(0);
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

test("Tulot ja menot is two tables and no sentence: the two months' figures side by side, two rows under a rule, the chart, and the categories with one bar colour, a link to their rows and no change of nothing", async ({ browser }) => {
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

  const categories = block.getByRole("table", { name: "Menot kategorioittain", exact: true });
  expect((await categories.locator("thead th").allInnerTexts()).map(plain)).toEqual(["Kategoria", heads[0], "Muutos"]);
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
