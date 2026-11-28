/**
 * A month's gap to its usual level, `againstUsual` of analysis/usual.ts: the one definition the readouts of the month
 * charts word ("menot 120 € yli tavallisen"). It is read on the base of the level: Menot of the flows, so a month that
 * paid debt from a savings account is not over the usual by that debt. Made-up household only.
 */
import { describe, expect, it } from "vitest";
import { againstUsual } from "../src/analysis/usual.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildOverview } from "../src/overview.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const today: IsoDate = "2026-10-12";
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const INSTALMENT = 40_000;
const BONUS = 60_000;
/** A small extra grocery bill in the dear month, too small to be a large purchase. */
const EXTRA = 5_000;
/** The month that paid its loan from the savings account, and the month with a larger grocery bill and a bonus. */
const LOAN_MONTH = "2026-09";
const DEAR_MONTH = "2026-07";

/** Seven months of the same salary and groceries and a saving each; the loan month pays an instalment from savings. */
function household(): Transaction[] {
  return MONTHS.flatMap((month) => [
    tx({ bookingDate: `${month}-05`, amountCents: 300_000 + (month === DEAR_MONTH ? BONUS : 0), merchant: "Acme Oy", category: "salary" }),
    tx({ bookingDate: `${month}-02`, amountCents: -(20_000 + (month === DEAR_MONTH ? EXTRA : 0)), merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${month}-10`, amountCents: -10_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${month}-06`, amountCents: -50_000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
    tx({ bookingDate: `${month}-06`, amountCents: 50_000, accountId: "acc-2", merchant: "Oma siirto", category: "transfer", isTransfer: true }),
    ...(month === LOAN_MONTH ? [tx({ bookingDate: `${month}-09`, amountCents: -INSTALMENT, accountId: "acc-2", merchant: "Esimerkkipankki Oyj", category: "mortgage" })] : []),
  ]);
}

const ctx = () => createContext(household(), [checking, savings], today);
const window = { from: `${MONTHS[0]}-01`, to: today };
const at = (months: readonly string[], month: string) => months.indexOf(month);

describe("againstUsual", () => {
  it("gives the gap and its side, and nothing when they are the same to the euro or a figure is missing", () => {
    expect(againstUsual(292_000, 723_000)).toEqual({ cents: 431_000, side: "less" });
    expect(againstUsual(800_000, 723_000)).toEqual({ cents: 77_000, side: "more" });
    expect(againstUsual(723_040, 723_000)).toBeNull();
    expect(againstUsual(null, 723_000)).toBeNull();
    expect(againstUsual(723_000, null)).toBeNull();
  });
});

describe("a month's gap to the usual month in Menot kuukausittain", () => {
  const report = buildReports({ ctx: ctx(), range: window, balances: [] }, ["spendingMonths"]).spendingMonths;
  const loan = at(report.months, LOAN_MONTH);
  const dear = at(report.months, DEAR_MONTH);

  it("is a household where the loan month's total is above the usual while its Menot are not", () => {
    expect(report.fromSavings[loan]).toBe(INSTALMENT);
    expect(report.typicalFlowCents).not.toBeNull();
    expect(report.totals[loan]! - report.typicalFlowCents!).toBeGreaterThan(INSTALMENT / 2);
    expect(report.totals[loan]! - report.fromSavings[loan]!).toBeLessThan(report.typicalFlowCents!);
  });

  it("does not read a month that paid debt from savings as over the usual by that debt", () => {
    // its Menot are those of any month: a little under the usual, which the dear month lifts, and nowhere near the instalment
    const flow = report.totals[loan]! - report.fromSavings[loan]!;
    expect(report.againstUsual[loan]).toEqual({ cents: report.typicalFlowCents! - flow, side: "less" });
    expect(report.againstUsual[loan]!.cents).toBeLessThan(INSTALMENT);
  });

  it("reads a month on the base of the level: Menot of the flows against `typicalFlowCents`", () => {
    const flow = report.totals[dear]! - report.fromSavings[dear]!;
    expect(report.againstUsual[dear]).toEqual({ cents: flow - report.typicalFlowCents!, side: "more" });
  });

  it("says nothing of the running month or a month that is not complete", () => {
    const running = at(report.months, "2026-10");
    expect(report.complete[running]).toBe(false);
    expect(report.againstUsual[running]).toBeNull();
  });
});

describe("a month's gap to the usual month on the first page's bars", () => {
  const overview = buildOverview(ctx());
  const month = (label: string) => overview.months.find((m) => m.month === label)!;

  it("does not read the month that paid debt from savings as over the usual", () => {
    expect(month(LOAN_MONTH).fromSavingsCents).toBe(INSTALMENT);
    expect(month(LOAN_MONTH).againstUsual).toEqual({ cents: overview.usualSpendCents! - month(LOAN_MONTH).spendCents!, side: "less" });
  });

  it("gives the gap of the bars' own sum to the usual line, and none for the running month", () => {
    const dear = month(DEAR_MONTH);
    expect(overview.usualSpendCents).not.toBeNull();
    expect(dear.againstUsual).toEqual({ cents: dear.spendCents! - overview.usualSpendCents!, side: "more" });
    expect(month("2026-10").againstUsual).toBeNull();
  });
});
