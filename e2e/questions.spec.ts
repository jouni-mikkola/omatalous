import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, overflow, plain, removeMember, watch } from "./helpers.ts";

// Luokittelemattomat, the second block of Yhteenveto: how much of the last twelve months' money is classified, and the
// answers that would mend it most. The demo household has no payee without a category, so the payee rows are the page's own
// answer changed on its way (a stub of /api/dashboard that follows the answers the page sends: a rule, a mark), with
// every payee and sum made up; core's and the server's tests hold the figures. The loan row is real: a member made here
// has the demo household's car financing, the page asks about it, and "Ei laina" is stored.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const PERCENT = /^Luokiteltu (\d+) % viimeisen 12 kuukauden tuloista ja menoista\.$/;

interface Item {
  kind: "payee_out" | "payee_in";
  merchant: string;
  cents: number;
  count: number;
  lastDate: string;
}
interface Stub {
  items: Item[];
  total: number;
  /** The money no one classified: a payee set aside leaves the list and keeps its money here. */
  unknownCents: number;
  cardBillCents: number;
  posted: { rules: object[]; marks: object[] };
}

const MONEY = 200_000;
const item = (kind: Item["kind"], merchant: string, cents: number, count: number): Item => ({ kind, merchant, cents, count, lastDate: "2026-09-21" });
const stubOf = (over: Partial<Stub> = {}): Stub => ({
  items: [item("payee_out", "Esimerkki Kauppa Oy", 30_000, 14), item("payee_in", "Esimerkki Kaveri", 10_000, 1), item("payee_out", "Esimerkki Kioski", 10_000, 3)],
  total: 3,
  unknownCents: 50_000,
  cardBillCents: 0,
  posted: { rules: [], marks: [] },
  ...over,
});

/** The dashboard with the questions of the stub; a rule or a mark the page sends takes its payee out of the stub. */
async function follow(page: Page, stub: Stub): Promise<void> {
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    const share = 1 - (stub.unknownCents + stub.cardBillCents) / MONEY;
    json.questions = { share, outCents: MONEY / 2, inCents: MONEY / 2, outUnknownCents: stub.unknownCents, inUnknownCents: 0, cardBillCents: stub.cardBillCents, items: stub.items, total: stub.total };
    await route.fulfill({ response, json });
  });
  const leave = (merchant: string, classified: boolean) => {
    if (classified) stub.unknownCents -= stub.items.find((i) => i.merchant === merchant)?.cents ?? 0;
    stub.items = stub.items.filter((i) => i.merchant !== merchant);
    stub.total -= 1;
  };
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
    leave(String(body.subject).replace("question:payee:", ""), false);
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
  const stub = stubOf({ items: [10, 20, 30, 40, 50].map((k, i) => item("payee_out", `Esimerkki Kauppa ${i}`, k * 100, 2)), total: 7, cardBillCents: 420_000 });
  await follow(page, stub);
  await open(page);
  const block = page.getByRole("region", { name: "Luokittelemattomat", exact: true });
  await expect(block.locator(".question-row")).toHaveCount(5);
  await expect(block.getByRole("link", { name: "Näytä kaikki (7)" })).toHaveAttribute("href", "#/transactions?category=other");
  const bills = block.locator(".question-line").nth(1);
  expect(plain(await bills.innerText())).toBe("Korttilaskuissa on 4 200,00 € ostoja, joita ei ole eritelty. Tietojen laatu");
  await expect(bills.getByRole("link", { name: "Tietojen laatu" })).toHaveAttribute("href", "#/settings#laatu");
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

test("a payment that looks like a loan is a row of its own: the link to Lainat, and Ei laina takes it away and is stored", async ({ browser }) => {
  const member = await makeMember(browser, "e2e-luokittelu");
  try {
    const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
    expect((await context.request.post("/api/demo", { headers: { "X-Requested-With": "fetch" } })).status()).toBe(200);
    const page = await context.newPage();
    const seen = watch(page);
    await open(page);
    const block = page.getByRole("region", { name: "Luokittelemattomat", exact: true });
    const loan = block.locator(".question-row").filter({ hasText: "Nordea Rahoitus Suomi Oy" });
    await expect(loan).toHaveCount(1);
    expect(plain(await loan.innerText())).toMatch(/^Nordea Rahoitus Suomi Oy toistuva maksu 289,00 €\/kk Tallenna lainaksi Ei laina$/);
    await expect(loan.getByRole("link", { name: "Tallenna lainaksi: Nordea Rahoitus Suomi Oy" })).toHaveAttribute("href", "#/settings#lainat");
    const before = (await (await context.request.get("/api/dashboard")).json()).questions;
    expect(before.items.filter((i: { kind: string }) => i.kind === "loan")).toHaveLength(1);

    await loan.getByRole("button", { name: "Ei laina: Nordea Rahoitus Suomi Oy" }).click();
    await expect(loan).toHaveCount(0);
    const { marks } = await (await context.request.get("/api/recurring")).json();
    expect(marks.map((m: { subject: string; mark: string }) => [m.subject.replace(/^(loan-proposal:out:)[^:]+:/, "$1<account>:"), m.mark])).toEqual([["loan-proposal:out:<account>:Nordea Rahoitus Suomi Oy#28900", "dismissed"]]);
    const after = (await (await context.request.get("/api/dashboard")).json()).questions;
    expect(after.items.filter((i: { kind: string }) => i.kind === "loan")).toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  } finally {
    await removeMember(browser, member.id);
  }
});
