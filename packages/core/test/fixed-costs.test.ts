/**
 * Raportit > Kiinteät menot (1.0.0 had it, main deleted it, the owner asked it back as one table): what a month costs
 * before any choice. Its total is the fixed costs every other figure names (`fixedShareOn`, the dashboard), its rows are
 * the series running today, and under each row are the payments its yearly cost stands for.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { seriesMarkSubject } from "../src/analysis/subscription-alerts.ts";
import { fixedShareOn } from "../src/analysis/fixed-share.ts";
import { addMonths, addMonthsToDate } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import { fixedCostsReport } from "../src/reports/fixed-costs.ts";
import { FIXED_PAYMENT_MONTHS } from "../src/thresholds.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

/** One row a month from September 2025, on the day `day(i)` of the i-th month, up to today. */
function monthly(day: (i: number) => number, cents: number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: 14 }, (_, i) => tx({ ...partial, bookingDate: `${addMonths("2025-09", i)}-${String(day(i)).padStart(2, "0")}`, amountCents: cents })).filter((t) => t.bookingDate <= today);
}

/** Everyday shopping: three purchases a month of other sums on other days, no series. */
const shopping = () =>
  Array.from({ length: 14 }, (_, i) => [4 + (i % 3), 13 + (i % 5), 21 + (i % 4)].map((day, k) => tx({ bookingDate: `${addMonths("2025-09", i)}-${String(day).padStart(2, "0")}`, amountCents: -(9000 + ((i * 7 + k * 13) % 11) * 1700), category: "groceries", merchant: "K-Market" })))
    .flat()
    .filter((t) => t.bookingDate <= today);

const household = [
  ...monthly(() => 25, 300000, { category: "salary", merchant: "Acme Oy" }),
  ...monthly(() => 2, -105000, { category: "housing", merchant: "Sato Oyj" }),
  ...monthly(() => 14, -1799, { category: "subscriptions", merchant: "Netflix" }),
  ...monthly(() => 6, -1199, { category: "subscriptions", merchant: "Spotify" }),
  // a monthly saving leaves the account like a bill, but the money is kept
  ...monthly(() => 6, -15000, { category: "investments", merchant: "Nordnet Bank Ab" }),
  // a lender paid on a different day each month: no cadence, still a loan paid monthly
  ...monthly((i) => (i % 2 ? 2 : 27), -28900, { category: "loans", merchant: "Esimerkkirahoitus Oy" }),
  // a yearly insurance: the payment a year and a month ago is outside the year its cost stands for
  tx({ bookingDate: "2024-10-20", amountCents: -60000, category: "insurance", merchant: "Esimerkkivakuutus" }),
  tx({ bookingDate: "2025-10-20", amountCents: -60000, category: "insurance", merchant: "Esimerkkivakuutus" }),
  ...shopping(),
];
const ctx = createContext(household, [checking], today);

