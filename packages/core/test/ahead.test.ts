import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { addDays, weekdayOf } from "../src/dates.ts";
import { buildHoldings } from "../src/holdings.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const today = "2026-10-09";

/**
 * A household with no surprises: 30 € of groceries every day, rent on the 2nd, Spotify on the 11th, salary on the
 * 25th (the Friday before at a weekend), and one purchase on the 20th that cycles through 30, 50 and 70 euros. Rows from `from` to `to`.
 */
function steady(from: IsoDate, to: IsoDate): Transaction[] {
  const rows: Transaction[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const month = d.slice(0, 7);
    const day = Number(d.slice(8, 10));
    rows.push(tx({ bookingDate: d, amountCents: -3000, merchant: "Prisma", category: "groceries" }));
    if (day === 2) rows.push(tx({ bookingDate: d, amountCents: -95000, merchant: "Sato", category: "housing" }));
    if (day === 11) rows.push(tx({ bookingDate: d, amountCents: -1199, merchant: "Spotify", category: "subscriptions" }));
    // salary on the 25th, paid on the Friday before when the 25th is a weekend
    const weekday = weekdayOf(`${month}-25`);
    if (d === addDays(`${month}-25`, weekday >= 5 ? 4 - weekday : 0)) rows.push(tx({ bookingDate: d, amountCents: 300000, merchant: "Acme Oy", category: "salary" }));
    if (day === 20) {
      const n = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
      rows.push(tx({ bookingDate: d, amountCents: -[3000, 5000, 7000][n % 3]!, merchant: `Extra ${month}`, category: "other" }));
    }
  }
  return rows;
}
const upTo = (rows: Transaction[], day: IsoDate) => rows.filter((t) => t.bookingDate <= day);

