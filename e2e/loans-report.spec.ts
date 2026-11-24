import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";
import { auditTables } from "./table-audit.ts";

// Raportit > Lainat of a household that saved two loans: a mortgage with its plan and a card it knows only the
// balance of. The loans belong to a member of their own, with the demo accounts less the demo card (a connected card
// that owes is a debt of its own and would stand beside the two), so the demo household of the administrator that the
// other specs read stays as it is. The member is removed at the end, and one a broken run left behind is removed first.
// A second member of its own saves two dear debts and answers the payment the demo rows show as no loan, so every debt
// has its terms and the payoff plan line is there; the first member keeps the debt nobody saved.
// Run alone, the spec creates the administrator itself. With E2E_SHOTS set the section is saved there as a picture
// at each width.
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const MEMBER = join(DIR, "loans-report-state.json");
const PLANNER = join(DIR, "loans-plan-state.json");
const BASE = process.env.E2E_BASE_URL ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "";

const USERNAME = "e2e-lainat";
const PLAN_USERNAME = "e2e-lainat-suunnitelma";
const FETCH = { "X-Requested-With": "fetch" };

/** The server's own day (/api/meta), read once the member is signed in: the loans are told on it. */
let today = "";
/** The members made here, removed in the end. */
const memberIds: string[] = [];

const NOT_GIVEN = { lender: null, grantedCents: null, rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null };

/** 120 000 € at 4 % paid 1 000 € a month, and a card with 1 240 € on it and nothing else told. */
const loans = () => [
  { ...NOT_GIVEN, name: "Kodin laina", lender: "Esimerkkipankki", kind: "mortgage", grantedCents: 15000000, balanceCents: 12000000, balanceDate: today, rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100000 },
  { ...NOT_GIVEN, name: "Kaupan kortti", kind: "card", balanceCents: 124000, balanceDate: today },
];