describe("Raportit: Kiinteät menot", () => {
  const plain = fixedCostsReport(ctx);
  const byName = (r: typeof plain, name: string) => r.rows.find((x) => x.merchant === name);

  it("lists the contracts, subscriptions and loan payments running today, largest first, and no saving or everyday shop", () => {
    expect(plain.rows.map((r) => r.merchant)).toEqual(["Sato Oyj", "Esimerkkirahoitus Oy", "Esimerkkivakuutus", "Netflix", "Spotify"]);
    expect(plain.rows.map((r) => r.monthlyCents)).toEqual([105000, 28900, 5000, 1799, 1199]);
    // the lender's run has no steady day, so recurring.ts calls it a habit and no bill; the fixed costs count it all the same
    expect(ctx.recurring.filter((s) => s.merchant === "Esimerkkirahoitus Oy").map((s) => s.kind)).toEqual(["habit"]);
  });

  it("adds up to the fixed costs every other figure names, and a year is twelve of its months", () => {
    const sum = plain.rows.reduce((s, r) => s + r.monthlyCents, 0);
    expect(plain.monthlyCents).toBe(sum);
    expect(plain.yearlyCents).toBe(sum * 12);
    for (const r of plain.rows) expect(r.yearlyCents).toBe(r.monthlyCents * 12);
    expect(plain.monthlyCents).toBe(fixedShareOn(ctx, today, NO_INPUTS).fixedMonthlyCents);
    expect(plain.monthlyCents).toBe(buildDashboard(ctx, { from: "2026-10-01", to: today }).fixedMonthlyCents);
  });

  it("the share is of the usual income, under the label of every page", () => {
    expect(plain.incomeMonthlyCents).toBe(300000);
    expect(plain.fixedShare).toBeCloseTo(plain.monthlyCents / 300000, 10);
    expect(plain.fixedShareLabel).toBe("Kiinteät menot tavallisista tuloista, viimeiset 6 kuukautta");
    expect(fixedCostsReport(ctx, NO_INPUTS, "en").fixedShareLabel).toBe("Fixed costs of expected income, last 6 months");
  });

  it("under a row are its own payments of the last twelve months, newest first, and their sum", () => {
    const since = addMonthsToDate(today, -FIXED_PAYMENT_MONTHS);
    const ids = new Map(household.map((t) => [t.id, t]));
    for (const r of plain.rows) {
      expect(r.payments.length, r.merchant).toBeGreaterThan(0);
      expect(r.paidCents).toBe(r.payments.reduce((s, p) => s + p.amountCents, 0));
      expect([...r.payments].sort((a, b) => b.date.localeCompare(a.date))).toEqual(r.payments);
      for (const p of r.payments) {
        const row = ids.get(p.id)!;
        expect(row.merchant).toBe(r.merchant);
        expect(p.amountCents).toBe(-row.amountCents);
        expect(p.date > since && p.date <= today, `${r.merchant} ${p.date}`).toBe(true);
      }
    }
    // the yearly bill shows once: the payment of 2024 is older than the year
    expect(byName(plain, "Esimerkkivakuutus")!.payments.map((p) => p.date)).toEqual(["2025-10-20"]);
    expect(byName(plain, "Sato Oyj")!.payments).toHaveLength(12);
    const lender = household.filter((t) => t.merchant === "Esimerkkirahoitus Oy" && t.bookingDate > since);
    expect(byName(plain, "Esimerkkirahoitus Oy")!.payments.map((p) => p.id).sort()).toEqual(lender.map((t) => t.id).sort());
  });

  it("a subscription the household marked as cancelled is out of the rows and the total, as it is out of every other figure", () => {
    const spotify = ctx.recurring.find((s) => s.merchant === "Spotify")!;
    const inputs: UserInputs = { ...NO_INPUTS, marks: [{ subject: seriesMarkSubject(spotify), mark: "cancelled", markedAt: "2026-10-01T10:00:00Z" }] };
    const marked = fixedCostsReport(ctx, inputs);
    expect(byName(marked, "Spotify")).toBeUndefined();
    expect(marked.monthlyCents).toBe(plain.monthlyCents - 1199);
    expect(marked.monthlyCents).toBe(fixedShareOn(ctx, today, inputs).fixedMonthlyCents);
  });

  it("is about today whatever period the page shows", () => {
    const of = (from: string, to: string) => buildReports({ ctx, range: { from, to }, balances: [] }, ["fixedCosts"]).fixedCosts;
    expect(of("2026-07-01", "2026-09-30")).toEqual(plain);
    expect(of("2025-10-01", "2026-09-30")).toEqual(plain);
  });

  it("a household with no series has no rows and no share", () => {
    const none = fixedCostsReport(createContext(shopping(), [checking], today));
    expect(none.rows).toEqual([]);
    expect(none.monthlyCents).toBe(0);
    expect(none.fixedShare).toBeNull();
  });
});
