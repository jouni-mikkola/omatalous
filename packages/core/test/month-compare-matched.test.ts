/**
 * Yhteenveto's "last month, same day" figure is matched on monthly fixed costs: a payment the month before booked by
 * this day and this month has not booked yet (a rent or a loan instalment due today) is no difference between the two
 * months, so the comparison leaves it out. The month's own totals keep every row.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { unmatchedFixed } from "../src/analysis/matched-fixed.ts";
import { addMonths } from "../src/dates.ts";
import type { RecurringSeries } from "../src/recurring.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };

/** One row a month on `day` from 2025-09 up to the month before `lastMonth`, and `lastMonth` too when `through` is set. */
function monthly(day: number, cents: number, partial: Partial<Transaction>, lastMonth: string, through: boolean): Transaction[] {
  const months = Array.from({ length: 14 }, (_, i) => addMonths("2025-09", i)).filter((m) => (through ? m <= lastMonth : m < lastMonth));
  return months.map((m) => tx({ ...partial, bookingDate: `${m}-${String(day).padStart(2, "0")}`, amountCents: cents }));
}

/**
 * A household with a salary on the 1st, a rent on the 2nd, an insurance paid monthly on the 16th and two grocery
 * purchases, one in September and one in October. The insurance of October is booked only when `booked` is set.
 */
function household(booked: boolean): Transaction[] {
  return [
    ...monthly(1, 300_000, { category: "salary", merchant: "Acme Oy" }, "2026-10", true),
    ...monthly(2, -105_000, { category: "housing", merchant: "Sato Oyj" }, "2026-10", true),
    ...monthly(16, -35_000, { category: "insurance", merchant: "Esimerkkivakuutus" }, "2026-10", booked),
    tx({ bookingDate: "2026-09-05", amountCents: -10_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: "2026-10-05", amountCents: -12_000, merchant: "Prisma", category: "groceries" }),
  ];
}

const october = (today: IsoDate, rows: Transaction[]) => buildDashboard(createContext(rows, [checking], today), { from: "2026-10-01", to: today });

describe("the same-day comparison of a running month", () => {
  it("leaves out a monthly payment the month before booked by this day and this month has not booked yet", () => {
    const d = october("2026-10-16", household(false));
    // 1.–16.9.: the rent and the groceries; the insurance of the 16th is a payment this month has not booked yet
    expect(d.previousTotals.expenseCents).toBe(105_000 + 10_000);
    expect(d.previousTotals.incomeCents).toBe(300_000);
    expect(d.previousTotals.leftCents).toBe(300_000 - 105_000 - 10_000);
  });

  it("never changes the month's own totals", () => {
    const d = october("2026-10-16", household(false));
    expect(d.totals.expenseCents).toBe(105_000 + 12_000);
    expect(d.totals.leftCents).toBe(300_000 - 105_000 - 12_000);
    // the whole month before is shown whole, the insurance included
    expect(d.previousMonthTotals!.totals.expenseCents).toBe(105_000 + 35_000 + 10_000);
  });

  it("counts the payment on both sides once this month has booked it", () => {
    const d = october("2026-10-17", household(true));
    expect(d.previousTotals.expenseCents).toBe(105_000 + 35_000 + 10_000);
    expect(d.totals.expenseCents).toBe(105_000 + 35_000 + 12_000);
  });

  it("compares a period that is over as it is", () => {
    const rows = household(false);
    const ended = buildDashboard(createContext(rows, [checking], "2026-11-20"), { from: "2026-10-01", to: "2026-10-31" });
    expect(ended.running).toBe(false);
    expect(ended.previousTotals.expenseCents).toBe(105_000 + 35_000 + 10_000);
  });
});

describe("unmatchedFixed", () => {
  const rows = createContext(household(false), [checking], "2026-10-16").txs;
  const insurance = rows.filter((t) => t.merchant === "Esimerkkivakuutus");
  const sept = insurance.filter((t) => t.bookingDate.startsWith("2026-09"));
  const series = (partial: Partial<RecurringSeries>) => ({ cadence: "monthly", kind: "subscription", active: true, category: "insurance", merchant: "Esimerkkivakuutus", transactionIds: insurance.map((t) => t.id), ...partial }) as RecurringSeries;
  const octRows = rows.filter((t) => t.bookingDate >= "2026-10-01");
  const septRows = rows.filter((t) => t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-16");

  it("drops the previous side's payment that this side lacks", () => {
    const out = unmatchedFixed([series({})], new Set(), octRows, septRows);
    expect([...out.previous]).toEqual(sept.map((t) => t.id));
    expect(out.now.size).toBe(0);
  });

  it("drops this side's payment that the previous side lacks", () => {
    const out = unmatchedFixed([series({})], new Set(), septRows, octRows);
    expect([...out.now]).toEqual(sept.map((t) => t.id));
    expect(out.previous.size).toBe(0);
  });

  it("drops nothing when both sides have the payment, and nothing of a series that is no monthly fixed cost", () => {
    expect(unmatchedFixed([series({})], new Set(), septRows, septRows)).toEqual({ now: new Set(), previous: new Set() });
    expect(unmatchedFixed([series({ cadence: "weekly" as never })], new Set(), octRows, septRows).previous.size).toBe(0);
    expect(unmatchedFixed([series({ kind: "habit" })], new Set(), octRows, septRows).previous.size).toBe(0);
    expect(unmatchedFixed([series({ active: false })], new Set(), octRows, septRows).previous.size).toBe(0);
    expect(unmatchedFixed([series({})], new Set(["Esimerkkivakuutus"]), octRows, septRows).previous.size).toBe(0);
  });
});
