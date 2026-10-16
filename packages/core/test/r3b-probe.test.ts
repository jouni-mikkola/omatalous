/**
 * Edge cases of one share of unknown spending: `unknownSpending` reads `spendRows` (a card bill whose statement rows are
 * read counts as those rows), a Muut menot row the user set is known, and the `uncategorised` signal, the share the
 * reports print and the spending part of the overview's "Luokiteltu N %" read the same sums. The theme of cash, money to
 * people and card bills is "Raha-asiat", with "Muut menot" as its line of category other. Made-up payees and sums only.
 *
 * A line marked `API: adjust name` guesses a name the change adds: adapt the call there, never the expectation.
 */
import { describe, expect, it } from "vitest";
import { getCategory } from "../src/categories.ts";
import { createContext, spendRows } from "../src/analysis/context.ts";
import { dataQualityReport, spendingBase, unknownSpending } from "../src/analysis/data-quality.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import type { StatementBill } from "../src/analysis/statement-explain.ts";
import { dayNumber } from "../src/dates.ts";
import { THEMES } from "../src/themes.ts";
import { type Account, type BalanceInput, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-16";
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card-1", name: "Esimerkki Kortti", iban: null, currency: "EUR", type: "credit_card" };
const MONTHS = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
/** The overview's window: the 365 days up to the end of September. */
const window = { from: "2025-10-01", to: "2026-09-30" };
const september = { from: "2026-09-01", to: "2026-09-30" };

const other = (bookingDate: string, amountCents: number, merchant: string, more: Partial<Transaction> = {}) => tx({ bookingDate, amountCents, merchant, category: "other", ...more });
/** Muut menot the user set by hand: known spending, not unknown. */
const userOther = () => MONTHS.map((m) => other(`${m}-18`, -10_000, "Esimerkki Palvelu", { categorySource: "user" }));

function household(): Transaction[] {
  return [
    ...MONTHS.flatMap((m) => [
      tx({ bookingDate: `${m}-02`, amountCents: -90_000, merchant: "Esimerkki Asunnot Oy", category: "housing", categorySource: "rule" }),
      tx({ bookingDate: `${m}-05`, amountCents: -40_000, merchant: "K-Market", category: "groceries", categorySource: "rule" }),
      tx({ bookingDate: `${m}-15`, amountCents: 300_000, merchant: "Esimerkki Oy", description: "PALKKA", category: "salary", categorySource: "rule" }),
      // nothing recognised these: Muut menot by the default
      other(`${m}-08`, -10_000, "Tuntematon Maksu"),
    ]),
    // a purchase in Muut menot and its refund
    other("2026-07-03", -10_000, "Esimerkki Verkkokauppa"),
    other("2026-07-10", 4_000, "Esimerkki Verkkokauppa"),
    // a pending row in Muut menot
    other("2026-09-28", -3_000, "Tuntematon Kauppa", { status: "pending" }),
    // a card bill nothing explains
    tx({ bookingDate: "2026-08-10", amountCents: -30_000, merchant: "TOINEN KORTTI", counterparty: "TOINEN KORTTI", category: "card_bill", categorySource: "rule" }),
    // a card bill whose statement rows are read, one of them unrecognised
    tx({ id: "bill-1", bookingDate: "2026-09-10", amountCents: -42_000, merchant: "ESIMERKKI KORTTI", counterparty: "ESIMERKKI KORTTI", category: "card_bill", categorySource: "rule" }),
    ...userOther(),
  ].filter((t) => t.bookingDate <= today);
}

const statement: StatementBill = {
  billId: "bill-1",
  periodFrom: "2026-08-01",
  periodTo: "2026-08-31",
  rows: [
    { id: "s1", day: "2026-08-04", cents: 15_000, text: "K-MARKET ESIMERKKI", category: "groceries" },
    { id: "s2", day: "2026-08-12", cents: 7_000, text: "ESIMERKKI XYZ 123", category: "other" },
    { id: "s3", day: "2026-08-20", cents: 20_000, text: "VERKKOKAUPPA ESIMERKKI", category: "shopping" },
  ],
};

const ctxOf = (rows: Transaction[]) => createContext(rows, [checking, card], today, undefined, [], [], [statement]);
const plain = (s: string) => s.replace(/\s/g, " ");
/** The salaries of the window: twelve of 3000 euros, all recognised, so the money-in side of the share holds nothing unknown. */
const INCOME_CENTS = 12 * 300_000;
/** The overview's classified share as the unknown spending of the same rows says it. */
const classifiedShare = (u: { otherCents: number; billCents: number; spendingCents: number }) => Math.min(1, Math.max(0, 1 - (u.otherCents + u.billCents) / (u.spendingCents + INCOME_CENTS)));
type Unknown = ReturnType<typeof unknownSpending> & { otherShare: number }; // API: adjust name (otherShare)

describe("one share of unknown spending", () => {
  const ctx = ctxOf(household());
  const u = unknownSpending(ctx, window) as Unknown;
  const q = buildQuestions(ctx, window, NO_INPUTS);
  const signal = dataQualityReport(ctx, window).signals.find((s) => s.id === "uncategorised");

  it("reads the statement rows of a read bill, not the bill", () => {
    expect(ctx.statements.get("bill-1")).toEqual({ read: true });
    const days = { fromDay: dayNumber(window.from), toDay: dayNumber(window.to) };
    expect(u.spendingCents).toBe(spendingBase(spendRows(ctx, days)));
  });

  it("gives the spending part of the overview's classified share the same sums", () => {
    expect(q.cardBillCents).toBe(u.billCents);
    expect(q.share).toBeCloseTo(classifiedShare(u), 10);
  });

  it("gives the uncategorised signal the same sum and share", () => {
    expect(u.otherShare).toBeCloseTo(u.otherCents / u.spendingCents, 10);
    expect(u.share).toBeCloseTo(Math.min(1, (u.otherCents + u.billCents) / u.spendingCents), 10);
    expect(signal).toBeDefined();
    expect(signal!.cents).toBe(u.otherCents);
    expect(plain(signal!.title)).toBe(`${Math.round(u.otherShare * 100)} % menoista on luokittelematta`);
  });

  it("keeps the money-in part of the overview's share as its one addition", () => {
    // the spending side is unknownSpending's; the income side is the questions' own
    expect(q.share).toBeCloseTo(classifiedShare(u), 10);
    const unknownIncome = ctxOf([...household(), tx({ bookingDate: "2026-09-20", amountCents: 100_000, merchant: "Tuntematon Maksaja", category: "income", categorySource: "default" })]);
    expect(buildQuestions(unknownIncome, window, NO_INPUTS).share).toBeCloseTo(1 - (u.otherCents + u.billCents + 100_000) / (u.spendingCents + INCOME_CENTS + 100_000), 10);
  });

  it("counts the pending Muut menot row the same in all of them", () => {
    // whichever rule is chosen, the three read the same rows: the pending row moves both sums or neither
    const without = ctxOf(household().filter((t) => t.status !== "pending"));
    const delta = u.otherCents - unknownSpending(without, window).otherCents;
    expect(delta).not.toBe(0);
    expect(buildQuestions(without, window, NO_INPUTS).share).toBeCloseTo(classifiedShare(unknownSpending(without, window)), 10);
  });

  it("counts the unrecognised statement row the same in all of them", () => {
    const noOther: StatementBill = { ...statement, rows: statement.rows.map((r) => (r.category === "other" ? { ...r, category: "shopping" } : r)) };
    const known = createContext(household(), [checking, card], today, undefined, [], [], [noOther]);
    const delta = u.otherCents - unknownSpending(known, window).otherCents;
    expect(delta).not.toBe(0);
    expect(buildQuestions(known, window, NO_INPUTS).share).toBeCloseTo(classifiedShare(unknownSpending(known, window)), 10);
  });
});

describe("a Muut menot row the user set", () => {
  const withUser = ctxOf(household());
  const withoutUser = ctxOf(household().filter((t) => t.categorySource !== "user"));

  it("is known in unknownSpending, the signal and the questions alike", () => {
    expect(unknownSpending(withUser, window).otherCents).toBe(unknownSpending(withoutUser, window).otherCents);
    for (const c of [withUser, withoutUser]) expect(buildQuestions(c, window, NO_INPUTS).share).toBeCloseTo(classifiedShare(unknownSpending(c, window)), 10);
    const s = dataQualityReport(withUser, window).signals.find((x) => x.id === "uncategorised")!;
    expect(s.cents).toBe(unknownSpending(withoutUser, window).otherCents);
    expect(s.detail).not.toContain("Esimerkki Palvelu");
  });

  it("stays in the spending base", () => {
    expect(unknownSpending(withUser, window).spendingCents - unknownSpending(withoutUser, window).spendingCents).toBe(userOther().filter((t) => t.bookingDate >= window.from && t.bookingDate <= window.to).length * 10_000);
  });

  it("does not lift the share over the 5 % line by itself", () => {
    // September: 900 + 400 € spent, 40 € unknown (3 %); the user's 100 € in Muut menot would make it 140 € (9.7 %)
    const rows = [
      tx({ bookingDate: "2026-09-02", amountCents: -90_000, merchant: "Esimerkki Asunnot Oy", category: "housing", categorySource: "rule" }),
      tx({ bookingDate: "2026-09-05", amountCents: -40_000, merchant: "K-Market", category: "groceries", categorySource: "rule" }),
      other("2026-09-08", -4_000, "Tuntematon Maksu"),
      other("2026-09-18", -10_000, "Esimerkki Palvelu", { categorySource: "user" }),
    ];
    const ctx = createContext(rows, [checking], today);
    expect(dataQualityReport(ctx, september).signals.some((s) => s.id === "uncategorised")).toBe(false);
    // near miss: 80 € unknown of 1 480 € (5.4 %) is told
    const more = createContext([...rows, other("2026-09-22", -4_000, "Tuntematon Maksu")], [checking], today);
    expect(dataQualityReport(more, september).signals.find((s) => s.id === "uncategorised")?.title.replace(/\s/g, " ")).toBe("5 % menoista on luokittelematta");
  });
});

describe("a card bill with statement rows in a one-month range", () => {
  it("measures September against its spendRows: the bill is lowered, its rows count in August", () => {
    const ctx = ctxOf(household());
    const days = { fromDay: dayNumber(september.from), toDay: dayNumber(september.to) };
    expect(unknownSpending(ctx, september).spendingCents).toBe(spendingBase(spendRows(ctx, days)));
    const aug = { from: "2026-08-01", to: "2026-08-31" };
    // August holds the unrecognised statement row of 70 € and the 100 € paid by the default
    expect(unknownSpending(ctx, aug).otherCents).toBe(10_000 + 7_000);
  });
});

describe("savings to an account that is not connected", () => {
  it("says the account is not connected, with the sum and the rest of the sentence as before", () => {
    const rows = [
      tx({ bookingDate: "2026-09-15", amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary", categorySource: "rule" }),
      tx({ bookingDate: "2026-09-20", amountCents: -50_000, merchant: "Esimerkki Rahasto", category: "savings", categorySource: "rule" }),
    ];
    const s = dataQualityReport(createContext(rows, [checking], today), september).signals.find((x) => x.id === "own_unconnected")!;
    expect(plain(s.title)).toBe("500 € säästöjä meni tilille, jota ei ole yhdistetty");
    expect(s.detail).toBe("Suurimmat saajat: Esimerkki Rahasto. Yhdistä tili.");
  });

  it("near miss: an account without a balance keeps its own sentence", () => {
    const balance: BalanceInput = { id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: null, ownerName: null, balanceAt: today };
    const rows = [tx({ bookingDate: "2026-09-05", amountCents: -4_000, merchant: "K-Market", category: "groceries", categorySource: "rule" })];
    const s = dataQualityReport(createContext(rows, [checking], today), september, [balance]).signals.find((x) => x.id === "no_balance")!;
    expect(s.title).toBe("Tilin Käyttötili saldoa ei tiedetä");
  });
});

describe("the theme of cash, money to people and card bills", () => {
  it("is Raha-asiat, and its line of category other is Muut menot", () => {
    const theme = THEMES.find((t) => t.lines.some((l) => l.id === "card_bill"))!;
    expect(theme.heading).toBe("Raha-asiat");
    expect(theme.lines.find((l) => l.id === "other")?.heading).toBe("Muut menot");
    expect(theme.lines.map((l) => l.id)).toEqual(["cash", "p2p", "card_bill", "other"]);
  });

  it("leaves the category's own label as it is, and no other theme is called Muut menot", () => {
    expect(getCategory("other").label).toBe("Muut menot");
    expect(THEMES.filter((t) => t.heading === "Muut menot")).toEqual([]);
  });
});

// Covers: unknownSpending on spendRows (read card bill, unread bill, statement row in other), otherShare and share, same sums in signal and questions.
// Covers: a user-set Muut menot row known everywhere (and kept in the base), a pending row and a refund read alike, the 5 % line with a near miss.
// Covers: the own_unconnected sentence (no_balance unchanged) and the theme renamed Raha-asiat with its Muut menot line.
