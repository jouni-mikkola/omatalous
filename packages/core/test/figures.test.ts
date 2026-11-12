/**
 * The figure registry (`figures.ts`, ADR 0020): every figure in it gives the same value in each answer that carries it,
 * for the demo household and the seeded ones on a fixed day. A figure with one answer is compared with the explanation
 * or the report that recomputes it. A new figure fails here until its answers are listed.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, type Household, seededHousehold } from "../../../tools/findings/households.ts";
import { aheadBasis, cashAhead } from "../src/analysis/ahead.ts";
import { savingsRateOf } from "../src/analysis/bridge.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { spendTotals } from "../src/analysis/context.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { paydayOf, runwayOf } from "../src/analysis/runway.ts";
import { expectedEverydayPerDay, expectedIncome, expectedLevel, expectedSpending } from "../src/analysis/expected.ts";
import { completeMonthsBefore, spendingThrough } from "../src/analysis/usual.ts";
import { addMonths, daysBetween, monthEnd, monthOf } from "../src/dates.ts";
import { explain } from "../src/explain/explain.ts";
import { explainNow } from "../src/explain/now.ts";
import { FIGURES } from "../src/figures.ts";
import { DIRECTION_MONTHS, USUAL_MONTHS } from "../src/thresholds.ts";
import { buildHoldings } from "../src/holdings.ts";
import { balanceReport } from "../src/reports/balances.ts";
import { bufferReport } from "../src/reports/buffer.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { incomeReport, regularIncomeMonths } from "../src/reports/income.ts";

type FigureKey = keyof typeof FIGURES;

/** What each answer says of one figure for one household: the values, which must all be the same. */
type Answers = (h: Household) => Record<string, number | null>;

const monthOfRange = (h: Household) => addMonths(monthOf(h.today), -1);
const lastMonth = (h: Household) => ({ from: `${monthOfRange(h)}-01`, to: monthEnd(monthOfRange(h)) });
/** A range that reaches today, as the first page reads when it is running. */
const running = (h: Household) => ({ from: `${monthOf(h.today)}-01`, to: monthEnd(monthOf(h.today)) });

const ANSWERS: Record<FigureKey, Answers> = {
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
      explain: explain("yli_jai.month", ctx, { view: "own", range }).cents,
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
    // free is the balance less the payments and the own transfers: two figures of the window add up to it
    const left = basis.balance ? basis.balance.startCents - basis.totals.dueCents - basis.totals.transferCents : null;
    return { dashboard: dash?.balance?.freeCents ?? null, ahead: basis.balance?.freeCents ?? null, parts: left, explain: explainNow("ahead.free", ctx, h.balances, h.inputs).explanation.cents };
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
  average: (h) => {
    const ctx = contextOf(h);
    const months = completeMonthsBefore(ctx, monthOf(h.today), DIRECTION_MONTHS);
    const explained = explain("spend.average", ctx, { view: "own", range: { from: `${addMonths(monthOf(h.today), -DIRECTION_MONTHS)}-01`, to: monthEnd(addMonths(monthOf(h.today), -1)) } }).cents;
    return { home: buildDashboard(ctx, running(h), h.balances, h.inputs).home.direction.averageCents, byHand: expectedLevel(months.map((m) => spendingThrough(ctx, m))), explain: explained };
  },
  fixed: (h) => {
    const ctx = contextOf(h);
    return {
      dashboard: buildDashboard(ctx, running(h), h.balances, h.inputs).fixedMonthlyCents,
      buffer: bufferReport(ctx, h.balances, h.inputs).fixedMonthlyCents,
      explain: explain("bills.fixed", ctx, { view: "own", range: running(h) }).cents,
    };
  },
  expected: (h) => {
    const ctx = contextOf(h);
    const month = monthOfRange(h);
    return { usual: expectedSpending(ctx, month), explain: explain("expected.spend", ctx, { view: "own", range: lastMonth(h) }).cents, buffer: month === monthOf(h.today) ? bufferReport(ctx, h.balances, h.inputs).expectedSpendCents : expectedSpending(ctx, month) };
  },
  expectedIncome: (h) => {
    const ctx = contextOf(h);
    const month = monthOf(h.today);
    return { usual: expectedIncome(ctx, month), buffer: bufferReport(ctx, h.balances, h.inputs).incomeMonthlyCents };
  },
  regularIncome: (h) => {
    const ctx = contextOf(h);
    const range = running(h);
    return { report: incomeReport(ctx, range, h.balances).stability?.medianCents ?? null, explain: explain("usual.income", ctx, { view: "own", range }).cents };
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
    // the accounts' changes are over the same two days and add up to the total's, and so do the lines of the cash flow's bridge
    return {
      report: report.change?.cents ?? null,
      accounts: accounts.length && accounts.every((c) => c !== null) ? accounts.reduce((sum, c) => sum! + c!, 0) : null,
      bridge: cashflowReport(ctx, running(h), h.balances).moneyBridge?.lines.reduce((sum, l) => sum + l.cents, 0) ?? null,
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
  periodLeft: (h) => {
    const ctx = contextOf(h);
    const range = { from: `${addMonths(monthOf(h.today), -11)}-01`, to: h.today };
    const r = cashflowReport(ctx, range);
    return {
      cashflow: r.whole.leftCents,
      // the table's rows added up, to the cent: the running month's row too
      rows: r.rows.reduce((s, x) => s + x.leftCents, 0),
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
      // Säännölliset tulot reads the same months as Odotetut tulot and Tavallinen
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
