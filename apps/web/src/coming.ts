import { type ExpectedCharge, expectedCharges, type IsoDate, monthEnd, monthOf } from "@banking/core";
import type { Recurring } from "./types.ts";

/**
 * This month's charges still to come, counted by the forecast's own definition (every projected date, so a weekly fee
 * four or five times; a cancelled merchant left out). Counted from the earliest expected date, so no charge is moved:
 * one a few days late from last month keeps its own date and the page shows it as late.
 */
export function comingThisMonth(series: readonly Recurring[], today: IsoDate, cancelled: ReadonlySet<string>): ExpectedCharge[] {
  const month = monthOf(today);
  const from = series.reduce((min, s) => (s.nextDate !== null && s.nextDate < min ? s.nextDate : min), `${month}-01`);
  // the route leaves out the row ids, which expectedCharges does not read
  return expectedCharges(
    series.map((s) => ({ ...s, transactionIds: [] })),
    from,
    monthEnd(month),
    { cancelled },
  );
}
