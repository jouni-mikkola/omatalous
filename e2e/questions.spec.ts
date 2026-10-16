import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, plain, watch } from "./helpers.ts";

// Luokittelemattomat, the second block of Yhteenveto: how much of the last twelve months' money is classified, and the
// answers that would mend it most. The demo household has no payee without a category, so the payee rows are the page's own
// answer changed on its way (a stub of /api/dashboard that follows the answers the page sends: a rule, a mark), with
// every payee and sum made up; core's and the server's tests hold the figures. The loan question is stubbed the same way:
// the demo household's financing is placed by its payee, so the page has nothing real to ask.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const PERCENT = /^Luokiteltu (\d+) % viimeisen 12 kuukauden tuloista ja menoista\.$/;

interface Item {
  kind: "payee_out" | "payee_in" | "payer" | "loan";
  merchant: string;
  cents: number;
  count: number;
  lastDate: string;
  /** A payer's question: what its answer is stored under, the answers offered, and the one proposed. */
  key?: string;
  options?: string[];
  proposal?: string | null;
  steady?: boolean;
  offMedianCents?: number[];
  /** A loan question: the payee and the month, with the key the answer is stored under. */
  payee?: string;
  paymentCents?: number;
}
interface Stub {
  items: Item[];
  total: number;
  /** The money no one classified: a payee set aside leaves the list and keeps its money here. */
  unknownCents: number;
  cardBillCents: number;
  cardBillIssuers: string[];
  posted: { rules: object[]; marks: object[]; payers: object[] };
}

const MONEY = 200_000;
const item = (kind: Item["kind"], merchant: string, cents: number, count: number): Item => ({ kind, merchant, cents, count, lastDate: "2026-09-21" });
const stubOf = (over: Partial<Stub> = {}): Stub => ({
  items: [item("payee_out", "Esimerkki Kauppa Oy", 30_000, 14), item("payee_in", "Esimerkki Kaveri", 10_000, 1), item("payee_out", "Esimerkki Kioski", 10_000, 3)],
  total: 3,
  unknownCents: 50_000,
  cardBillCents: 0,
  cardBillIssuers: [],
  posted: { rules: [], marks: [], payers: [] },
  ...over,
});

/** The dashboard with the questions of the stub; a rule or a mark the page sends takes its payee out of the stub. */
async function follow(page: Page, stub: Stub): Promise<void> {
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    const share = 1 - (stub.unknownCents + stub.cardBillCents) / MONEY;
    json.questions = { share, outCents: MONEY / 2, inCents: MONEY / 2, outUnknownCents: stub.unknownCents, inUnknownCents: 0, cardBillCents: stub.cardBillCents, cardBillIssuers: stub.cardBillIssuers, items: stub.items, total: stub.total };
    await route.fulfill({ response, json });
  });
  const leave = (merchant: string, classified: boolean) => {
    if (classified) stub.unknownCents -= stub.items.find((i) => i.merchant === merchant)?.cents ?? 0;
    stub.items = stub.items.filter((i) => i.merchant !== merchant && i.key !== merchant);
    stub.total -= 1;
  };
  await page.route(/\/api\/payer-roles$/, async (route) => {
    stub.posted.payers.push(route.request().postDataJSON());
    leave(route.request().postDataJSON().key, false);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(/\/api\/rules$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    stub.posted.rules.push(body);
    leave(body.pattern, true);
    await route.fulfill({ json: {} });
  });
  await page.route(/\/api\/marks$/, async (route) => {
    const body = route.request().postDataJSON();
    stub.posted.marks.push(body);
    leave(String(body.subject).replace(/^(question:payee:|loan-proposal:|question:loan-kind:[a-z]+:)/, ""), false);
    await route.fulfill({ json: { marks: [] } });
  });
}

async function open(page: Page): Promise<void> {
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
}

const percentOf = async (page: Page) => Number(PERCENT.exec(plain(await page.getByRole("region", { name: "Luokittelemattomat", exact: true }).locator(".question-line").first().innerText()))?.[1]);

