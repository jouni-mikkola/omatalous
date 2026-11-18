/**
 * The figure registry (`figures.ts`, ADR 0020): every figure in it gives the same value in each answer that carries it,
 * for the demo household and the seeded ones on a fixed day. A figure with one answer is compared with the report
 * that recomputes it. A new figure fails here until its answers are listed.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, type Household, seededHousehold } from "../../../tools/findings/households.ts";
import { aheadBasis, cashAhead } from "../src/analysis/ahead.ts";
import { savingsRateOf } from "../src/analysis/bridge.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { fixedShareOn } from "../src/analysis/fixed-share.ts";
import { spendTotals } from "../src/analysis/context.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { paydayOf, runwayOf } from "../src/analysis/runway.ts";
import { expectedEverydayPerDay, expectedIncome, expectedSpending } from "../src/analysis/expected.ts";
import { completeMonthsBefore, earnedIncome } from "../src/analysis/usual.ts";
import { type CostKind, costKindOf } from "../src/cost-kinds.ts";
import { addMonths, daysBetween, monthEnd, monthOf } from "../src/dates.ts";
import { FIGURES } from "../src/figures.ts";
import { lowPoint } from "../src/low-point.ts";
import { MIN_COMPARE_MONTHS, USUAL_MONTHS } from "../src/thresholds.ts";
import { median } from "../src/stats.ts";
import type { Loan } from "../src/types.ts";
import { buildHoldings } from "../src/holdings.ts";
import { balanceReport } from "../src/reports/balances.ts";
import { billCalendar } from "../src/reports/bill-calendar.ts";
import { bufferReport } from "../src/reports/buffer.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { fixedCostsReport } from "../src/reports/fixed-costs.ts";
import { incomeReport, regularIncomeMonths } from "../src/reports/income.ts";
import { upcomingReport } from "../src/reports/upcoming.ts";

type FigureKey = keyof typeof FIGURES;

/** What each answer says of one figure for one household: the values, which must all be the same. */
type Answers = (h: Household) => Record<string, number | null>;

const monthOfRange = (h: Household) => addMonths(monthOf(h.today), -1);
const lastMonth = (h: Household) => ({ from: `${monthOfRange(h)}-01`, to: monthEnd(monthOfRange(h)) });
/** A range that reaches today, as the first page reads when it is running. */
const running = (h: Household) => ({ from: `${monthOf(h.today)}-01`, to: monthEnd(monthOf(h.today)) });

/** A mortgage typed in by hand, with a payment and a balance of the month before the household's day. */
const typedLoan = (h: Household): Loan => ({
  id: "typed-mortgage", name: "Asuntolaina", lender: "ESIMERKKIPANKKI", kind: "mortgage", grantedCents: null, balanceCents: 14_823_055, balanceDate: `${monthOfRange(h)}-15`,
  rateBp: 310, reference: "euribor_12", marginBp: 65, repayment: "annuity", intervalMonths: 1, paymentCents: 91_240, endDate: null, limitCents: null, seriesKey: null,
});

/** The bills of a kind in the running month of Laskut: core's sum of the kind against the month's own rows added up by the kind of each. */
const billsOfKind = (field: "essentialCents" | "debtCents" | "contractCents" | "optionalCents", kind: CostKind) => (h: Household) => {
  const month = billCalendar(contextOf(h), h.inputs, h.balances).months[0]!;
  const rows = month.rows.filter((r) => (r.kind === "bill" || r.kind === "loan") && r.state !== "paid" && !r.onCard && costKindOf(r.category, r.kind === "loan") === kind);
  return { calendar: month[field], rows: rows.reduce((sum, r) => sum + r.cents, 0) };
};

