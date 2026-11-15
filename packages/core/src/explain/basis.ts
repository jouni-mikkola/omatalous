/**
 * What a panel says its figure stands on, in the line under its title. The rows of a range are dated by the range, so the
 * line is the range. A figure of another basis (a usual month, a day, the year ahead) would mislead with the page's range
 * above rows that are older or later than it, so each says its own. A figure is added to `BASIS` before it can be
 * explained: the type has no figure without one, and the test of the table reads each.
 * Decision: the household sees which months and which day a figure rests on, not only the month the page was set to.
 */
import { formatFiDate } from "../analysis/format.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { USUAL_MONTHS } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";
import type { FigureId } from "./types.ts";

/**
 * `rows`: the rows booked in the range. `usual`: a usual month from the last months, whatever the range. `day`: the
 * state on one day. `payday`: the state on the day until the next payday. `year`: the 12 months after the day. `payment`: the next payment after the day.
 */
type Basis = { kind: "rows" } | { kind: "usual"; months: number } | { kind: "day" } | { kind: "payday" } | { kind: "year" } | { kind: "payment" };

const ROWS: Basis = { kind: "rows" };
const DAY: Basis = { kind: "day" };
/** A bill's month is its charges of the last twelve months over twelve (`yearlyCostOf`), so a bill that comes once a quarter has its month too. */
const BILL_MONTHS = 12;

/** The basis of every figure: a figure without one does not compile. */
export const BASIS: Record<FigureId, Basis> = {
  "spend.month": ROWS,
  "spend.category": ROWS,
  "income.month": ROWS,
  "income.earned": ROWS,
  "yli_jai.month": ROWS,
  "share.part": ROWS,
  "settlement.over": ROWS,
  "expected.spend": { kind: "usual", months: USUAL_MONTHS },
  "usual.income": { kind: "usual", months: USUAL_MONTHS },
  "bills.fixed": { kind: "usual", months: BILL_MONTHS },
  "bills.subs": { kind: "usual", months: BILL_MONTHS },
  "holdings.accounts": DAY,
  "ahead.free": { kind: "payday" },
  "ahead.pay": { kind: "payday" },
  "loans.total": DAY,
  "loans.interest": { kind: "year" },
  "loans.payments": DAY,
  "holdings.loans": DAY,
  "loan.balance": DAY,
  "loan.interest": { kind: "year" },
  "loan.payment": { kind: "payment" },
  "loan.monthly": DAY,
};

/**
 * The line of a figure whose basis is not the range's rows, `day` being the day its panel was asked for; null for the rows
 * of a range, whose line is the range itself.
 */
export function basisLine(figure: FigureId, day: IsoDate, lang: Language = DEFAULT_LANGUAGE): string | null {
  const basis = BASIS[figure];
  const date = formatFiDate(day, lang);
  switch (basis.kind) {
    case "rows":
      return null;
    case "usual":
      return messageIn(lang, "why.basis_usual", { months: basis.months });
    case "day":
      return messageIn(lang, "why.basis_day", { date });
    case "payday":
      return messageIn(lang, "why.basis_payday", { date });
    case "year":
      return messageIn(lang, "why.basis_year", { date });
    case "payment":
      return messageIn(lang, "why.basis_payment", { date });
  }
}