describe("cash ahead", () => {
  const all = steady("2025-09-01", "2026-10-31");
  const ctx = createContext(upTo(all, today), [checking], today);
  const balance = (balanceCents: number | null, extra: Partial<BalanceInput> = {}): BalanceInput => ({
    id: "acc-1",
    name: "Käyttötili",
    type: "checking",
    balanceCents,
    ownerName: null,
    balanceAt: "2026-10-09T06:00:00Z",
    ...extra,
  });
  const inputs = (partial: Partial<UserInputs>): UserInputs => ({ ...NO_INPUTS, ...partial });
  const bill = (partial: Partial<ExpectedBill>): ExpectedBill => ({ id: "b1", name: "Autovakuutus", amountCents: 41_000, dueDate: "2026-10-20", cadence: "once", category: "insurance", ...partial });
  const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

  // the same household without its pay: no payday sets the window, so it is the 30 days (ahead-payday.test.ts has the window)
  const unpaid = createContext(upTo(all.filter((t) => t.merchant !== "Acme Oy"), today), [checking], today);

  it("the last day's balance is the start plus the rows minus the everyday spending", () => {
    const d = cashAhead(unpaid, [balance(200_000)], NO_INPUTS);
    const b = d.balance!;
    expect([d.from, d.to]).toEqual(["2026-10-09", "2026-11-08"]);
    expect(b.days).toHaveLength(31);
    // nothing is booked on the day itself and its everyday spending is already in the balance
    expect(b.days[0]).toEqual({ date: today, cents: 200_000 });
    expect(b.days[30]!.cents).toBe(200_000 + sum(d.rows) - d.totals.everydayCents);
    // 30 euros a day plus a purchase of 30 to 70 euros a month
    expect(d.everydayPerDayCents).toBeGreaterThanOrEqual(3000);
    expect(d.everydayPerDayCents).toBeLessThan(3300);
    expect(d.rows.map((r) => [r.date, r.name, r.cents])).toEqual([
      ["2026-10-11", "Spotify", -1199],
      ["2026-11-02", "Sato", -95_000],
    ]);
  });

  it("a salary lands on its usual day, the Friday before at a weekend, and the lowest point is the day before it", () => {
    const d = cashAhead(ctx, [balance(200_000)], NO_INPUTS);
    // the 25th of October 2026 is a Sunday
    expect(d.payday).toEqual({ date: "2026-10-23", name: "Acme Oy", cents: 300_000 });
    const days = d.balance!.days;
    expect(d.to).toBe("2026-10-22");
    expect(d.balance!.lowest.date).toBe("2026-10-22");
    expect(d.balance!.lowest.cents).toBe(Math.min(...days.map((x) => x.cents)));
  });

  it("a salary follows the usual day of the month, not the day of the last one", () => {
    // paid on Friday 24.7. because the 25th was a Saturday; the next one is on Tuesday 25.8., not on the 24th
    const day = "2026-08-11";
    const early = createContext(upTo(all, day), [checking], day);
    expect(cashAhead(early, [], NO_INPUTS).payday).toMatchObject({ date: "2026-08-25" });
    // 25.9. is a Friday, 25.11. a Wednesday; the 25th of a month with no weekend problem stays
    const later = createContext(upTo(all, "2026-09-11"), [checking], "2026-09-11");
    expect(cashAhead(later, [], NO_INPUTS).payday).toMatchObject({ date: "2026-09-25" });
  });

  it("a cancelled subscription is not expected", () => {
    const cancelled = inputs({ marks: [{ subject: "merchant:Spotify", mark: "cancelled", markedAt: "2026-10-08T10:00:00Z" }] });
    const d = cashAhead(unpaid, [balance(200_000)], cancelled);
    expect(d.rows.map((r) => r.name)).toEqual(["Sato"]);
    expect(d.balance!.days[30]!.cents).toBe(cashAhead(unpaid, [balance(200_000)], NO_INPUTS).balance!.days[30]!.cents + 1199);
    // an in-use mark changes nothing
    expect(cashAhead(unpaid, [balance(200_000)], inputs({ marks: [{ subject: "merchant:Spotify", mark: "in_use", markedAt: "2026-10-08T10:00:00Z" }] })).rows).toHaveLength(2);
  });

  it("an expected bill shows on its date, a yearly one comes back, and one the history already knows is not counted twice", () => {
    const typed = inputs({
      expectedBills: [
        bill({}),
        bill({ id: "b2", name: "Auton vero", amountCents: 9500, dueDate: "2024-11-03", cadence: "yearly", category: "taxes" }),
        bill({ id: "b3", name: "Joulu", amountCents: 5000, dueDate: "2026-12-24" }),
        bill({ id: "b4", name: "SPOTIFY", amountCents: 1199, dueDate: "2026-10-11", cadence: "quarterly", category: "subscriptions" }),
      ],
    });
    const d = cashAhead(unpaid, [balance(200_000)], typed);
    expect(d.rows.filter((r) => r.source === "expected").map((r) => [r.date, r.name, r.cents, r.category])).toEqual([
      ["2026-10-20", "Autovakuutus", -41_000, "insurance"],
      ["2026-11-03", "Auton vero", -9500, "taxes"],
    ]);
    const plain = cashAhead(unpaid, [balance(200_000)], NO_INPUTS);
    expect(d.balance!.days[30]!.cents).toBe(plain.balance!.days[30]!.cents - 41_000 - 9500);
  });

  it("a typed-in bill that was already paid is not listed or subtracted again", () => {
    const typed = inputs({ expectedBills: [bill({ amountCents: 64_000 })] });
    const paid = (cents: number, day: IsoDate) => createContext([...upTo(all.filter((t) => t.merchant !== "Acme Oy"), today), tx({ bookingDate: day, amountCents: -cents, merchant: "Pohjola Vakuutus", category: "insurance" })], [checking], today);
    const names = (c: ReturnType<typeof createContext>) => cashAhead(c, [balance(200_000)], typed).rows.map((r) => r.name);
    expect(names(unpaid)).toContain("Autovakuutus");
    // paid on the 9th, within 5 % of the amount: the 20th is the same bill
    expect(names(paid(64_000, "2026-10-09"))).not.toContain("Autovakuutus");
    expect(names(paid(61_000, "2026-10-09"))).not.toContain("Autovakuutus");
    // another amount, or a payment more than a month before the date, is something else
    expect(names(paid(50_000, "2026-10-09"))).toContain("Autovakuutus");
    expect(names(paid(64_000, "2026-09-10"))).toContain("Autovakuutus");
    const d = cashAhead(paid(64_000, "2026-10-09"), [balance(200_000)], typed);
    expect(d.balance!.days[30]!.cents).toBe(cashAhead(unpaid, [balance(200_000)], NO_INPUTS).balance!.days[30]!.cents);
  });

  it("a standing transfer to an own account is no series, so it is not in the line (NextDays says so)", () => {
    const savings: Account = { id: "sav", name: "Säästötili", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "savings" };
    const moves = ["2026-07-26", "2026-08-26", "2026-09-26"].flatMap((bookingDate) => [
      tx({ bookingDate, amountCents: -30_000, merchant: "Säästö", category: "transfer", isTransfer: true }),
      tx({ accountId: "sav", bookingDate, amountCents: 30_000, merchant: "Säästö", category: "transfer", isTransfer: true }),
    ]);
    const withMoves = createContext([...upTo(all, today), ...moves], [checking, savings], today);
    expect(withMoves.recurring.some((r) => r.merchant === "Säästö")).toBe(false);
    expect(cashAhead(withMoves, [balance(200_000)], NO_INPUTS).rows.map((r) => r.name)).not.toContain("Säästö");
  });

  it("without a checking balance there is the list and no balance line", () => {
    for (const balances of [[], [balance(null)], [balance(80_000, { type: "savings" }), balance(-20_000, { type: "credit_card" })]]) {
      const d = cashAhead(unpaid, balances, NO_INPUTS);
      expect(d).toMatchObject({ balance: null, missing: "balance" });
      expect(d.rows).toHaveLength(2);
    }
  });

  it("checking balances of the household add up, shared ones too", () => {
    const d = cashAhead(ctx, [balance(100_000), balance(50_000, { id: "acc-2", ownerName: "Maija", balanceAt: "2026-10-08T06:00:00Z" }), balance(900_000, { id: "sav", type: "savings" })], NO_INPUTS);
    expect(d.balance).toMatchObject({ startCents: 150_000, accounts: 2, balanceAt: "2026-10-08T06:00:00Z" });
  });

  it("starts from today's balance as the first page has it: the rows booked since the bank gave it are in", () => {
    // 3 000 euros given on 2.10., seven purchases of 30 euros on 3.-9.10.
    const given = balance(300_000, { balanceAt: "2026-10-02T06:00:00Z" });
    const d = cashAhead(ctx, [given], NO_INPUTS);
    expect(d.balance!.startCents).toBe(279_000);
    expect(d.balance!.days[0]).toEqual({ date: today, cents: 279_000 });
    expect(d.balance!.balanceAt).toBe("2026-10-02T06:00:00Z");
    expect(buildHoldings(ctx, [given], NO_INPUTS).accounts[0]!.balanceCents).toBe(d.balance!.startCents);
  });

  it("a history without a complete month has no everyday level, so no balance line", () => {
    const first = createContext(upTo(steady("2026-10-01", "2026-10-31"), today), [checking], today);
    expect(cashAhead(first, [balance(200_000)], NO_INPUTS)).toMatchObject({ balance: null, missing: "history", everydayPerDayCents: 0 });
  });

  it("the dashboard has it for a period that reaches today and not for a past one", () => {
    expect(buildDashboard(ctx, { from: "2026-10-01", to: today }, [balance(200_000)], NO_INPUTS).ahead!.balance!.startCents).toBe(200_000);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }).ahead).not.toBeNull();
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }).ahead).toBeNull();
  });
});