const ANSWERS: Record<FigureKey, Answers> = {
  essentialBills: billsOfKind("essentialCents", "essential"),
  debtBills: billsOfKind("debtCents", "debt"),
  contractBills: billsOfKind("contractCents", "contract"),
  optionalBills: billsOfKind("optionalCents", "optional"),
  spending: (h) => {
    const ctx = contextOf(h);
    const range = lastMonth(h);
    return {
      dashboard: buildDashboard(ctx, range, h.balances, h.inputs).totals.expenseCents,
      cashflow: cashflowReport(ctx, range).totals.expenseCents,
      spendTotals: spendTotals(ctx, toDayRange(range)).expenseCents,
    };
  },
  consumption: (h) => {
    const ctx = contextOf(h);
    const range = lastMonth(h);
    return { dashboard: buildDashboard(ctx, range, h.balances, h.inputs).totals.consumptionCents, cashflow: cashflowReport(ctx, range).totals.consumptionCents };
  },
  left: (h) => {
    const ctx = contextOf(h);
    const range = lastMonth(h);
    return {
      dashboard: buildDashboard(ctx, range, h.balances, h.inputs).totals.leftCents,
      cashflow: cashflowReport(ctx, range).totals.leftCents,
    };
  },
  saved: (h) => {
    const ctx = contextOf(h);
    const range = lastMonth(h);
    return {
      dashboard: buildDashboard(ctx, range, h.balances, h.inputs).totals.savedCents,
      cashflow: cashflowReport(ctx, range).totals.savedCents,
    };
  },
  savingsRate: (h) => {
    const ctx = contextOf(h);
    const month = monthOfRange(h);
    const dash = buildDashboard(ctx, lastMonth(h), h.balances, h.inputs);
    const row = cashflowReport(ctx, lastMonth(h)).rows.find((r) => r.month === month);
    return { bridge: dash.bridge.month === month ? dash.bridge.totals.savingsRate : savingsRateOf(ctx, [month]).rate, cashflow: row?.savingsRate ?? null, helper: savingsRateOf(ctx, [month]).rate };
  },
  due: (h) => {
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, running(h), h.balances, h.inputs).ahead;
    const basis = aheadBasis(ctx, h.balances, h.inputs).ahead;
    return { dashboard: dash?.totals.dueCents ?? null, ahead: basis.totals.dueCents, cashAhead: cashAhead(ctx, h.balances, h.inputs).totals.dueCents };
  },
  ownTransfers: (h) => {
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, running(h), h.balances, h.inputs).ahead;
    const basis = aheadBasis(ctx, h.balances, h.inputs).ahead;
    return { dashboard: dash?.totals.transferCents ?? null, ahead: basis.totals.transferCents, cashAhead: cashAhead(ctx, h.balances, h.inputs).totals.transferCents };
  },
  free: (h) => {
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, running(h), h.balances, h.inputs).ahead;
    const basis = aheadBasis(ctx, h.balances, h.inputs).ahead;
    // free is the balance less the payments, the own transfers and the cards' debt no bill holds: the figures of the window add up to it
    const left = basis.balance ? basis.balance.startCents - basis.totals.dueCents - basis.totals.transferCents - basis.balance.cardDebtCents : null;
    return { dashboard: dash?.balance?.freeCents ?? null, ahead: basis.balance?.freeCents ?? null, parts: left };
  },
  runway: (h) => {
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, running(h), h.balances, h.inputs).home.runway?.leftOnPayday;
    const basis = aheadBasis(ctx, h.balances, h.inputs);
    const direct = runwayOf(ctx, basis);
    return {
      dashboard: dash?.known ? dash.leftCents : null,
      runway: direct.known ? direct.leftCents : null,
      // Käytettävissä less what the accounts pay themselves and what the coming bills of cards hold
      parts: direct.known ? direct.freeCents - direct.everydayCents - direct.billedCents : null,
      // the range holds the figure
      range: direct.known && direct.lowCents <= direct.leftCents && direct.leftCents <= direct.highCents ? direct.leftCents : null,
    };
  },
  lowPoint: (h) => {
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, running(h), h.balances, h.inputs).home.lowPoint;
    const direct = lowPoint(ctx, aheadBasis(ctx, h.balances, h.inputs), h.balances, h.inputs);
    return {
      dashboard: dash?.known ? dash.cents : null,
      lowPoint: direct.known ? direct.cents : null,
      // the range holds the figure
      range: direct.known && direct.lowCents <= direct.cents && direct.cents <= direct.highCents ? direct.cents : null,
    };
  },
  everyday: (h) => {
    const ctx = contextOf(h);
    const ahead = buildDashboard(ctx, running(h), h.balances, h.inputs).ahead;
    return { dashboard: ahead?.everydayPerDayCents ?? null, expected: expectedEverydayPerDay(ctx, monthOf(h.today)), cashAhead: cashAhead(ctx, h.balances, h.inputs).everydayPerDayCents };
  },
  allowance: (h) => {
    const ctx = contextOf(h);
    const basis = aheadBasis(ctx, h.balances, h.inputs);
    const payday = paydayOf(basis.ahead);
    const free = basis.ahead.balance?.freeCents ?? 0;
    // the free sum over the days to the payday, today included
    const days = payday ? daysBetween(basis.ahead.from, payday.date) : 0;
    return { dashboard: buildDashboard(ctx, running(h), h.balances, h.inputs).home.runway?.allowancePerDayCents ?? null, byHand: days > 0 && free > 0 ? Math.round(free / days) : null };
  },
  paceGap: (h) => {
    const ctx = contextOf(h);
    const dash = buildDashboard(ctx, running(h), h.balances, h.inputs);
    return {
      home: dash.home.pace?.expectedCents === undefined ? null : dash.home.pace.diffCents,
      pace: dash.pace.expected?.diffCents ?? null,
    };
  },
  fixed: (h) => {
    const ctx = contextOf(h);
    return {
      share: fixedShareOn(ctx, h.today, h.inputs).fixedMonthlyCents,
      report: fixedCostsReport(ctx, h.inputs).monthlyCents,
      buffer: bufferReport(ctx, h.balances, h.inputs).fixedMonthlyCents,
    };
  },
  usualSpend: (h) => {
    const ctx = contextOf(h);
    const month = monthOf(h.today);
    return {
      home: buildDashboard(ctx, running(h), h.balances, h.inputs).home.direction.usualCents,
      usual: expectedSpending(ctx, month),
      buffer: bufferReport(ctx, h.balances, h.inputs).expectedSpendCents,
    };
  },
  expected: (h) => {
    const ctx = contextOf(h);
    const month = monthOfRange(h);
    return { usual: expectedSpending(ctx, month), buffer: month === monthOf(h.today) ? bufferReport(ctx, h.balances, h.inputs).expectedSpendCents : expectedSpending(ctx, month) };
  },
  income: (h) => {
    const ctx = contextOf(h);
    // the running month: the first page's Tulot tile reads it
    const range = running(h);
    const dashboard = buildDashboard(ctx, range, h.balances, h.inputs);
    return {
      dashboard: dashboard.totals.incomeCents,
      tile: dashboard.overview.income.cents,
      bar: dashboard.overview.months.at(-1)?.incomeCents ?? null,
      report: incomeReport(ctx, range, h.balances).months.find((m) => m.month === monthOf(h.today))?.totalCents ?? null,
      cashflow: cashflowReport(ctx, range).totals.incomeCents,
    };
  },
  earnedIncome: (h) => {
    const ctx = contextOf(h);
    const month = monthOf(h.today);
    const range = running(h);
    return {
      tile: buildDashboard(ctx, range, h.balances, h.inputs).overview.income.earnedCents,
      report: incomeReport(ctx, range, h.balances).months.find((m) => m.month === month)?.earnedCents ?? null,
      helper: earnedIncome(ctx, month),
    };
  },
  usualIncome: (h) => {
    const ctx = contextOf(h);
    const month = monthOf(h.today);
    return {
      usual: expectedIncome(ctx, month),
      buffer: bufferReport(ctx, h.balances, h.inputs).incomeMonthlyCents,
      report: incomeReport(ctx, running(h), h.balances).months.find((m) => m.month === month)?.usualCents ?? null,
    };
  },
  regularIncome: (h) => {
    const ctx = contextOf(h);
    const range = running(h);
    // recomputed from the months it is the median of: none under the compare floor, none at or below zero
    const cents = regularIncomeMonths(ctx, range).map((m) => m.cents);
    const mid = cents.length < MIN_COMPARE_MONTHS ? null : median(cents);
    return {
      report: incomeReport(ctx, range, h.balances).stability?.medianCents ?? null,
      months: mid !== null && mid > 0 ? Math.round(mid) : null,
    };
  },
  buffer: (h) => {
    const ctx = contextOf(h);
    const direction = buildDashboard(ctx, running(h), h.balances, h.inputs).home.direction;
    // the Yhteenveto row shows the two sums the months divide, so the sum beside the months is the divisor
    const quotient = direction.bufferNetCents === null || !direction.bufferSpendCents ? null : direction.bufferNetCents / direction.bufferSpendCents;
    return { report: bufferReport(ctx, h.balances, h.inputs).bufferMonths, home: direction.bufferMonths, quotient };
  },
  balanceChange: (h) => {
    const ctx = contextOf(h);
    const report = balanceReport(ctx, running(h), h.balances, h.inputs);
    const accounts = report.accounts.map((a) => a.changeCents);
    // the accounts' changes are over the same two days and add up to the total's
    return {
      report: report.change?.cents ?? null,
      accounts: accounts.length && accounts.every((c) => c !== null) ? accounts.reduce((sum, c) => sum! + c!, 0) : null,
    };
  },
  cash: (h) => {
    const ctx = contextOf(h);
    return {
      holdings: buildHoldings(ctx, h.balances, h.inputs).accountsCents,
      dashboard: buildDashboard(ctx, running(h), h.balances, h.inputs).holdings.accountsCents,
      buffer: bufferReport(ctx, h.balances, h.inputs).cashCents,
    };
  },
  loanMonthly: (h) => {
    const ctx = contextOf(h);
    // the households have no typed loan, so each is read with one added: with no loan every answer is null and nothing is compared
    const inputs = { ...h.inputs, loans: [...(h.inputs.loans ?? []), typedLoan(h)] };
    // the instalments of every loan of the view added up; a loan whose payment is not counted makes the sum null, so no answer passes by leaving it out
    const monthly = (loans: readonly { monthlyPaymentCents: number | null }[]) => {
      const cents = loans.map((l) => l.monthlyPaymentCents);
      return cents.length === 0 || cents.some((c) => c === null) ? null : cents.reduce<number>((sum, c) => sum + c!, 0);
    };
    const holdings = buildHoldings(ctx, h.balances, inputs);
    return {
      holdings: monthly(holdings.loans),
      dashboard: monthly(buildDashboard(ctx, running(h), h.balances, inputs).holdings.loans),
    };
  },
  rareBillsYear: (h) => {
    const ctx = contextOf(h);
    // the typed bills of the demo household have none of the rare ones, so a typed yearly bill is added to be read as well
    const inputs = { ...h.inputs, expectedBills: [...h.inputs.expectedBills, { id: "typed-insurance", name: "Esimerkkivakuutus", amountCents: 24_000, dueDate: addMonths(monthOf(h.today), 2) + "-10", cadence: "yearly" as const, category: "insurance", reference: null, payeeIban: null }] };
    // with the household's balances, so a bill that an account outside them pays is left out of both or of neither
    return { calendar: billCalendar(ctx, inputs, h.balances).yearlyCents, upcoming: upcomingReport(ctx, inputs, h.balances).yearlyCents };
  },
  periodLeft: (h) => {
    const ctx = contextOf(h);
    const range = { from: `${addMonths(monthOf(h.today), -11)}-01`, to: h.today };
    const r = cashflowReport(ctx, range);
    return {
      cashflow: r.whole.leftCents,
      // the table's rows added up, to the cent: the running month's row too
      // a month the data does not reach has no row figure, so it would be left out of this sum: none of these households has one
      rows: r.rows.some((x) => x.leftCents === null) ? null : r.rows.reduce((s, x) => s + x.leftCents!, 0),
      totals: r.totals.leftCents,
    };
  },
  netWorth: (h) => {
    const ctx = contextOf(h);
    return {
      holdings: buildHoldings(ctx, h.balances, h.inputs).netCents,
      dashboard: buildDashboard(ctx, running(h), h.balances, h.inputs).holdings.netCents,
      balances: balanceReport(ctx, running(h), h.balances, h.inputs).holdings.netCents,
    };
  },
};

