/**
 * Households of OP, S-Pankki and Danske (kit/households): the rules were written against Nordea's rows, so each of
 * these checks what a household of another bank gets from them.
 */
import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { addMonths } from "../src/dates.ts";
import { contextOf } from "../../../tools/findings/households.ts";
import { BANK_TODAY } from "./kit/households/build.ts";
import { bankHouseholds } from "./kit/households/index.ts";

const households = bankHouseholds();
const named = (name: string) => households.find((h) => h.name === name)!;

describe("households of other banks", () => {
  for (const h of households) {
    const ctx = contextOf(h);
    const from = `${Number(h.today.slice(0, 4)) - 1}${h.today.slice(4)}`;
    const last12 = ctx.txs.filter((t) => t.bookingDate >= from && t.bookingDate < h.today);

    it(`${h.name}: at least 90 % of 12 months' spending is categorised without a question`, () => {
      const spending = last12.filter((t) => t.amountCents < 0 && !t.isTransfer);
      const asked = spending.filter((t) => t.category === "other");
      expect(spending.length).toBeGreaterThan(200);
      expect(1 - asked.length / spending.length).toBeGreaterThanOrEqual(0.9);
    });
  }

  it("bank:op-couple: a card bill paid by statement is no missing payment", () => {
    const h = named("bank:op-couple");
    const ctx = contextOf(h);
    const ahead = cashAhead(ctx, h.balances, h.inputs);
    const cardRows = [...ahead.rows, ...ahead.upcoming].filter((r) => r.source === "card");
    // the 9th is behind us: the next statement is due on the 9th of next month, and nothing is due before it
    expect(cardRows.length).toBeGreaterThan(0);
    expect(cardRows.filter((r) => r.date <= BANK_TODAY)).toEqual([]);
    expect(cardRows.every((r) => r.date >= `${addMonths(BANK_TODAY.slice(0, 7), 1)}-01`)).toBe(true);
    const bills = ctx.txs.filter((t) => t.description === "OP VISA CREDIT LASKU");
    expect(bills.length).toBeGreaterThan(10);
    expect(bills.every((t) => t.isTransfer)).toBe(true);
  });

  it("bank:danske-family: the Swedish card text is groceries without an mcc", () => {
    const rowsOf = contextOf(named("bank:danske-family")).txs.filter((t) => /^KORTKÖP K-MARKET/.test(t.description ?? "") && !t.mcc);
    expect(rowsOf.length).toBeGreaterThan(5);
    expect(rowsOf.filter((t) => t.category !== "groceries").map((t) => t.description)).toEqual([]);
  });

  it("bank:s-pankki-single: the debit card text is spending, not a person", () => {
    const rowsOf = contextOf(named("bank:s-pankki-single")).txs.filter((t) => /^KORTTIOSTO PRISMA/.test(t.description ?? ""));
    expect(rowsOf.length).toBeGreaterThan(5);
    expect(rowsOf.filter((t) => t.category !== "groceries").map((t) => t.description)).toEqual([]);
  });

  it("bank:danske-family: the joint account is counted whole, the mortgage keeps its full instalment", () => {
    const h = named("bank:danske-family");
    const ctx = contextOf(h);
    const mortgage = ctx.txs.filter((t) => t.category === "mortgage");
    expect(mortgage.length).toBeGreaterThan(10);
    // no member said a split (owner rule L5): no row is cut to a part
    expect(mortgage.every((t) => t.amountCents === -98_700 && t.wholeCents === undefined)).toBe(true);
    expect(mortgage.every((t) => t.spend === 98_700)).toBe(true);
    expect(h.balances.find((b) => b.id === "joint")?.use).toBeUndefined();
    expect(h.balances.find((b) => b.id === "joint")?.part).toBeUndefined();
  });

  // The split reads as unknown once JS1 adds the marker to the balance; until then there is nothing to read
  it.todo("bank:danske-family: the joint account is marked with its split unknown (JS1)");
  it("bank:danske-family: the account fee AVGIFT KONTO is a bank fee, no forgotten service", () => {
    const ctx = contextOf(named("bank:danske-family"));
    const fee = ctx.txs.filter((t) => t.description === "AVGIFT KONTO");
    expect(fee.length).toBeGreaterThan(10);
    expect(fee.every((t) => t.category === "fees")).toBe(true);
    expect(ctx.recurring.filter((s) => s.review && /DANSKE/i.test(s.merchant)).map((s) => s.id)).toEqual([]);
  });

  it("bank:danske-family: LÖN is salary and ÖVERFÖRING to the joint account a transfer", () => {
    const ctx = contextOf(named("bank:danske-family"));
    const pay = ctx.txs.filter((t) => t.description === "LÖN");
    expect(pay.length).toBeGreaterThan(10);
    expect(pay.every((t) => t.category === "salary")).toBe(true);
    const own = ctx.txs.filter((t) => t.description?.startsWith("ÖVERFÖRING"));
    expect(own.length).toBeGreaterThan(10);
    expect(own.every((t) => t.isTransfer)).toBe(true);
  });
});
