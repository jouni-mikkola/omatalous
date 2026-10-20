/**
 * Credit drawn in the period, and debt service when it takes more than 35 % of usual income (a common bank limit for
 * all loans; a mortgage at 15 % is ordinary and not news). Debt service is the monthly cost of the loan series as
 * they stand (`fixedSplit`), so an early repayment or a loan paid off at once is not counted as a monthly burden.
 * Usual income is the median of six complete months; with fewer months nothing is judged.
 */
import { cancelledSubjects, fixedSplit, isCancelled } from "../../commitments.ts";
import { getCategory } from "../../categories.ts";
import { monthOf } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import { type AnalysisContext, recurringAt } from "../context.ts";
import { coverOf } from "../flows.ts";
import { formatEur } from "../format.ts";
import { usualIncome } from "../usual.ts";
import { dateSpan, lastCompleteMonths, monthRows, monthSpan } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

/**
 * The line the debt insight draws. It is the app's own, not an outside figure: no authority sets a line for debt
 * service as paid (Finanssivalvonta's 60 % is for a new mortgage at a stressed 6 % rate), so it has no row in
 * optimise/facts/.
 */
const DEBT_SHARE = 0.35;
const MONTHS = 6;

export interface DebtShare {
  /** Loan instalments a month as the series stand. */
  debtCents: number;
  /** Usual income (`usualIncome`): the median earned income of `months`. */
  incomeCents: number;
  /** The six complete months before `end`, oldest first. */
  months: string[];
  /** The debt series on `end`, cancelled merchants left out. */
  series: readonly RecurringSeries[];
}

/** Debt service against usual income, without the insight's line. Null under six complete months. */
export function debtShareOf(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): DebtShare | null {
  const months = lastCompleteMonths(ctx, end, MONTHS);
  if (months.length < MONTHS) return null;
  const cancelled = cancelledSubjects(inputs);
  const series = recurringAt(ctx, end).filter((s) => getCategory(s.category).kind === "debt" && !isCancelled(cancelled, s));
  const debtCents = fixedSplit(series, cancelled).debtCents;
  // six months give a usual income, so it is never null here
  const incomeCents = usualIncome(ctx, monthOf(end))!;
  return { debtCents, incomeCents, months, series };
}

export function borrowing({ ctx, range, end, current, totals, inputs }: InsightArgs): Insight[] {
  const out: Insight[] = [];
  const period = dateSpan(range.from, end);
  // credit drawn is the window's net, never below zero (`coverOf`); the rows only tell how many draws made it
  const drawn = coverOf(totals).creditDrawnCents;
  if (drawn > 0) {
    const draws = current.filter((t) => t.flows.borrowed > 0);
    out.push({
      id: "borrowed",
      tone: "warning",
      title: `Luottoa nostettu ${formatEur(drawn, false)}`,
      detail: `${draws.length === 1 ? "Yksi nosto" : `${draws.length} nostoa`} ${period}.`,
      yearlyCents: drawn,
      rows: draws.map((t) => t.id),
      link: { category: "credit_draw", from: range.from, to: end },
      calc: [
        { label: "Nostettu", value: formatEur(drawn, false) },
        { label: "Nostoja", value: String(draws.length) },
      ],
    });
  }
  const share = debtShareOf(ctx, end, inputs);
  if (!share) return out;
  const { months, series, debtCents: debt, incomeCents: income } = share;
  if (income > 0 && debt / income > DEBT_SHARE) {
    const first = months[0]!;
    const last = months[months.length - 1]!;
    const ids = new Set(series.flatMap((s) => s.transactionIds));
    out.push({
      id: "debt",
      tone: "warning",
      title: `Velanhoitoon ${Math.round((debt / income) * 100)}\u00a0% tuloista`,
      detail: `Lainojen erät ${formatEur(debt, false)} ja tavalliset tulot ${formatEur(income, false)} kuussa, ${monthSpan(first, last)}.`,
      // the part above the limit, over a year
      yearlyCents: Math.round((debt - DEBT_SHARE * income) * 12),
      rows: months.flatMap((m) => monthRows(ctx, m).txs.filter((t) => ids.has(t.id)).map((t) => t.id)),
      link: { from: `${first}-01`, to: end },
      calc: [
        { label: "Lainojen erät kuussa", value: formatEur(debt, false) },
        { label: "Tavalliset tulot kuussa", value: formatEur(income, false) },
        { label: "Osuus tuloista", value: `${Math.round((debt / income) * 100)}\u00a0%` },
      ],
    });
  }
  return out;
}
