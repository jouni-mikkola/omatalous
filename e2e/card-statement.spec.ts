import { type Browser, expect, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// Tapahtumat: a card bill row opens its view, lines pasted from the card statement are read, saved and told on the
// bill row, and "Poista erittely" brings the bill back whole. The data is the administrator's demo household, imported
// under a fresh member with one card bill added.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const BILL_CENTS = 12345;

test.describe.configure({ mode: "serial" });

let member: { state: string; id: string };
let file: string;
let billDay: string;
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, "e2e-erittely");
  const admin = await browser.newContext({ storageState: STATE });
  const res = await admin.request.post("/api/data/export", { headers: FETCH });
  expect(res.ok()).toBe(true);
  const raw = await res.text();
  const parsed = JSON.parse(raw) as { accounts: Record<string, unknown>[]; transactions: Record<string, unknown>[] };
  const adminName = String(parsed.transactions[0]!.owner_username);
  const checking = new Set(parsed.accounts.filter((a) => a.type === "checking").map((a) => a.id));
  const own = parsed.transactions.filter((t) => checking.has(t.account_id) && t.status === "booked");
  billDay = own.map((t) => String(t.booking_date)).sort().at(-1)!;
  parsed.transactions.push({
    ...own[0]!,
    id: "e2e-card-bill",
    booking_date: billDay,
    value_date: null,
    amount_cents: -BILL_CENTS,
    status: "booked",
    merchant: "ESIMERKKI KORTTILASKU",
    counterparty: "ESIMERKKI KORTTILASKU",
    counterparty_iban: null,
    description: null,
    reference: null,
    category: "card_bill",
    category_source: "rule",
    is_transfer: 0,
    signature: "e2e-card-bill-signature",
  });
  // no card account is connected here: with one, the bill is a transfer to it and no card bill
  const cards = new Set(parsed.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  parsed.accounts = parsed.accounts.filter((a) => !cards.has(a.id));
  parsed.transactions = parsed.transactions.filter((t) => !cards.has(t.account_id));
  file = JSON.stringify(parsed).split(`"${adminName}"`).join(`"e2e-erittely"`);
  await admin.close();
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

const dayOf = (back: number) => {
  const d = new Date(`${billDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};
const fi = (iso: string) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.`;

async function importFile(browser: Browser) {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/settings");
  const card = page.locator(".card", { has: page.getByRole("heading", { level: 2, name: "Tiedot", exact: true }) });
  await card.locator("input[type=file]").setInputFiles({ name: "omatalous.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await card.getByRole("button", { name: "Tuo", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Tiedot tuotu");
  return { context, page };
}

const food = async (context: Awaited<ReturnType<typeof importFile>>["context"]) => JSON.stringify((await (await context.request.get("/api/dashboard")).json()) as unknown);

test("pasted statement lines are read, saved, told on the bill row, and undone", async ({ browser }) => {
  const { context, page } = await importFile(browser);
  const seen = watch(page);
  const before = await food(context);
  await page.goto("/#/transactions?merchant=ESIMERKKI%20KORTTILASKU");
  await page.reload();
  const row = page.locator("tr", { hasText: "ESIMERKKI KORTTILASKU" });
  await expect(row.getByText("Korttilasku: ostot eivät näy")).toBeVisible();
  await row.getByRole("button", { name: "Erittele ostot" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Erittele ostot" })).toBeVisible();
  const lines = [`${fi(dayOf(5))} K-MARKET ESIMERKKI 12,50`, `${fi(dayOf(4))} ESIMERKKI RAVINTOLA 8,00`, `${fi(dayOf(3))} S-MARKET ESIMERKKI 25,00`, `${fi(dayOf(2))} MAKSU KIITOS 100,00`];
  await dialog.getByLabel("Liitä rivit").fill(lines.join("\n"));
  await dialog.getByRole("button", { name: "Lue", exact: true }).click();
  await expect(dialog.locator(".cs-rows tbody tr")).toHaveCount(3);
  await expect(dialog.getByText("1 maksurivi jätettiin pois.")).toBeVisible();
  // 12,50 + 8,00 + 25,00 = 45,50 of 123,45
  await expect(dialog.locator(".cs-difference")).toContainText("77,95");
  await expect(dialog.locator(".cs-difference")).toContainText("selvittämättä");
  // a row can be dropped before saving, and typed back in
  await dialog.getByRole("button", { name: "Poista rivi: ESIMERKKI RAVINTOLA" }).click();
  await expect(dialog.locator(".cs-rows tbody tr")).toHaveCount(2);
  await dialog.getByLabel("Päivä", { exact: true }).fill(dayOf(4));
  await dialog.getByLabel("Kuvaus", { exact: true }).fill("ESIMERKKI RAVINTOLA");
  await dialog.getByLabel("Summa", { exact: true }).fill("8,00");
  await dialog.getByRole("button", { name: "Lisää" }).click();
  await expect(dialog.locator(".cs-rows tbody tr")).toHaveCount(3);
  if (process.env.SHOTS_DIR) await dialog.screenshot({ path: join(process.env.SHOTS_DIR, "lead-statement-1280.png") });
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("ostoja eritelty 45,50")).toBeVisible();
  expect(await food(context)).not.toBe(before);

  // opened again it holds the saved rows; Poista erittely brings the bill back whole
  await row.getByRole("button", { name: "Erittele ostot" }).click();
  await expect(page.getByRole("dialog").locator(".cs-rows tbody tr")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 800 });
  // the dialog fades in over 200 ms: wait it out, then it is opaque and nothing of the page shows through
  await expect.poll(() => page.getByRole("dialog").evaluate((d) => getComputedStyle(d).opacity)).toBe("1");
  const bg = await page.getByRole("dialog").evaluate((d) => getComputedStyle(d).backgroundColor);
  expect(bg).not.toMatch(/^transparent$|, 0\)$/);
  const cells = page.getByRole("dialog").locator(".cs-rows tbody tr").first().locator("td");
  // the day and the sum keep to one line
  for (const n of [0, 2]) {
    const lines = await cells.nth(n).evaluate((c) => {
      const r = document.createRange();
      r.selectNodeContents(c);
      return new Set(Array.from(r.getClientRects()).map((q) => Math.round(q.top))).size;
    });
    expect(lines).toBe(1);
  }
  if (process.env.SHOTS_DIR) await page.getByRole("dialog").screenshot({ path: join(process.env.SHOTS_DIR, "lead-statement-390.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Poista erittely" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".tx-item", { hasText: "ESIMERKKI KORTTILASKU" }).getByText("Korttilasku: ostot eivät näy")).toBeVisible();
  expect(await food(context)).toBe(before);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the server's sentence shows when the rows are over the bill", async ({ browser }) => {
  const { context, page } = await importFile(browser);
  await page.goto("/#/transactions?merchant=ESIMERKKI%20KORTTILASKU");
  await page.reload();
  await page.locator("tr", { hasText: "ESIMERKKI KORTTILASKU" }).getByRole("button", { name: "Erittele ostot" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Liitä rivit").fill(`${fi(dayOf(5))} ESIMERKKI KAUPPA 999,00`);
  await dialog.getByRole("button", { name: "Lue", exact: true }).click();
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Rivien summa on yli laskun.");
  await context.close();
});
