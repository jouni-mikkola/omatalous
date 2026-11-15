import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { expectedBillRows } from "../src/analysis/forecast.ts";
import { addDays } from "../src/dates.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-20";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const bal: BalanceInput = { id: own.id, name: own.name, type: own.type, balanceCents: 200_000, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` };

/** 20 euros of groceries a day from June: rows enough for a context, and none of them a bill. */
const groceries = (): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = "2026-06-01"; d <= TODAY; d = addDays(d, 1)) rows.push(tx({ accountId: "own", bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" }));
  return rows;
};
const bill = (extra: Partial<ExpectedBill> = {}): ExpectedBill => ({ id: "b1", name: "Sähkö Oy", amountCents: 8000, dueDate: "2026-11-01", cadence: "once", category: "utilities", ...extra });
const row = (bookingDate: IsoDate, merchant: string, amountCents: number, extra: Partial<Transaction> = {}) =>
  tx({ accountId: "own", bookingDate, amountCents, merchant, category: "other", ...extra });

/** The dates the bill is still due in both readers: the typed rows of the window and its own answer. */
function due(rows: Transaction[], b: ExpectedBill): IsoDate[] {
  const ctx = createContext([...groceries(), ...rows], [own], TODAY);
  const dates = expectedBillRows(ctx, [b], TODAY, "2026-11-30").map((r) => r.date);
  const window = cashAhead(ctx, [bal], { ...NO_INPUTS, expectedBills: [b] }).rows.filter((r) => r.source === "expected").map((r) => r.date);
  // the bill falls inside the window, so the window lists exactly the dates still due
  expect(window).toEqual(dates);
  return dates;
}

describe("a typed-in bill is paid only when its payment is found", () => {
  it("a grocery row of about the bill's size pays nothing", () => {
    expect(due([row("2026-10-15", "Lähikauppa", -7950, { category: "groceries" })], bill())).toEqual(["2026-11-01"]);
  });

  it("the payee's row pays it, under the bill's name or its first words", () => {
    expect(due([row("2026-10-15", "Sähkö Oy", -8000)], bill())).toEqual([]);
    expect(due([row("2026-10-15", "Sähkö Oy", -8000)], bill({ name: "Sähkö" }))).toEqual([]);
    // two letters name no payee
    expect(due([row("2026-10-15", "Oy Sähkö", -8000)], bill({ name: "Oy" }))).toEqual(["2026-11-01"]);
  });

  it("the payment of the date before pays only that date", () => {
    const quarterly = bill({ dueDate: "2026-08-01", cadence: "quarterly" });
    // August's bill paid late on 10.9.: nearer 1.8. than 1.11.
    expect(due([row("2026-09-10", "Sähkö Oy", -8000)], quarterly)).toEqual(["2026-11-01"]);
    // paid 1.10., 31 days early: that is November's
    expect(due([row("2026-10-01", "Sähkö Oy", -8000)], quarterly)).toEqual([]);
  });

  it("a row with the bill's reference pays it under another name; another reference does not", () => {
    const withRef = bill({ name: "Sähkölasku", reference: "RF18 0000 1234 5" });
    expect(due([row("2026-10-15", "Helen Oy", -8000, { reference: "12345" })], withRef)).toEqual([]);
    expect(due([row("2026-10-15", "Helen Oy", -8000, { reference: "12346" })], withRef)).toEqual(["2026-11-01"]);
    expect(due([row("2026-10-15", "Helen Oy", -8000)], withRef)).toEqual(["2026-11-01"]);
  });

  it("a row with the payee's IBAN pays it under another name", () => {
    const withIban = bill({ name: "Sähkölasku", payeeIban: "FI49 5000 9420 0287 30" });
    expect(due([row("2026-10-15", "Helen Oy", -8000, { counterpartyIban: "FI4950009420028730" })], withIban)).toEqual([]);
    expect(due([row("2026-10-15", "Helen Oy", -8000, { counterpartyIban: "FI21 1234 5600 0007 85" })], withIban)).toEqual(["2026-11-01"]);
  });

  it("one row pays one bill: a purchase of 100 pays neither of two bills of 100, and one payment to a payee pays one of its two bills", () => {
    const ctx = (rows: Transaction[]) => createContext([...groceries(), ...rows], [own], TODAY);
    const two = [bill({ id: "b1", name: "Hammaslääkäri", amountCents: 10_000, dueDate: "2026-10-25" }), bill({ id: "b2", name: "Autokorjaamo", amountCents: 10_000, dueDate: "2026-11-05" })];
    const names = (rows: Transaction[], bills: ExpectedBill[]) => expectedBillRows(ctx(rows), bills, TODAY, "2026-11-20").map((r) => r.name);
    expect(names([row("2026-10-10", "K-Citymarket", -10_000, { category: "groceries" })], two)).toEqual(["Hammaslääkäri", "Autokorjaamo"]);
    const dentist = [bill({ id: "b1", name: "Hammaslääkäri", amountCents: 10_000, dueDate: "2026-10-25" }), bill({ id: "b2", name: "Hammaslääkäri", amountCents: 6000, dueDate: "2026-11-05" })];
    expect(expectedBillRows(ctx([row("2026-10-10", "Hammaslääkäri", -10_000)]), dentist, TODAY, "2026-11-20").map((r) => r.date)).toEqual(["2026-11-05"]);
  });
});
