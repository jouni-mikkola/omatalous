/**
 * Edge cases of the overview's comparison with the period before: it is told on the accounts both periods share
 * (accountsCoverage().compare, as the summary does), hidden only when the accounts left out carry over a tenth of the
 * later period's spending, and read from spendRows on both sides. When an account is left out the view says so with
 * the existing "samoista tileistä" sentence. Made-up payees and sums only.
 *
 * This file reads the web view, so it belongs in apps/web/test. A line marked `API: adjust name` guesses a name the
 * change adds: adapt the call there, never the expectation.
 */
import { type Account, buildDashboard, createContext, type StatementBill, spendRows, totalsOf, type Transaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { incomeSpendingView } from "../src/components/overview/income-spending.ts";

const today = "2026-10-16";
const A: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const CARD: Account = { id: "card-1", name: "Esimerkki Kortti", iban: null, currency: "EUR", type: "credit_card" };
const OLD: Account = { id: "old", name: "Vanha tili", iban: null, currency: "EUR", type: "checking" };
const ACCOUNTS = [A, CARD, OLD];

let seq = 0;
const row = (accountId: string, bookingDate: string, amountCents: number, category: string, merchant: string, more: Partial<Transaction> = {}): Transaction => ({
  id: `p${++seq}`,
  accountId,
  currency: "EUR",
  status: "booked",
  counterparty: merchant,
  counterpartyIban: null,
  description: null,
  mcc: null,
  merchant,
  category,
  categorySource: "rule",
  isTransfer: false,
  bookingDate,
  amountCents,
  ...more,
});

const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
/** The old checking account: pay on the 15th, rent on the 2nd, the same groceries on the 3rd, 7th and 11th of every month, up to today. */
const household = (): Transaction[] =>
  MONTHS.flatMap((m) => [
    row("acc-1", `${m}-02`, -90_000, "housing", "Esimerkki Asunnot Oy"),
    row("acc-1", `${m}-03`, -4_000, "groceries", "K-Market"),
    row("acc-1", `${m}-07`, -4_000, "groceries", "K-Market"),
    row("acc-1", `${m}-11`, -4_000, "groceries", "K-Market"),
    row("acc-1", `${m}-15`, 300_000, "salary", "Esimerkki Oy"),
    row("acc-1", `${m}-${m === "2026-10" ? "16" : "26"}`, -2_000, "restaurants", "Esimerkki Kahvila"),
  ]).filter((t) => t.bookingDate <= today);

const october = { from: "2026-10-01", to: "2026-10-31" };
const august = { from: "2026-08-01", to: "2026-08-31" };
const dashboardOf = (rows: Transaction[], range = october, statements: StatementBill[] = []) => buildDashboard(createContext(rows, ACCOUNTS, today, undefined, [], [], statements), range);
const SENTENCE = "samoista tileistä";
const plain = (s: string) => s.replace(/\s/g, " ").replace(/−/g, "-");

describe("a card linked this month", () => {
  // three grocery purchases on the new card, 45 €: under a tenth of October's spending
  const card = ["2026-10-04", "2026-10-08", "2026-10-12"].map((d) => row("card-1", d, -1_500, "groceries", "K-Market"));
  const data = dashboardOf([...household(), ...card]);
  const view = incomeSpendingView(data);

  it("keeps the comparison, told on the old account", () => {
    expect(data.comparable).toBe(true);
    expect(view.previous?.month).toBe("Syyskuu");
    // September 1-16 on the old account: rent, three grocery purchases
    expect(data.previousTotals.expenseCents).toBe(90_000 + 3 * 4_000);
    expect(view.figures.find((f) => f.label === "Menot")?.previous).not.toBeNull();
  });

  it("does not tell the card's purchases as a change in groceries: the row is compared on the shared account on both sides", () => {
    const groceries = view.categories.find((c) => c.key === "groceries")!;
    // the row's sum is the whole month, both accounts
    expect(plain(groceries.text)).toBe("165,00 €");
    // the old account bought 120 € of groceries by the 16th in both months: no change to tell
    expect(groceries.change).toBe("");
  });

  it("says the comparison leaves an account out, in the sentence that already exists", () => {
    expect(JSON.stringify(view)).toContain(SENTENCE);
  });

  it("near miss: without the card nothing is left out and nothing is said about it", () => {
    const plainView = incomeSpendingView(dashboardOf(household()));
    expect(plainView.previous).not.toBeNull();
    expect(JSON.stringify(plainView)).not.toContain(SENTENCE);
  });
});

describe("the share left out decides", () => {
  it("hides the comparison when the new card carries over a tenth of the month's spending", () => {
    const card = ["2026-10-04", "2026-10-06", "2026-10-08", "2026-10-10", "2026-10-12"].map((d) => row("card-1", d, -20_000, "groceries", "K-Market"));
    const data = dashboardOf([...household(), ...card]);
    const view = incomeSpendingView(data);
    expect(data.comparable).toBe(false);
    expect(view.previous).toBeNull();
    expect(view.figures.every((f) => f.previous === null)).toBe(true);
    expect(view.categories.every((c) => c.change === "")).toBe(true);
  });

  it("near miss: just under the tenth it is told", () => {
    // October 1-16 on the old account: 900 + 120 + 20 = 1 040 €; the card's 110 € is 9.6 % of 1 150 €
    const card = [row("card-1", "2026-10-05", -11_000, "shopping", "Esimerkki Kauppa")];
    expect(dashboardOf([...household(), ...card]).comparable).toBe(true);
  });

  it("counts a refund on the new card as no spending: the purchases alone are weighed", () => {
    // 110 € bought and 100 € of it returned: the left-out share is the 110 € purchase, still under a tenth
    const card = [row("card-1", "2026-10-05", -11_000, "shopping", "Esimerkki Kauppa"), row("card-1", "2026-10-09", 10_000, "shopping", "Esimerkki Kauppa")];
    expect(dashboardOf([...household(), ...card]).comparable).toBe(true);
  });
});

describe("an account closed before the periods", () => {
  it("is in neither period, so nothing is left out and nothing is said", () => {
    const old = ["2026-04-05", "2026-05-05", "2026-06-05", "2026-06-30"].map((d) => row("old", d, -5_000, "shopping", "Esimerkki Kauppa"));
    const data = dashboardOf([...household(), ...old]);
    expect(data.comparable).toBe(true);
    expect(JSON.stringify(incomeSpendingView(data))).not.toContain(SENTENCE);
  });
});

describe("an account that ended in the earlier period", () => {
  // the old account's last rows are in July; August is compared with July
  const old = ["2026-04-20", "2026-05-20", "2026-06-20", "2026-07-20"].map((d) => row("old", d, -30_000, "shopping", "Esimerkki Kauppa"));
  // the card bill of 5.8. paid from the shared account, with its statement rows read on their own days in July
  const bill = row("acc-1", "2026-08-05", -12_000, "card_bill", "ESIMERKKI KORTTI");
  const statement: StatementBill = {
    billId: bill.id,
    periodFrom: "2026-07-01",
    periodTo: "2026-07-31",
    rows: [
      { id: "s1", day: "2026-07-09", cents: 7_000, text: "ESIMERKKI POLTTOAINE", category: "car" },
      { id: "s2", day: "2026-07-21", cents: 5_000, text: "K-MARKET ESIMERKKI", category: "groceries" },
    ],
  };
  const rows = [...household(), ...old, bill];
  const ctx = createContext(rows, ACCOUNTS, today, undefined, [], [], [statement]);
  const data = buildDashboard(ctx, august);

  it("is left out of the earlier side, and the comparison is still told", () => {
    expect(data.comparable).toBe(true);
    expect(data.range.previousFrom).toBe("2026-07-01");
    // July on the shared account, read from spendRows: the statement rows count in July, the old account's 300 € does not
    const july = spendRows(ctx, { fromDay: 0, toDay: Number.MAX_SAFE_INTEGER }).filter((t) => t.bookingDate.startsWith("2026-07") && t.accountId === "acc-1");
    expect(data.previousTotals.expenseCents).toBe(totalsOf(july.map((t) => t.flows)).expenseCents);
    expect(data.previousTotals.expenseCents).toBe(90_000 + 12_000 + 2_000 + 12_000);
  });

  it("gives each category's earlier sum on the shared account only", () => {
    expect(data.categories.find((c) => c.category === "shopping")?.previousCents ?? 0).toBe(0);
    expect(data.categories.find((c) => c.category === "groceries")?.previousCents).toBe(12_000 + 5_000);
  });

  it("says an account was left out", () => {
    expect(JSON.stringify(incomeSpendingView(data))).toContain(SENTENCE);
  });
});

describe("a pending row on the new card", () => {
  it("weighs in the left-out share like a booked one", () => {
    const card = [row("card-1", "2026-10-15", -30_000, "shopping", "Esimerkki Kauppa", { status: "pending" })];
    // 300 € of 1 340 € is over a tenth
    expect(dashboardOf([...household(), ...card]).comparable).toBe(false);
  });
});

// Covers: card linked this month (comparison kept on the old account, no false category change, sentence shown), near miss without it.
// Covers: left-out share over and just under a tenth, a refund on the new card, a pending row, an account closed before both periods.
// Covers: an account that ended in the earlier period with a card bill read from statement rows (previousTotals and previousCents from spendRows on shared).
