import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, overflow, removeMember, watch } from "./helpers.ts";

// Tarkistettavat > Täydennä lainat lists a card whose purchases are not in the data, with its sum and the ways to bring
// them in. The data is the administrator's demo household, imported under a fresh member with one card bill added
// and no card connected.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const BILL_CENTS = 45678;
const CARD = "ESIMERKKI KORTTILASKU";
const CARD_NAME = /esimerkki korttilasku/i;

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, "e2e-puuttuvat-kortit");
  const admin = await browser.newContext({ storageState: STATE });
  const res = await admin.request.post("/api/data/export", { headers: FETCH });
  expect(res.ok()).toBe(true);
  const parsed = JSON.parse(await res.text()) as { accounts: Record<string, unknown>[]; transactions: Record<string, unknown>[]; loans?: unknown[]; loanPaymentParts?: unknown[] };
  const adminName = String(parsed.transactions[0]!.owner_username);
  const checking = new Set(parsed.accounts.filter((a) => a.type === "checking").map((a) => a.id));
  const own = parsed.transactions.filter((t) => checking.has(t.account_id) && t.status === "booked");
  // the last day of the month before this one: inside the twelve complete months the list reads
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  parsed.transactions.push({
    ...own[0]!,
    id: "e2e-missing-card-bill",
    booking_date: day.toISOString().slice(0, 10),
    value_date: null,
    amount_cents: -BILL_CENTS,
    status: "booked",
    merchant: CARD,
    counterparty: CARD,
    counterparty_iban: null,
    description: null,
    reference: null,
    category: "card_bill",
    category_source: "rule",
    is_transfer: 0,
    signature: "e2e-missing-card-bill-signature",
  });
  // with a card account connected the bill is a transfer to it and no card bill
  const cards = new Set(parsed.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  parsed.accounts = parsed.accounts.filter((a) => !cards.has(a.id));
  parsed.transactions = parsed.transactions.filter((t) => !cards.has(t.account_id));
  // a card loan another test saved for the administrator with no link would stand for the largest card that is not connected
  parsed.loans = [];
  parsed.loanPaymentParts = [];
  const file = JSON.stringify(parsed).split(`"${adminName}"`).join(`"e2e-puuttuvat-kortit"`);
  await admin.close();

  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/settings/data");
  const card = page.locator(".card", { has: page.getByRole("heading", { level: 2, name: "Tiedot", exact: true }) });
  await card.locator("input[type=file]").setInputFiles({ name: "omatalous.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await card.getByRole("button", { name: "Tuo", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Tiedot tuotu");
  await context.close();
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

test("390 px: the missing card is a row of Täydennä lainat with its sum and four 44 px answers, and the page does not scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/review?item=loan-terms");
  const card = page.locator(".review-item");
  await expect(card.getByRole("heading", { level: 2 })).toContainText("Täydennä lainat");
  const row = card.locator("li.review-debt", { has: page.locator(".review-debt-name", { hasText: CARD_NAME }) });
  await expect(row.locator(".review-debt-name")).toContainText("456,78");
  const connect = row.getByRole("link", { name: /^Yhdistä/ });
  await expect(connect).toBeVisible();
  const answers = [connect, row.getByRole("button", { name: "Lisää kortin velka" }), row.getByRole("link", { name: "Lisää tiliote" }), row.getByRole("button", { name: "En tiedä" })];
  for (const answer of answers) {
    const box = (await answer.boundingBox())!;
    expect(box.height, "the action is at least 44 px high").toBeGreaterThanOrEqual(44);
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // the action goes to the bank list
  await connect.click();
  await expect(page).toHaveURL(/#\/settings\/banks\?add=1/);
  expect(seen.problems).toEqual([]);
  await context.close();
});
