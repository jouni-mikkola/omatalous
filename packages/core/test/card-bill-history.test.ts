/**
 * The card bills whose purchases are not itemised, told by kind on read: a connected card's payments before its first
 * row (the bank gives no older rows, nothing to ask), the bills of a card that is not connected, and a payment that
 * pairs with the card's own row, which is a transfer and in neither. The bills stay spending and out of the known
 * share. Names and sums are made up.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport, knownSpending } from "../src/analysis/data-quality.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const range = { from: "2026-10-01", to: today };
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Esimerkki Gold", bank: "Resurs Bank", iban: null, currency: "EUR", type: "credit_card" };
/** The day the card's own rows begin. */
const D = "2026-07-01";

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, counterparty: string, description: string | null = null): Transaction =>
  tx({ id, accountId, bookingDate, amountCents, counterparty, description, merchant: normalizeMerchant(counterparty, description) });

function rows(): Transaction[] {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  return [
    // the card's bills from the account, six of them before the card's rows begin
    ...months.map((m, i) => row(`pay-${i}`, "chk", `${m}-14`, -30_000, "RESURS BANK AB", "KORTTILASKU")),
    // after D the card's own rows hold each payment, so it pairs
    ...months.slice(6).map((m, i) => row(`paid-${i}`, "card", `${m}-14`, 30_000, "SUORITUS", "SUORITUS")),
    ...months.slice(6).map((m, i) => row(`buy-${i}`, "card", `${m}-0${i + 1}`, -4_200, "K-MARKET ESIMERKKI")),
    // a card of another issuer that is never connected
    ...months.map((m, i) => row(`morrow-${i}`, "chk", `${m}-20`, -12_000, "MORROW BANK ASA", "LASKU")),
    ...months.map((m, i) => row(`food-${i}`, "chk", `${m}-05`, -50_000, "PRISMA ESIMERKKI")),
  ];
}

const accounts = [checking, card];
const enriched = enrichTransactions(rows(), accounts, []);
const ctx = createContext(enriched, accounts, today);

describe("card bills by kind", () => {
  it("the connected card's payments before its first row are its history, a card never connected is its own kind", () => {
    const q = buildQuestions(ctx, range, NO_INPUTS);
    expect(q.cardBills).toMatchObject([
      { issuer: "Resurs Bank", cents: 6 * 30_000, count: 6, reason: "before_history", since: D },
      { issuer: "Morrow Bank", cents: 9 * 12_000, count: 9, reason: "not_connected", since: null },
    ]);
    expect(q.cardBills.some((m) => m.reason === "unmatched")).toBe(false);
  });

  it("a payment after D pairs with the card's row: a transfer, in neither kind", () => {
    const after = enriched.filter((t) => t.id === "pay-6" || t.id === "pay-7" || t.id === "pay-8");
    expect(after.map((t) => t.isTransfer)).toEqual([true, true, true]);
    const before = enriched.filter((t) => t.id === "pay-0");
    expect(before.map((t) => [t.isTransfer, t.category])).toEqual([[false, "card_bill"]]);
  });

  it("the bills are no question and out of the known share, which Tietojen laatu reads too", () => {
    const known = knownSpending(ctx, range.to);
    expect(known.window).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(known.share).toBe(1);
    expect(buildQuestions(ctx, range, NO_INPUTS).items.some((i) => i.kind === "payee_out" && /resurs|morrow/i.test(i.merchant))).toBe(false);
    const signal = dataQualityReport(ctx, known.window).signals.find((s) => s.id === "card_bills")!;
    expect(signal.cents).toBe(6 * 30_000 + 9 * 12_000);
    expect(dataQualityReport(ctx, known.window).signals.some((s) => s.id === "uncategorised")).toBe(false);
  });

  it("a bill on or after D that pairs with no card row is the third kind", () => {
    const unpaired = enrichTransactions([...rows().filter((t) => t.id !== "paid-1")], accounts, []);
    const q = buildQuestions(createContext(unpaired, accounts, today), range, NO_INPUTS);
    expect(q.cardBills.find((m) => m.reason === "unmatched")).toMatchObject({ issuer: "Resurs Bank", cents: 30_000, count: 1, since: D });
  });
});
