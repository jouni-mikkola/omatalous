import type { ReportContext } from "./types.ts";

/**
 * The months of the period that the spending or the income report counts incomplete (a card with no purchases in the
 * month leaves its spending partial and its income whole). The charts of Tulot draw these months hatched, so one month
 * has one look on the page. A month neither report lists stays out.
 */
export function partialMonths(ctx: ReportContext): ReadonlySet<string> {
  const spending = (ctx.data.cashflowMonths?.months ?? []).flatMap((m) => (m.complete ? [] : [m.month]));
  const income = (ctx.data.income?.months ?? []).flatMap((m) => (m.complete ? [] : [m.month]));
  return new Set([...spending, ...income]);
}
