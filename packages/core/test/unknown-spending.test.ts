import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport, unknownSpending } from "../src/analysis/data-quality.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import type { StatementBill } from "../src/analysis/statement-explain.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

/**
 * The share of spending nobody categorised is one figure: the signal of Tietojen laatu, the line of Raportit and
 * Optimoi (`unknownShare`) and the questions of the dashboard read `unknownSpending`.
 */
const checking: Account = { id: "chk", name: "Käyttötili", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "checking" };
const today = "2026-04-01";
const month = { from: "2026-03-01", to: "2026-03-31" };
const out = (euros: number, merchant: string, over: Partial<Transaction> = {}) =>
  tx({ accountId: "chk", bookingDate: "2026-03-10", amountCents: -euros * 100, merchant, ...over });
const ctxOf = (rows: Transaction[], statements: StatementBill[] = []) => createContext(rows, [checking], today, undefined, [], [], statements);
const signalOf = (ctx: ReturnType<typeof ctxOf>) => dataQualityReport(ctx, month).signals.find((s) => s.id === "uncategorised");
const groceries = (euros: number) => out(euros, "Prisma", { category: "groceries", categorySource: "rule" });

describe("one share of uncategorised spending", () => {
  it("is the same in the signal, the report line and the questions for the same rows", () => {
    const ctx = ctxOf([groceries(800), out(100, "Kioski Oy")]);
    const u = unknownSpending(ctx, month);
    expect(u).toMatchObject({ otherCents: 10000, billCents: 0, spendingCents: 90000, otherShare: 100 / 900, share: 100 / 900 });
    expect(signalOf(ctx)).toMatchObject({ cents: 10000, title: expect.stringMatching(/^11\s%\smenoista on luokittelematta$/) });
    expect(cashflowReport(ctx, month).unknownShare).toBe(u.share);
    const q = buildQuestions(ctx, month, NO_INPUTS);
    expect(q).toMatchObject({ share: 1 - u.share });
  });

  it("counts a Muut menot row the user set as known everywhere", () => {
    const ctx = ctxOf([groceries(800), out(100, "Kioski Oy", { categorySource: "user" })]);
    expect(unknownSpending(ctx, month)).toMatchObject({ otherCents: 0, otherShare: 0, share: 0, spendingCents: 90000 });
    expect(signalOf(ctx)).toBeUndefined();
    expect(buildQuestions(ctx, month, NO_INPUTS)).toMatchObject({ share: 1, items: [] });
    // the near miss: the same row left to the default is the gap
    expect(signalOf(ctxOf([groceries(800), out(100, "Kioski Oy")]))).toBeDefined();
  });

  it("keeps the signal's 5 % threshold, and a purchase counts at what it cost in the end", () => {
    expect(signalOf(ctxOf([groceries(960), out(40, "Kioski Oy")]))).toBeUndefined();
    expect(signalOf(ctxOf([groceries(950), out(50, "Kioski Oy")]))).toMatchObject({ cents: 5000 });
    const back = tx({ accountId: "chk", bookingDate: "2026-03-20", amountCents: 3000, merchant: "Kioski Oy" });
    const partly = ctxOf([groceries(950), out(80, "Kioski Oy"), back]);
    expect(unknownSpending(partly, month).otherCents).toBe(5000);
    expect(signalOf(partly)).toMatchObject({ cents: 5000 });
  });

  it("reads a card bill at what its statement rows leave, in the base and the bill sum alike", () => {
    const bill = out(420, "ESIMERKKI KORTTI", { id: "bill", category: "card_bill", categorySource: "rule", counterparty: "ESIMERKKI KORTTI" });
    const rows: StatementBill["rows"] = [
      { id: "r1", day: "2026-02-03", cents: 6150, text: "K-MARKET ESIMERKKI", category: "groceries" },
      { id: "r2", day: "2026-02-09", cents: 8000, text: "ESIMERKKI POLTTOAINE", category: "car" },
      { id: "r3", day: "2026-02-20", cents: 15000, text: "VERKKOKAUPPA ESIMERKKI", category: "shopping" },
    ];
    const ctx = ctxOf([bill, out(52, "Kioski Oy")], [{ billId: "bill", periodFrom: "2026-02-01", periodTo: "2026-02-28", rows }]);
    const u = unknownSpending(ctx, month);
    // the bill leaves 420 - 291.50 = 128.50 in March, and that is what the table of bills says is not itemised
    expect(u).toMatchObject({ billCents: 12850, otherCents: 5200, spendingCents: 12850 + 5200, share: 1 });
    expect(u.otherShare).toBe(5200 / 18050);
    expect(signalOf(ctx)).toMatchObject({ title: expect.stringMatching(/^29\s%\smenoista on luokittelematta$/) });
    expect(cashflowReport(ctx, month).unknownShare).toBe(u.share);
    // the questions read twelve months: the statement's purchases of February are in its base too
    const year = unknownSpending(ctx, { from: "2025-04-02", to: month.to });
    expect(year).toMatchObject({ spendingCents: 12850 + 5200 + 29150, otherCents: 5200, billCents: 12850 });
    expect(buildQuestions(ctx, month, NO_INPUTS)).toMatchObject({ cardBillCents: 12850, share: 1 - (5200 + 12850) / year.spendingCents });
  });

  it("adds a bill without purchases to the share but not to the signal's Muut menot", () => {
    const bill = out(200, "ESIMERKKI KORTTI", { category: "card_bill", categorySource: "rule", counterparty: "ESIMERKKI KORTTI" });
    const ctx = ctxOf([groceries(700), out(100, "Kioski Oy"), bill]);
    const u = unknownSpending(ctx, month);
    expect(u.billCents).toBeGreaterThan(0);
    expect(u.share).toBe((u.otherCents + u.billCents) / u.spendingCents);
    expect(u.otherShare).toBe(10000 / 100000);
    expect(buildQuestions(ctx, month, NO_INPUTS)).toMatchObject({ cardBillCents: u.billCents });
  });
});