const households = [demoHousehold(), ...[1, 2, 3].map((seed) => seededHousehold(seed, true))];

describe("the figure registry", () => {
  it("lists answers for every figure and no figure that is not registered", () => {
    expect(Object.keys(ANSWERS).sort()).toEqual(Object.keys(FIGURES).sort());
  });

  it("names every figure once, case aside", () => {
    const names = Object.values(FIGURES).map((f) => f.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("reads the usual level of spending and of both incomes over the one period of USUAL_MONTHS complete months", () => {
    for (const h of households) {
      const ctx = contextOf(h);
      const before = completeMonthsBefore(ctx, monthOf(h.today));
      expect(before.length, h.name).toBeLessThanOrEqual(USUAL_MONTHS);
      // Säännölliset tulot reads the same months as Tavalliset tulot and Tavallinen
      expect(regularIncomeMonths(ctx, running(h)).map((m) => m.month), h.name).toEqual(before);
    }
  });

  describe.each(Object.keys(FIGURES) as FigureKey[])("%s", (key) => {
    it("is the same in every answer, for the demo and the seeded households on their fixed days", () => {
      let told = 0;
      for (const h of households) {
        const answers = ANSWERS[key](h);
        const values = Object.entries(answers);
        const first = values[0]![1];
        for (const [from, value] of values) expect(value, `${key} in ${h.name}: ${from} against ${values[0]![0]}`).toBe(first);
        if (first !== null) told++;
      }
      // a figure no household tells would pass by being empty everywhere
      expect(told, `${key} is told by some household`).toBeGreaterThan(0);
    });
  });
});