test("the block is the second of the front page; a category takes the row away and raises the percent, Ohita takes a row away and leaves it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const stub = stubOf();
  await follow(page, stub);
  await open(page);

  const block = page.getByRole("region", { name: "Luokittelemattomat", exact: true });
  await expect(block).toBeVisible();
  const grid = page.locator("main .page-grid").first().locator("> *");
  await expect(grid.nth(0)).toContainText("Varallisuus");
  await expect(grid.nth(1)).toContainText("Luokittelemattomat");
  await expect(block.getByRole("heading", { level: 2 })).toHaveText("Luokittelemattomat");
  // 75 % of the 2 000 € are classified; no second line without card bills
  await expect(block.locator(".question-line")).toHaveCount(1);
  expect(await percentOf(page)).toBe(75);

  // the rows: the payee as a link to its rows, `tulo` after a payee of money in, the sum, the count, the picker and Ohita
  const rows = block.locator(".question-row");
  await expect(rows).toHaveCount(3);
  const kauppa = rows.filter({ hasText: "Esimerkki Kauppa Oy" });
  await expect(kauppa.getByRole("link", { name: "Esimerkki Kauppa Oy" })).toHaveAttribute("href", "#/transactions?merchant=Esimerkki+Kauppa+Oy");
  expect(plain(await kauppa.innerText())).toMatch(/^Esimerkki Kauppa Oy 300,00 € 14 tapahtumaa/);
  const kaveri = rows.filter({ hasText: "Esimerkki Kaveri" });
  expect(plain(await kaveri.innerText())).toMatch(/^Esimerkki Kaveri tulo 100,00 € 1 tapahtuma(?!a)/);
  await expect(block.getByRole("link", { name: /^Näytä kaikki/ })).toHaveCount(0);

  // money in is offered the income categories only; money out any but Muut menot
  const options = (label: string) => block.getByLabel(label).locator("option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  const inOptions = await options("Kategoria: Esimerkki Kaveri");
  expect(inOptions).toContain("salary");
  expect(inOptions).not.toContain("groceries");
  const outOptions = await options("Kategoria: Esimerkki Kauppa Oy");
  expect(outOptions).toContain("groceries");
  expect(outOptions).not.toContain("other");
  await expect(block.getByLabel("Kategoria: Esimerkki Kauppa Oy").locator("option").first()).toHaveText("Valitse kategoria");

  // a category: saved at once as a rule for the payee, the row goes and the percent rises
  await block.getByLabel("Kategoria: Esimerkki Kauppa Oy").selectOption("groceries");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Esimerkki Kauppa Oy" })).toHaveCount(0);
  expect(stub.posted.rules).toEqual([{ field: "merchant_exact", pattern: "Esimerkki Kauppa Oy", category: "groceries" }]);
  expect(await percentOf(page)).toBe(90);

  // Ohita: the row goes, the mark is the payee's, and the percent stays
  await block.getByRole("button", { name: "Ohita: Esimerkki Kioski" }).click();
  await expect(rows).toHaveCount(1);
  expect(stub.posted.marks).toEqual([{ subject: "question:payee:Esimerkki Kioski", mark: "dismissed" }]);
  expect(await percentOf(page)).toBe(90);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("more than five are cut to five with a link to all of them, and card bills are told with a link to Tietojen laatu", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const stub = stubOf({ items: [10, 20, 30, 40, 50].map((k, i) => item("payee_out", `Esimerkki Kauppa ${i}`, k * 100, 2)), total: 7, cardBillCents: 420_000, cardBillIssuers: ["Morrow Bank", "SEB Kort"] });
  await follow(page, stub);
  await open(page);
  const block = page.getByRole("region", { name: "Luokittelemattomat", exact: true });
  await expect(block.locator(".question-row")).toHaveCount(5);
  await expect(block.getByRole("link", { name: "Näytä kaikki (7)" })).toHaveAttribute("href", "#/transactions?category=other");
  const bills = block.locator(".question-line").nth(1);
  expect(plain(await bills.innerText())).toBe("Korttilaskuissa on 4 200,00 € ostoja, joita ei ole eritelty. Suurimmat: Morrow Bank, SEB Kort.");
  // one issuer is named alone
  stub.cardBillIssuers = ["Morrow Bank"];
  await page.reload();
  expect(plain(await block.locator(".question-line").nth(1).innerText())).toBe("Korttilaskuissa on 4 200,00 € ostoja, joita ei ole eritelty. Suurimmat: Morrow Bank.");
  await expect(block.locator(".question-line").nth(2).getByRole("link", { name: "Tietojen laatu" })).toHaveAttribute("href", "#/settings#laatu");
  await context.close();
});

test("on a phone the answers wrap under the payee and nothing scrolls sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await follow(page, stubOf({ items: [item("payee_out", "Esimerkki Erittäin Pitkä Kauppiaan Nimi Osakeyhtiö", 30_000, 14)], total: 1 }));
  await open(page);
  const row = page.getByRole("region", { name: "Luokittelemattomat", exact: true }).locator(".question-row");
  await expect(row).toHaveCount(1);
  const name = (await row.locator(".st-name").boundingBox())!;
  const picker = (await row.getByRole("combobox").boundingBox())!;
  const ohita = (await row.getByRole("button", { name: /^Ohita/ }).boundingBox())!;
  expect(picker.y, "the picker is under the payee").toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(ohita.y, "Ohita stands with the picker").toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await context.close();
});