/** A card at 24 % and a consumer loan at 18 %, both with a payment: very dear debts, so the plan and the offer for them are told. */
const dearLoans = () => [
  { ...NOT_GIVEN, name: "Kulutusluotto", lender: "Esimerkkirahoitus", kind: "consumer", balanceCents: 300000, balanceDate: today, rateBp: 1800, repayment: "annuity", intervalMonths: 1, paymentCents: 15000 },
  { ...NOT_GIVEN, name: "Kaupan kortti", kind: "card", balanceCents: 100000, balanceDate: today, rateBp: 2400, intervalMonths: 1, paymentCents: 5000 },
];

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, unknown>> {
  const r = await context.request.post(`${BASE}${path}`, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}: ${await r.text()}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

/** A member with the rows and the loans given, signed in; `answered` says that the payments the rows show as loans are no loans. */
async function household(browser: Browser, who: { username: string; state: string; loans: () => object[]; answered: boolean }): Promise<void> {
  if (!existsSync(STATE)) {
    const setup = await browser.newContext();
    await post(setup, "/api/auth/setup", { code: process.env.E2E_SETUP_CODE ?? "", username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" });
    await post(setup, "/api/admin/instance/complete", {});
    await post(setup, "/api/demo", {});
    await setup.storageState({ path: STATE });
    await setup.close();
  }
  const admin = await browser.newContext({ storageState: STATE });
  const { users } = (await (await admin.request.get(`${BASE}/api/users`, { headers: FETCH })).json()) as { users: { id: string; username: string }[] };
  for (const u of users.filter((x) => x.username === who.username)) await admin.request.delete(`${BASE}/api/users/${u.id}`, { headers: FETCH });
  const { user, temporaryPassword } = (await post(admin, "/api/users", { username: who.username, displayName: "E2E Lainat", role: "member" })) as { user: { id: string }; temporaryPassword: string };
  memberIds.push(user.id);
  await admin.close();
  const member = await browser.newContext();
  await post(member, "/api/auth/login", { username: who.username, password: temporaryPassword });
  await post(member, "/api/auth/first-password", { next: "e2e-lainat-123456" });
  today = ((await (await member.request.get(`${BASE}/api/meta`, { headers: FETCH })).json()) as { today: string }).today;
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await post(member, "/api/demo", {});
  const meta = (await (await member.request.get(`${BASE}/api/meta`, { headers: FETCH })).json()) as { accounts: { id: string; type: string; provider: string }[] };
  const cards = meta.accounts.filter((a) => a.provider === "demo" && a.type === "credit_card");
  expect(cards, "the demo household has its card").toHaveLength(1);
  for (const card of cards) {
    const gone = await member.request.delete(`${BASE}/api/accounts/${card.id}`, { headers: FETCH });
    expect(gone.ok(), `DELETE /api/accounts answered ${gone.status()}`).toBe(true);
  }
  if (who.answered) {
    const { proposals } = (await (await member.request.get(`${BASE}/api/loans/proposals`, { headers: FETCH })).json()) as { proposals: { key: string }[] };
    for (const p of proposals) {
      const marked = await member.request.put(`${BASE}/api/marks`, { headers: FETCH, data: { subject: `loan-proposal:${p.key}`, mark: "dismissed" } });
      expect(marked.ok(), `PUT /api/marks answered ${marked.status()}`).toBe(true);
    }
  }
  for (const loan of who.loans()) await post(member, "/api/loans", loan);
  await member.storageState({ path: who.state });
  await member.close();
}

/** The members and their loans go, so the instance is as the spec found it. */
async function remove(browser: Browser): Promise<void> {
  if (memberIds.length === 0) return;
  const admin = await browser.newContext({ storageState: STATE });
  for (const id of memberIds) {
    const gone = await admin.request.delete(`${BASE}/api/users/${id}`, { headers: FETCH });
    expect(gone.ok(), `DELETE /api/users answered ${gone.status()}`).toBe(true);
  }
  await admin.close();
}

/** Sums as a reader sees them: plain spaces and a plain minus. */
const plain = (s: string) => s.replace(/\s+/g, " ").replace(/−/g, "-").trim();
const texts = async (page: Page, selector: string) => (await page.locator(selector).allInnerTexts()).map(plain);
/** "1 058,40 €" → 105840 */
const cents = (s: string) => Math.round(Number(s.replace(/[ €]/g, "").replace(",", ".")) * 100);
/** The rows of the debts, not the drills opened under them. */
const ROWS = "table.rt tbody tr:not(.rt-detail):not(.rt-subrow):not(.rt-group):not(.rt-spacer)";

async function open(browser: Browser, width: number, state = MEMBER): Promise<{ page: Page; seen: { problems: string[] }; context: BrowserContext }> {
  // a phone's width is a phone: a touch screen, where a target is a finger's size (`table.css` pointer: coarse)
  const context = await browser.newContext({ storageState: state, viewport: { width, height: 844 }, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=saldot");
  await expect(page.locator("#lainat").getByRole("heading", { name: "Lainat" })).toBeVisible();
  return { page, seen, context };
}

async function shot(page: Page, width: number): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.locator("#lainat").screenshot({ path: join(SHOTS, `ln6-lainat-${width}.png`) });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await household(browser, { username: USERNAME, state: MEMBER, loans, answered: false });
  await household(browser, { username: PLAN_USERNAME, state: PLANNER, loans: dearLoans, answered: true });
});
test.afterAll(async ({ browser }) => remove(browser));

test("Lainat lists each debt in one table, says what it does not know and what a move of the reference rate does", async ({ browser }) => {
  const { page, seen, context } = await open(browser, 1440);
  const section = page.locator("#lainat");

  // the totals: the payments of a month, the mortgage's and the unsaved loan's, and the card that tells none; the debts and their cost are the foot of the table
  const tiles = await texts(page, "#lainat .kv > div");
  expect(tiles[0]).toBe("Maksut kuussa 1 289 € + 1 ei tiedossa");
  // and no path of the debts is drawn while a debt that owes cannot be projected, and no plan is told while a debt lacks its terms
  await expect(section.locator("#lainat-polku")).toHaveCount(0);
  await expect(section.locator(".loan-plan")).toHaveCount(0);
  await expect(section.locator(".loans-notes")).toHaveCount(0);
  // the one place that says it is the payments tile above
  await expect(section.getByText(/ei tiedossa/)).toHaveCount(1);
  // the accounts less the debts are told only for a range that reaches today (apps/web/test/loans-section.test.ts
  // reads their texts), and nothing on the page calls a figure net worth
  await expect(page.locator("main")).not.toContainText("Nettovarallisuus");

  // the head of the table, then the debts dearest first: the mortgage, the card with no rate, and the loan nobody saved last
  expect(await texts(page, "#lainat table.rt thead th")).toEqual(expect.arrayContaining(["Velka", "Saldo", "Todellinen korko", "Korot ja kulut 12 kk"]));
  const rows = section.locator(ROWS);
  await expect(rows).toHaveCount(3);
  // the chevron that opens a row's drill is the first character of its line
  const rowLine = async (i: number) => plain(await rows.nth(i).innerText()).replace(/^› /, "");
  expect(await rowLine(0)).toMatch(/^Kodin laina Asuntolaina · Esimerkkipankki 120 000 € \d,\d\d % [\d ]+ €$/);
  // the card owes and has no rate: a dash in each figure it lacks, never a zero
  expect(await rowLine(1)).toMatch(/^Kaupan kortti.*1 240 € – –$/);
  const unsaved = await rowLine(2);
  expect(unsaved).toContain("saldo puuttuu");
  expect(unsaved).toMatch(/[\d ,]+ €\/kk/);

  // the foot: the debts told, and the cost of a year a dash with the one link to the list of what is missing
  const foot = section.locator("table.rt tfoot tr");
  expect(plain(await foot.innerText())).toBe("Velat yhteensä, tiedossa 121 240 € – Täydennä lainat");
  await expect(foot.getByRole("link", { name: "Täydennä lainat" })).toHaveAttribute("href", /item=loan-terms/);

  // the mortgage's drill: the payment split into its interest and amortisation, and what a point of the reference rate does
  const cost = cents(plain(await rows.nth(0).locator("td").last().innerText()));
  await section.getByRole("button", { name: "Kodin laina", exact: true }).click();
  const detail = section.locator("tr.rt-detail").first();
  const figures = (await detail.locator(".loan-figures > div").allInnerTexts()).map(plain);
  expect(figures).toContain("Maksu 1 000,00 €/kk Korko 400,00 € Lyhennys 600,00 €");
  const line = plain(await detail.locator(".loan-scenario").innerText());
  const moved = /^Jos viitekorko laskee prosenttiyksikön: maksu ([\d ,]+ €), korot 12 kuukaudessa ([\d ]+ €)\. Jos viitekorko nousee prosenttiyksikön: maksu ([\d ,]+ €), korot 12 kuukaudessa ([\d ]+ €)\.$/.exec(line);
  expect(moved, line).not.toBeNull();
  const [downPay, downInterest, upPay, upInterest] = moved!.slice(1).map(cents);
  expect(downPay!).toBeLessThan(100000);
  expect(upPay!).toBeGreaterThan(100000);
  expect(downInterest!).toBeLessThan(cost);
  expect(upInterest!).toBeGreaterThan(cost);

  // the card's drill: the balance as told, the rate it lacks said in words, and no link
  await section.getByRole("button", { name: "Kaupan kortti", exact: true }).click();
  // one drill is open at a time: the card's closed the mortgage's
  await expect(section.locator("tr.rt-detail")).toHaveCount(1);
  const cardDetail = plain(await section.locator("tr.rt-detail").innerText());
  expect(cardDetail).toContain(`Velkaa 1 240,00 € jäljellä ${Number(today.slice(8))}.${Number(today.slice(5, 7))}.`); // a day of the running year has no year (format.ts `date`)
  expect(cardDetail).toContain("Korko puuttuu");
  await expect(section.locator("tr.rt-detail").getByRole("link")).toHaveCount(0);
  await expect(section.locator("tr.rt-detail .loan-scenario")).toHaveCount(0);

  expect(await overflow(page)).toBe(0);
  await shot(page, 1440);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// A household whose debts all have their terms: a drill opens, the plan line above the list tells the month the debts end
// in, and the offer of one loan for the dear debts names a field it cannot read and prices the offer once it is whole.
// At a phone's width the finger's size holds for the plan line and each field.
for (const { width, touch } of [{ width: 1440, touch: false }, { width: 390, touch: true }]) {
  test(`Lainat opens a drill, tells the payoff plan and prices a new loan for the dear debts: ${width} px`, async ({ browser }) => {
    const { page, seen, context } = await open(browser, width, PLANNER);
    const section = page.locator("#lainat");
    await expect(section.locator(ROWS)).toHaveCount(2);
    // the card at 24 % is dearer than the loan at 18 %, so it comes first
    await expect(section.locator(".loan-name")).toHaveText([/^Kaupan kortti/, /^Kulutusluotto/]);

    // a drill of a saved loan opens with what is left of it
    await section.getByRole("button", { name: "Kulutusluotto", exact: true }).click();
    await expect(section.locator("tr.rt-detail")).toHaveCount(1);
    await expect(section.locator("tr.rt-detail")).toContainText("Jäljellä");

    // the plan line: the month the debts end in, then the order they are paid in
    const line = section.locator(".loan-plan > summary");
    await expect(line).toHaveText(/^Velaton \d{1,2}\/\d{4}/);
    if (touch) expect((await line.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await line.click();
    const plan = section.locator(".loan-plan");
    await expect(plan.locator(".loan-plan-list li")).toHaveCount(2);

    // the offer: nothing is told until a rate and a term are typed, and a value that cannot be an offer names its field
    const result = plan.locator(".loan-wi-result");
    const rate = plan.getByLabel("Uuden lainan korko, %");
    const months = plan.getByLabel("Laina-aika, kuukautta");
    const fee = plan.getByLabel("Kulu kuukausierässä");
    await expect(result).toHaveText("");
    await expect(plan.locator(".field-error")).toHaveCount(0);
    await rate.fill("60");
    await months.fill("60");
    await fee.fill("5");
    await expect(plan.locator(".field-error")).toHaveText(/^Anna korko prosentteina, enintään 50\s%\.$/);
    await expect(rate).toHaveAttribute("aria-invalid", "true");
    await expect(result).toHaveText("");
    await rate.fill("6");
    await expect(plan.locator(".field-error")).toHaveCount(0);
    await expect(result).toHaveText(/^Uusi laina maksaisi korkoina ja kuluina [\d\s]+\s€ · (?:[\d\s]+\s€ (?:vähemmän|enemmän)|saman verran)$/);
    if (touch) {
      for (const field of [rate, months, fee]) expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await overflow(page)).toBe(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

test("the loan figures are plain text, with no button to open a calculation", async ({ browser }) => {
  const { page, seen, context } = await open(browser, 1280);
  await expect(page.locator("#lainat").getByRole("button", { name: /^Näytä laskelma/ })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// The charts of Tulot (cash flow, saving rate, income level) went with the extra report sections (6fbd30df7, T60).
test("Raportit has none of the paragraphs the figures replaced, and its balances stand under Varat ja velat", async ({ browser }) => {
  const { page, seen, context } = await open(browser, 1280);
  await page.goto("/#/reports?q=tulot");
  // the sentences that said what the fixed costs take of the income and what the cash covers, and the line under Tulolajit
  await expect(page.locator("#tulot").getByRole("heading", { name: "Tulolajit", exact: true })).toBeVisible();
  await expect(page.getByText(/vievät \d+ % tuloista|Se kattaa|Puskurin pituus|Lisää tilien saldot|Kuukaudessa keskimäärin/)).toHaveCount(0);
  // Varat ja velat: the balances by month under their question, the daily balance as one line chart and no legend
  await page.goto("/#/reports?q=saldot");
  await expect(page.locator("#saldot").getByRole("heading", { name: "Saldojen kehitys" })).toBeVisible();
  await expect(page.locator("#saldot [role='img']")).toHaveCount(1);
  await expect(page.locator("#saldot .legend")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Lainat fits a phone: each debt is a block, its drill opens and the page does not scroll sideways", async ({ browser }) => {
  const { page, seen, context } = await open(browser, 390);
  const rows = page.locator(`#lainat ${ROWS}`);
  await expect(rows).toHaveCount(3);
  // the debt with a cost comes first and the one with none follows, as at a desktop's width; the loan nobody saved is last
  await expect(page.locator("#lainat .loan-name")).toHaveText([/^Kodin laina/, /^Kaupan kortti/, /./]);
  await expect(rows.nth(2)).toContainText("saldo puuttuu");
  await page.locator("#lainat").scrollIntoViewIfNeeded();
  expect(await overflow(page)).toBe(0);
  // a drill reaches the finger's size, and its rate said in words stays on the screen
  const button = page.locator('#lainat button.rt-drill[aria-label="Kaupan kortti"]');
  await button.click();
  await expect(page.locator("#lainat tr.rt-detail")).toContainText("Korko puuttuu");
  const box = (await button.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(await overflow(page)).toBe(0);
  // no figure is cut: each one is as wide as its text
  const cut = await page.locator("#lainat .loan-figures dd").evaluateAll((cells) => cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length);
  expect(cut).toBe(0);
  await shot(page, 390);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// The table of the debts with its drills open, as every table is audited in table-views.spec.ts, here on the household
// that has saved loans: no sideways scroll, nothing hidden, axe finds nothing and, under a finger, 44 px targets.
for (const { width, touch } of [{ width: 1440, touch: false }, { width: 390, touch: true }]) {
  test(`the table of the debts passes the table audit: ${width} px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: MEMBER, viewport: { width, height: 900 }, bypassCSP: true, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await page.goto("/#/reports?q=saldot");
    await expect(page.locator("#lainat").getByRole("heading", { name: "Lainat" })).toBeVisible();
    expect(await auditTables(page, width, touch)).toEqual([]);
    await context.close();
  });
}
