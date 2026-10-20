/**
 * "Tunnistettu X % menoista" is one figure: the questions of the dashboard, the uncategorised signal of Tietojen laatu,
 * the line of Raportit (`cashflow.unknownShare`) and of Optimoi (`unknownSpending`) read `knownSpending`, over the twelve
 * complete months up to the range's end, whatever the range. Card bills are in neither side of it. Made-up payees and sums.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport, knownSpending, unknownSpending } from "../src/analysis/data-quality.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const MONTHS = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const out = (bookingDate: string, euros: number, merchant: string, more: Partial<Transaction> = {}) => tx({ accountId: "chk", bookingDate, amountCents: -euros * 100, merchant, ...more });

function household(): Transaction[] {
  return MONTHS.flatMap((m, i) => [
    out(`${m}-03`, 600, "Esimerkki Asunnot Oy", { category: "housing", categorySource: "rule" }),
    out(`${m}-07`, 300, "Esimerkki Market", { category: "groceries", categorySource: "rule" }),
    out(`${m}-11`, 40 + i * 10, `Tuntematon ${i % 3}`),
    out(`${m}-15`, 250, "ESIMERKKI KORTTI", { category: "card_bill", categorySource: "rule", counterparty: "ESIMERKKI KORTTI" }),
    tx({ accountId: "chk", bookingDate: `${m}-25`, amountCents: 280_000, merchant: "Esimerkki Työnantaja Oy", category: "salary", categorySource: "rule" }),
  ]).filter((t) => t.bookingDate <= today);
}

const ctx = createContext(household(), [checking], today);
const percent = (share: number) => Math.floor(share * 100 + 1e-9);

describe("one known share on every reader", () => {
  const known = knownSpending(ctx, today);

  it("is the twelve complete months, Muut menot against the spending without the card bills", () => {
    expect(known.window).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    // October to September: Tuntematon 50 + 60 + ... + 160 euros, of 900 a month plus those
    const other = Array.from({ length: 12 }, (_, i) => 50 + i * 10).reduce((a, b) => a + b, 0) * 100;
    expect(known.otherCents).toBe(other);
    expect(known.spendingCents).toBe(12 * 90_000 + other);
    expect(known.share).toBe(1 - other / (12 * 90_000 + other));
    expect(known.bills.reduce((sum, m) => sum + m.cents, 0)).toBe(12 * 25_000);
  });

  it("the questions, the signal, Raportit and Optimoi say the same figure for any range that ends in the same place", () => {
    for (const range of [{ from: "2026-10-01", to: today }, { from: "2026-01-01", to: today }, { from: "2026-10-01", to: "2026-10-31" }]) {
      expect(buildQuestions(ctx, range, NO_INPUTS).share).toBe(known.share);
      expect(1 - unknownSpending(ctx, range).share).toBeCloseTo(known.share!, 12);
      expect(1 - cashflowReport(ctx, range).unknownShare).toBeCloseTo(known.share!, 12);
    }
    // a range that ends with September has the same window
    const september = { from: "2026-09-01", to: "2026-09-30" };
    expect(buildQuestions(ctx, september, NO_INPUTS).share).toBe(known.share);
    const signal = dataQualityReport(ctx, september).signals.find((s) => s.id === "uncategorised")!;
    expect(signal.title.replace(/\s/g, " ")).toBe(`${percent(known.share!)} % viimeisen 12 valmiin kuukauden menoista on tunnistettu`);
    expect(signal.cents).toBe(known.otherCents);
  });

  it("an earlier end moves the window with it, and nothing spent is no share", () => {
    const june = knownSpending(ctx, "2026-06-15");
    expect(june.window).toEqual({ from: "2025-06-01", to: "2026-05-31" });
    expect(june.share).not.toBe(known.share);
    expect(knownSpending(createContext([], [checking], today)).share).toBeNull();
    expect(unknownSpending(createContext([], [checking], today), { from: "2026-10-01", to: today }).share).toBe(0);
  });

  it("a card bill moves neither side, and a Muut menot row the user set is known", () => {
    const more = createContext([...household(), out("2026-05-15", 5000, "ESIMERKKI KORTTI", { category: "card_bill", categorySource: "rule", counterparty: "ESIMERKKI KORTTI" })], [checking], today);
    expect(knownSpending(more).share).toBe(known.share);
    const set = createContext(household().map((t) => (t.merchant.startsWith("Tuntematon") ? { ...t, categorySource: "user" as const, category: "other" } : t)), [checking], today);
    expect(knownSpending(set).share).toBe(1);
  });
});
