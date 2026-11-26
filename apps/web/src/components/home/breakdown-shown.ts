import { paydayParts } from "@banking/core";
import type { DashboardData } from "../../types.ts";
import type { Runway } from "./Breakdown.tsx";

/** Whether the breakdown has rows: core's walk is known and adds up to the figure. Apart from Breakdown, which carries the table and is loaded when it is shown. */
export function breakdownShown(low: DashboardData["home"]["lowPoint"], runway: Runway): boolean {
  return !!low?.known && paydayParts(low, runway.payday.date, runway.leftCents) !== null;
}
