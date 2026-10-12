import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Raportit > Lainat of a household that saved two loans: a mortgage with its plan and a card it knows only the
// balance of. The loans belong to a member of their own, with the demo accounts less the demo card (a connected card
// that owes is a debt of its own and would stand beside the two), so the demo household of the administrator that the
// other specs read stays as it is. The member is removed at the end, and one a broken run left behind is removed first.
// Run alone, the spec creates the administrator itself. With E2E_SHOTS set the section is saved there as a picture
// at each width.
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const MEMBER = join(DIR, "loans-report-state.json");
const BASE = process.env.E2E_BASE_URL ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "";

const USERNAME = "e2e-lainat";
const FETCH = { "X-Requested-With": "fetch" };

/** The server's own day (/api/meta), read once the member is signed in: the loans are told on it. */
let today = "";
/** The member made here, removed in the end. */
let memberId = "";

const NOT_GIVEN = { lender: null, grantedCents: null, rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null };

/** 120 000 € at 4 % paid 1 000 € a month, and a card with 1 240 € on it and nothing else told. */
const loans = () => [
  { ...NOT_GIVEN, name: "Kodin laina", lender: "Esimerkkipankki", kind: "mortgage", grantedCents: 15000000, balanceCents: 12000000, balanceDate: today, rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100000 },
  { ...NOT_GIVEN, name: "Kaupan kortti", kind: "card", balanceCents: 124000, balanceDate: today },
];

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, unknown>> {
  const r = await context.request.post(`${BASE}${path}`, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}: ${await r.text()}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

/** A member with the rows and the loans above, signed in. */
async function household(browser: Browser): Promise<void> {
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
  for (const u of users.filter((x) => x.username === USERNAME)) await admin.request.delete(`${BASE}/api/users/${u.id}`, { headers: FETCH });
  const { user, temporaryPassword } = (await post(admin, "/api/users", { username: USERNAME, displayName: "E2E Lainat", role: "member" })) as { user: { id: string }; temporaryPassword: string };
  memberId = user.id;
  await admin.close();
  const member = await browser.newContext();
  await post(member, "/api/auth/login", { username: USERNAME, password: temporaryPassword });
  await post(member, "/api/auth/password", { current: temporaryPassword, next: "e2e-lainat-123456" });
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
  for (const loan of loans()) await post(member, "/api/loans", loan);
  await member.storageState({ path: MEMBER });
  await member.close();
}

/** The member and its loans go, so the instance is as the spec found it. */
async function remove(browser: Browser): Promise<void> {
  if (!memberId) return;
  const admin = await browser.newContext({ storageState: STATE });
  const gone = await admin.request.delete(`${BASE}/api/users/${memberId}`, { headers: FETCH });
  expect(gone.ok(), `DELETE /api/users answered ${gone.status()}`).toBe(true);
  await admin.close();
}

/** Sums as a reader sees them: plain spaces and a plain minus. */
const plain = (s: string) => s.replace(/\s+/g, " ").replace(/−/g, "-").trim();
const texts = async (page: Page, selector: string) => (await page.locator(selector).allInnerTexts()).map(plain);
/** "1 058,40 €" → 105840 */
const cents = (s: string) => Math.round(Number(s.replace(/[ €]/g, "").replace(",", ".")) * 100);

async function open(browser: Browser, width: number): Promise<{ page: Page; seen: { problems: string[] }; context: BrowserContext }> {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width, height: 844 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports");
  await expect(page.locator("#lainat").getByRole("heading", { name: "Lainat" })).toBeVisible();
  return { page, seen, context };
}

async function shot(page: Page, width: number): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.locator("#lainat").screenshot({ path: join(SHOTS, `ln6-lainat-${width}.png`) });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => household(browser));
test.afterAll(async ({ browser }) => remove(browser));

