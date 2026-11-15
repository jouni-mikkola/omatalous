import { monthLong } from "../../format.ts";
import { t } from "../../text.ts";

/**
 * A month's name in a table of months. A month core left out of the average says why: it has not ended ("kesken",
 * `running` of the report context), or it has ended and the accounts do not cover it ("vajaa", an account linked in
 * the middle of it). The period's end cannot tell the two apart on the last day of a month.
 */
export function monthName(m: { month: string; complete: boolean }, running: string | null): string {
  if (m.complete) return monthLong(m.month);
  return t(m.month === running ? "rpt.sm_running" : "rpt.sm_short", { month: monthLong(m.month) });
}
