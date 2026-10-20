/**
 * The share of the last 12 months' spending that was put in a category without asking: by sum, over the rows that
 * went out and cost something in the end (no transfer, no connected card's bill, no saving, no money in).
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport } from "../src/analysis/data-quality.ts";
import { filedWithoutAsking } from "../src/analysis/filed.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const own: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const spouse: Account = { id: "acc-2", name: "Puolison tili", iban: null, currency: "EUR", type: "checking" };
const day = "2026-09-15";
const filed = (txs: Transaction[], accounts: Account[] = [own], to = today) => filedWithoutAsking(createContext(txs, accounts, today), to);
const row = (cents: number, partial: Partial<Transaction> = {}) => tx({ bookingDate: day, amountCents: -cents, category: "groceries", categorySource: "rule", merchant: "Ruokakauppa Oy", ...partial });
const unfiled = { category: "other", categorySource: "default" } as const;

describe("filedWithoutAsking", () => {
  it("all filed: the share is 1 and the cents are the whole spending", () => {
    const f = filed([row(60_00), row(40_00, { categorySource: "mcc" }), row(25_00, { categorySource: "merchant" })])!;
    expect(f).toEqual({ share: 1, guessShare: 0, userShare: 0, cents: 125_00, totalCents: 125_00 });
  });

  it("none filed: rows left in the default are not", () => {
    const f = filed([row(60_00, unfiled), row(40_00, unfiled)])!;
    expect(f).toEqual({ share: 0, guessShare: 0, userShare: 0, cents: 0, totalCents: 100_00 });
  });

  it("an answer of the user counts in userShare and not in share", () => {
    const f = filed([row(60_00), row(30_00, { categorySource: "user" }), row(10_00, unfiled)])!;
    expect(f.share).toBeCloseTo(0.6, 10);
    expect(f.userShare).toBeCloseTo(0.3, 10);
    expect(f.cents).toBe(60_00);
    expect(f.totalCents).toBe(100_00);
  });

  it("a row filed by a register code or a trade word counts in share and in guessShare", () => {
    const f = filed([row(70_00), row(30_00, { category: "services", categorySource: "industry" })])!;
    expect(f.share).toBe(1);
    expect(f.guessShare).toBeCloseTo(0.3, 10);
  });

  it("a transfer, a connected card's bill, savings and money in are not spending", () => {
    const f = filed([
      row(50_00),
      row(500_00, { category: "transfer", categorySource: "transfer", isTransfer: true }),
      row(300_00, { category: "card_bill", categorySource: "transfer", isTransfer: true }),
      row(200_00, { category: "savings", categorySource: "rule" }),
      tx({ bookingDate: day, amountCents: 900_00, category: "income", categorySource: "rule" }),
    ])!;
    expect(f).toEqual({ share: 1, guessShare: 0, userShare: 0, cents: 50_00, totalCents: 50_00 });
  });

  it("guessShare is a part of what was filed, not of everything", () => {
    const f = filed([row(60_00), row(20_00, { category: "services", categorySource: "industry" }), row(20_00, unfiled)])!;
    expect(f.share).toBeCloseTo(0.8, 10);
    expect(f.guessShare).toBeCloseTo(0.25, 10);
  });

  it("a row left in Muut menot by a rule is not filed, and a pending row counts once", () => {
    const f = filed([row(50_00), row(30_00, { category: "other", categorySource: "mcc" }), row(20_00, { status: "pending", bookingDate: "2026-10-08" })])!;
    expect(f.totalCents).toBe(100_00);
    expect(f.cents).toBe(70_00);
  });

  it("a card bill whose card is not connected is spending that is not filed", () => {
    const f = filed([row(60_00), row(40_00, { category: "card_bill", categorySource: "rule" })])!;
    expect(f.share).toBeCloseTo(0.6, 10);
    expect(f.totalCents).toBe(100_00);
  });

  it("a refund takes off the purchase it returned and a refund alone adds nothing", () => {
    const purchase = row(100_00, { merchant: "Vaatekauppa Oy", category: "shopping" });
    const refund = tx({ bookingDate: "2026-09-18", amountCents: 40_00, category: "shopping", categorySource: "match", merchant: "Vaatekauppa Oy" });
    const f = filed([purchase, refund, row(40_00, unfiled)])!;
    expect(f.totalCents).toBe(100_00);
    expect(f.cents).toBe(60_00);
  });

  it("Oma and Koko talous are two contexts: the same rows give each view its own share", () => {
    const mine = [row(80_00), row(20_00, unfiled)];
    const theirs = [row(100_00, { accountId: "acc-2", ...unfiled })];
    expect(filed(mine)!.share).toBeCloseTo(0.8, 10);
    expect(filed([...mine, ...theirs], [own, spouse])!.share).toBeCloseTo(0.4, 10);
  });

  it("only the 365 days up to the end count: a day before is out, the first day in is in", () => {
    const f = filed([row(10_00, { bookingDate: "2025-10-09" }), row(20_00, { bookingDate: "2025-10-10", ...unfiled }), row(30_00, { bookingDate: "2026-10-10" })], [own], "2026-10-09")!;
    expect(f.totalCents).toBe(20_00);
    expect(f.share).toBe(0);
  });

  it("a range with no spending has no figure and the report has no line", () => {
    expect(filed([tx({ bookingDate: day, amountCents: 900_00, category: "income", categorySource: "rule" })])).toBeNull();
    expect(filed([])).toBeNull();
    expect(dataQualityReport(createContext([], [own], today), { from: "2026-01-01", to: today }).filed).toBeNull();
  });

  it("Tietojen laatu carries the figure of the range's last day", () => {
    const report = dataQualityReport(createContext([row(50_00), row(50_00, unfiled)], [own], today), { from: "2026-09-01", to: today });
    expect(report.filed?.share).toBe(0.5);
  });
});
