// Decision: whether the household can plan on the next twelve months as they stand, how far the net worth can fall or grow over the years, and so whether to save more or spend less now
import type { AnalysisContext } from "../analysis/context.ts";
import { buildHoldings } from "../holdings.ts";
import { householdDebts } from "../household-debts.ts";
import { debtInterestNext12Months, debtPaymentsPerMonth, debtTotalOn } from "../loans.ts";
import { netSamples, simulateNet } from "../analysis/long-forecast.ts";
import { addMonths, monthOf } from "../dates.ts";
import { FORECAST_RUNS, FORECAST_SEED, FORECAST_YEARS, YEAR_MONTHS } from "../thresholds.ts";
import { type BalanceInput, NO_INPUTS, type UserInputs } from "../types.ts";

/** The months of the forecast the household plans on. */
export const FORECAST_MONTHS = YEAR_MONTHS;

export interface ForecastRange {
  lowCents: number;
  midCents: number;
  highCents: number;
}

export interface ForecastMonth {
  /** "2026-11" */
  month: string;
  /** The month's own saving (earned income less spending): its range. */
  saving: ForecastRange;
  /** The savings of the months from the first to this one added up: its range. */
  total: ForecastRange;
  /** Net worth today plus `total`; null when the balances give no net worth. */
  netWorth: ForecastRange | null;
}

interface LongForecastReport {
  /** null under `MIN_COMPARE_MONTHS` complete months: there is nothing to learn the spread from. */
  basisMonths: number | null;
  /** Net worth today (`buildHoldings`), null when unknown. */
  netWorthNowCents: number | null;
  /** The months from the next one on, `FORECAST_MONTHS * FORECAST_YEARS` of them: the first twelve are the forecast, the rest carry the net worth over the years. */
  months: ForecastMonth[];
  /** The net worth at the end of each year ahead (year 1 is the twelfth month); empty without a net worth. */
  years: { year: number; range: ForecastRange }[];
  /** What the draw was made with: shown so that the same page can be reproduced. */
  seed: number;
  runs: number;
}

/** The days of the running month that are still ahead, as a share of the month: the part of its saving the net worth of today does not hold. */
function monthShareLeft(today: string): number {
  const days = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  return (days - +today.slice(8, 10)) / days;
}

/**
 * The net saving of the months ahead as a simulation (`simulateNet`) over the complete months so far, and the net worth
 * today moved by it. The running month enters with the share of it that is left (`monthShareLeft`), so the net worth of
 * month N is the one at its end, and the rows list the months from the next one on. The saving is earned income less
 * spending, and a loan's principal counts as spent though it also cuts the debt: the net worth gets the principal
 * back, the payments of the saved loans less their interest, held level and no more than the loans owe, and the whole payment once they are paid off.
 */
export function longForecastReport(ctx: AnalysisContext, balances: readonly BalanceInput[] = [], inputs: UserInputs = NO_INPUTS): LongForecastReport {
  const running = monthOf(ctx.today);
  const samples = netSamples(ctx, running);
  const netWorthNowCents = balances.length ? buildHoldings(ctx, balances, inputs).netCents : null;
  if (!samples) return { basisMonths: null, netWorthNowCents, months: [], years: [], seed: FORECAST_SEED, runs: FORECAST_RUNS };
  const count = FORECAST_MONTHS * FORECAST_YEARS;
  const sim = simulateNet(samples, count + 1, FORECAST_SEED, FORECAST_RUNS, monthShareLeft(ctx.today));
  const debts = householdDebts(balances, inputs, ctx.today).loans;
  const owed = debtTotalOn(debts, ctx.today).cents;
  const payment = debtPaymentsPerMonth(debts, ctx.today).monthlyCents;
  const principal = Math.max(0, payment - Math.round(debtInterestNext12Months(debts, ctx.today).cents / YEAR_MONTHS));
  // the payments still sit in the spending the draws learn from, so once the loans are paid off the saving is that much better
  const freed = (k: number): number => (principal > 0 && owed > 0 ? Math.min(owed, principal * k) + Math.round(payment * Math.max(0, k - owed / principal)) : 0);
  const shift = (r: ForecastRange, i: number): ForecastRange | null => {
    if (netWorthNowCents === null) return null;
    const back = netWorthNowCents + freed(i + 1);
    return { lowCents: back + r.lowCents, midCents: back + r.midCents, highCents: back + r.highCents };
  };
  const months = sim.month.slice(1).map((saving, i): ForecastMonth => ({ month: addMonths(running, i + 1), saving, total: sim.total[i + 1]!, netWorth: shift(sim.total[i + 1]!, i) }));
  const years = months.flatMap((m, i) => (m.netWorth && (i + 1) % FORECAST_MONTHS === 0 ? [{ year: (i + 1) / FORECAST_MONTHS, range: m.netWorth }] : []));
  return { basisMonths: samples.length, netWorthNowCents, months, years, seed: FORECAST_SEED, runs: FORECAST_RUNS };
}