test("Lainat tells each saved loan with its figures, says what it does not know and what a move of the reference rate does", async ({ browser }) => {
  const { page, seen, context } = await open(browser, 1280);
  const section = page.locator("#lainat");

  // the totals: both loans are owed, and the sums that leave the card out say so
  const tiles = await texts(page, "#lainat .kv > div");
  expect(tiles[0]).toBe("Velkaa yhteensä 121 240 €");
  expect(tiles[1]).toMatch(/^Korot 12 kuukaudessa \d[\d ]* €$/);
  expect(tiles[2]).toBe("Maksuerät kuussa 1 000 €");
  expect(await texts(page, "#lainat .loans-notes li")).toEqual(["Koroista puuttuu yksi laina, jonka korkoa ei tiedetä.", "Maksueristä puuttuu yksi laina, jonka maksuerää ei tiedetä."]);
  // the accounts less the debts are told only for a range that reaches today (apps/web/test/loans-section.test.ts
  // reads their texts), and nothing on the page calls a figure net worth
  await expect(page.locator("main")).not.toContainText("Nettovarallisuus");

  // the mortgage: every figure, and the payment split into interest and amortisation
  const rows = section.locator(".loan-list > li");
  await expect(rows).toHaveCount(2);
  const home = rows.nth(0);
  await expect(home.locator(".loan-head")).toHaveText(/Kodin laina\s*Asuntolaina · Esimerkkipankki/);
  const figures = (await home.locator(".loan-figures > div").allInnerTexts()).map(plain);
  expect(figures.slice(0, 3)).toEqual(["Velkaa 120 000,00 €", "Korko 4,00 % 12 kuukauden Euribor", "Maksuerä 1 000,00 €/kk korkoa 400,00 €, lyhennystä 600,00 €"]);
  expect(figures[3]).toBe(tiles[1]);
  expect(figures[4]).toMatch(/^Viimeinen eräpäivä \d{1,2}\.\d{1,2}\.\d{4}$/);

  // a point down the payment is smaller and a point up larger, and so is the year's interest
  const line = plain(await home.locator(".loan-scenario").innerText());
  const moved = /^Jos viitekorko laskee prosenttiyksikön: maksuerä ([\d ,]+ €), korot 12 kuukaudessa ([\d ]+ €)\. Jos viitekorko nousee prosenttiyksikön: maksuerä ([\d ,]+ €), korot 12 kuukaudessa ([\d ]+ €)\.$/.exec(line);
  expect(moved, line).not.toBeNull();
  const [downPay, downInterest, upPay, upInterest] = moved!.slice(1).map(cents);
  expect(downPay!).toBeLessThan(100000);
  expect(upPay!).toBeGreaterThan(100000);
  const interest = cents(tiles[1]!.replace("Korot 12 kuukaudessa ", ""));
  expect(downInterest!).toBeLessThan(interest);
  expect(upInterest!).toBeGreaterThan(interest);

  // the card: the balance is known, and the rest is said to be unknown instead of printed as zero
  const card = rows.nth(1);
  expect((await card.locator(".loan-figures > div").allInnerTexts()).map(plain)).toEqual([
    `Velkaa 1 240,00 € jäljellä ${Number(today.slice(8))}.${Number(today.slice(5, 7))}.${today.slice(0, 4)}`,
    "Korko ei tiedossa",
    "Maksuerä ei tiedossa",
    "Korot 12 kuukaudessa ei tiedossa",
    "Viimeinen eräpäivä ei tiedossa",
  ]);
  await expect(card.locator(".loan-scenario")).toHaveCount(0);

  expect(await overflow(page)).toBe(0);
  await shot(page, 1280);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Lainat fits a phone: the figures wrap and the page does not scroll sideways", async ({ browser }) => {
  const { page, seen, context } = await open(browser, 390);
  await expect(page.locator("#lainat .loan-list > li")).toHaveCount(2);
  await page.locator("#lainat").scrollIntoViewIfNeeded();
  expect(await overflow(page)).toBe(0);
  // no figure is cut: each one is as wide as its text
  const cut = await page.locator("#lainat .loan-figures dd").evaluateAll((cells) => cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length);
  expect(cut).toBe(0);
  await shot(page, 390);
  expect(seen.problems).toEqual([]);
  await context.close();
});
