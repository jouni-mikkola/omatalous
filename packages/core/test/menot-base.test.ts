/**
 * The Menot of the first page are one figure on one base: the spending of the flows (consumption and debt), which Tulos
 * adds up. A debt paid from a savings account is spending in the categories and Säästöön in Tulos, so no figure under
 * Menot may hold it: the tile, the month's bars, the usual line, the pace and its usual, the spending goal, the
 * explanation of the tile. The same household is built twice, with and without a loan paid from savings each month, and
 * every figure of those parts of the dashboard must come out the same. A field added later that reads `spend` of a row
 * instead of its flows differs between the two and fails here. What may differ is declared in `menotOf`.
 * Made-up household only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildReports } from "../src/reports/index.ts";
import { type Account, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const today: IsoDate = "2026-10-12";
const range = { from: "2026-10-01", to: today };
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const INTEREST = 6_000;
const INSTALMENT = 40_000;

/** Seven months of a salary, two grocery trips and a saving each, and with `loan` the interest and the instalment paid from the savings account. */
function household(loan: boolean): Transaction[] {
  return MONTHS.flatMap((month, i) => [
    tx({ bookingDate: `${month}-05`, amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
    tx({ bookingDate: `${month}-02`, amountCents: -(18_000 + i * 1_500), merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${month}-10`, amountCents: -(9_000 + (i % 3) * 2_000), merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${month}-06`, amountCents: -50_000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
    tx({ bookingDate: `${month}-06`, amountCents: 50_000, accountId: "acc-2", merchant: "Oma siirto", category: "transfer", isTransfer: true }),
    ...(loan
      ? [
          tx({ bookingDate: `${month}-08`, amountCents: -INTEREST, accountId: "acc-2", merchant: "Esimerkkipankki Oyj", category: "interest" }),
          tx({ bookingDate: `${month}-09`, amountCents: -INSTALMENT, accountId: "acc-2", merchant: "Esimerkkipankki Oyj", category: "mortgage" }),
        ]
      : []),
  ]);
}

const inputs = { ...NO_INPUTS };
const dashboardOf = (loan: boolean) => buildDashboard(createContext(household(loan), [checking, savings], today), range, [], inputs);

/**
 * The parts of the dashboard that show Menot, with what may hold the loan declared: the categories of the month list it
 * (the first page names it beside them), and a month's `fromSavingsCents` is the difference itself.
 */
function menotOf(d: ReturnType<typeof dashboardOf>) {
  // every other field of the overview, one added later too, is compared
  const { categories, months, ...rest } = d.overview;
  return {
    overview: { ...rest, months: months.map((m) => ({ ...m, fromSavingsCents: 0 })), categories: { ...categories, rows: [], otherCents: 0, fromSavingsCents: 0 } },
    pace: d.pace,
    nytPace: d.nyt?.pace,
    homePace: d.home.pace,
    homePaceGap: d.home.paceGap,
  };
}

describe("the Menot of the first page, with a loan paid from savings every month", () => {
  const withLoan = dashboardOf(true);
  const without = dashboardOf(false);

  it("is a household where the loan is spending and Menot have figures to compare", () => {
    expect(withLoan.overview.months.at(-1)!.fromSavingsCents).toBe(INTEREST + INSTALMENT);
    expect(without.overview.months.at(-1)!.fromSavingsCents).toBe(0);
    expect(withLoan.overview.categories.fromSavingsCents).toBe(INTEREST + INSTALMENT);
    const m = menotOf(withLoan);
    expect(m.overview.usualSpendCents).not.toBeNull();
    expect(m.pace.expected).not.toBeNull();
    expect(m.pace.projection).not.toBeNull();
    expect(m.pace.previous).not.toBeNull();
    expect(m.nytPace?.usual).not.toBeNull();
    expect(m.homePace).not.toBeNull();
  });

  it("holds the loan in no figure under Menot: the tile, bars, usual line, pace, its usual", () => {
    expect(menotOf(withLoan)).toEqual(menotOf(without));
  });

  it("leaves the loan in the categories of Raportit, so the two households do differ there", () => {
    // the usual month is read from complete months, so the window is the whole history
    const window = { from: `${MONTHS[0]}-01`, to: today };
    const reportOf = (loan: boolean) => buildReports({ ctx: createContext(household(loan), [checking, savings], today), range: window, balances: [] }, ["spendingMonths"]).spendingMonths;
    const [held, left] = [reportOf(true), reportOf(false)];
    expect(held.totalCents).toBeGreaterThan(left.totalCents);
    expect(left.typicalFlowCents).not.toBeNull();
    expect(held.typicalCents!).toBeGreaterThan(left.typicalCents!);
    expect(held.typicalFlowCents).toBe(left.typicalFlowCents);
  });
});