const LOAN_KEY = "out:acc-1:Esimerkki Rahoitus Oy#28900";
const loanItem = (): Item => ({ ...item("loan", "Esimerkki Rahoitus Oy", 346_800, 12), key: LOAN_KEY, payee: "Esimerkki Rahoitus Oy", paymentCents: 28_900 });

test("an instalment series the app cannot place asks Mikä laina tämä on? with the payee and the month, and the answer is stored once", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const stub = stubOf({ items: [loanItem()], total: 1, unknownCents: 0 });
  await follow(page, stub);
  await open(page);
  const loan = page.getByRole("region", { name: "Luokittelemattomat", exact: true }).locator(".question-row").filter({ hasText: "Esimerkki Rahoitus Oy" });
  await expect(loan).toHaveCount(1);
  expect(plain(await loan.locator(".st-name").innerText())).toBe("Mikä laina tämä on? Esimerkki Rahoitus Oy · 289,00 €/kk");
  const picker = loan.getByRole("combobox", { name: "Mikä laina tämä on: Esimerkki Rahoitus Oy" });
  expect(await picker.locator("option").allInnerTexts()).toEqual(["Valitse", "Asuntolaina", "Autolaina", "Opintolaina", "Kulutusluotto", "Muu laina"]);
  await picker.selectOption({ label: "Asuntolaina" });
  await expect(loan).toHaveCount(0);
  expect(stub.posted.marks).toEqual([{ subject: `question:loan-kind:mortgage:${LOAN_KEY}`, mark: "in_use" }]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Ei laina on the question of a loan takes it away and is stored", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const stub = stubOf({ items: [loanItem()], total: 1, unknownCents: 0 });
  await follow(page, stub);
  await open(page);
  const loan = page.getByRole("region", { name: "Luokittelemattomat", exact: true }).locator(".question-row").filter({ hasText: "Esimerkki Rahoitus Oy" });
  await loan.getByRole("button", { name: "Ei laina: Esimerkki Rahoitus Oy" }).click();
  await expect(loan).toHaveCount(0);
  expect(stub.posted.marks).toEqual([{ subject: `loan-proposal:${LOAN_KEY}`, mark: "dismissed" }]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a payer is asked what its money is: five answers with the proposal marked, each the member's own, Ohita sets it aside", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const payer = (merchant: string, cents: number, over: Partial<Item> = {}): Item => ({
    ...item("payer", merchant, cents, 3),
    key: `name:${merchant.toUpperCase()}`,
    options: ["cost_share", "sales", "own_money", "gift", "pay"],
    steady: true,
    proposal: null,
    offMedianCents: [],
    ...over,
  });
  const stub = stubOf({
    items: [
      payer("Esimerkki Ville", 90_000, { proposal: "cost_share" }),
      payer("Esimerkki Liisa", 60_000),
      payer("Esimerkki Firma Oy", 50_000, { options: ["cost_share", "sales", "gift", "pay"] }),
    ],
    total: 3,
  });
  await follow(page, stub);
  await open(page);

  const block = page.getByRole("region", { name: "Luokittelemattomat", exact: true });
  const rows = block.locator(".question-row");
  await expect(rows).toHaveCount(3);
  const ville = rows.filter({ hasText: "Esimerkki Ville" });
  expect(plain(await ville.innerText())).toMatch(/^Esimerkki Ville 900,00 € 3 tapahtumaa/);
  await expect(block.getByText("Vastaus koskee myös aiempia kuukausia. Tavallisesta selvästi poikkeavia maksuja se ei muuta.")).toHaveCount(1);
  await expect(block.getByLabel("Sama kaikille tällaisille")).toHaveCount(0);

  // the five answers in the page's order, the proposed one marked; a company is not offered Omaa rahaa
  const options = (label: string) => block.getByLabel(label).locator("option").evaluateAll((els) => els.map((el) => el.textContent));
  expect(await options("Mitä nämä ovat: Esimerkki Ville")).toEqual(["Mitä nämä ovat?", "Yhteisten menojen osuus (ehdotus)", "Myynti", "Omaa rahaa", "Lahja", "Palkka tai etuus"]);
  expect(await options("Mitä nämä ovat: Esimerkki Firma Oy")).not.toContain("Omaa rahaa");

  // an answer is stored at once for the member, and the row goes
  await block.getByLabel("Mitä nämä ovat: Esimerkki Ville").selectOption("sales");
  await expect(rows).toHaveCount(2);
  await block.getByLabel("Mitä nämä ovat: Esimerkki Firma Oy").selectOption("pay");
  await expect(rows).toHaveCount(1);
  await block.getByLabel("Mitä nämä ovat: Esimerkki Liisa").selectOption("own_money");
  await expect(rows).toHaveCount(0);
  expect(stub.posted.payers).toEqual([
    { key: "name:ESIMERKKI VILLE", role: "sales" },
    { key: "name:ESIMERKKI FIRMA OY", role: "pay" },
    { key: "name:ESIMERKKI LIISA", role: "own_money" },
  ]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a payer set aside with Ohita is a mark under the payer's key, and nothing is stored as an answer", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const stub = stubOf({
    items: [{ ...item("payer", "Esimerkki Anna", 40_000, 3), key: "iban:FI2112345600000785", options: ["cost_share", "sales", "own_money", "gift", "pay"], steady: true, proposal: null, offMedianCents: [] }],
    total: 1,
  });
  await follow(page, stub);
  await open(page);
  const block = page.getByRole("region", { name: "Luokittelemattomat", exact: true });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await block.getByRole("button", { name: "Ohita: Esimerkki Anna" }).click();
  await expect(block.locator(".question-row")).toHaveCount(0);
  expect(stub.posted.marks).toEqual([{ subject: "question:payee:iban:FI2112345600000785", mark: "dismissed" }]);
  expect(stub.posted.payers).toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the answers a member gave are listed with the rules: change one, restore the proposal, the row goes", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const options = ["cost_share", "sales", "own_money", "gift", "pay"];
  // the list follows the answers the page sends, with every payer and sum made up; the server's tests hold the real list
  const answers = [
    { key: "name:ESIMERKKI VILLE", name: "Esimerkki Ville", role: "sales", options, count: 12 },
    { key: "name:ESIMERKKI FIRMA OY", name: "Esimerkki Firma Oy", role: "pay", options: options.filter((o) => o !== "own_money"), count: 3 },
  ];
  const posted: object[] = [];
  await page.route(/\/api\/payer-roles$/, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { answers } });
    const body = route.request().postDataJSON() as { key: string; role: string | null };
    posted.push(body);
    const at = answers.findIndex((a) => a.key === body.key);
    if (body.role === null) answers.splice(at, 1);
    else answers[at]!.role = body.role;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#/transactions?view=merchants#saannot");
  const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Maksajat", exact: true }) });
  await expect(card.locator(".question-row")).toHaveCount(2);
  const ville = card.locator(".question-row").filter({ hasText: "Esimerkki Ville" });
  await expect(ville.getByLabel("Mitä nämä ovat: Esimerkki Ville")).toHaveValue("sales");
  expect(plain(await ville.innerText())).toMatch(/^Esimerkki Ville 12 tapahtumaa .* Palauta ehdotus$/);
  const choices = (label: string) => card.getByLabel(label).locator("option").evaluateAll((els) => els.map((el) => el.textContent));
  expect(await choices("Mitä nämä ovat: Esimerkki Ville")).toEqual(["Yhteisten menojen osuus", "Myynti", "Omaa rahaa", "Lahja", "Palkka tai etuus"]);
  expect(await choices("Mitä nämä ovat: Esimerkki Firma Oy")).not.toContain("Omaa rahaa");

  await card.getByLabel("Mitä nämä ovat: Esimerkki Ville").selectOption("gift");
  await expect(card.getByLabel("Mitä nämä ovat: Esimerkki Ville")).toHaveValue("gift");
  await card.getByRole("button", { name: "Palauta ehdotus: Esimerkki Firma Oy" }).click();
  await expect(card.locator(".question-row")).toHaveCount(1);
  expect(posted).toEqual([
    { key: "name:ESIMERKKI VILLE", role: "gift" },
    { key: "name:ESIMERKKI FIRMA OY", role: null },
  ]);
  // the last one restored, the card is gone and the rules stay
  await card.getByRole("button", { name: "Palauta ehdotus: Esimerkki Ville" }).click();
  await expect(page.getByRole("heading", { name: "Maksajat", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Säännöt" })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

