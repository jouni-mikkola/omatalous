// The words of the usual savings rate, for the answer under Säästöaste
import type { cashflowReport } from "@banking/core";

type CashflowReport = ReturnType<typeof cashflowReport>;
import { percent } from "../../format.ts";
import { t } from "../../text.ts";

/** "tavallisesti 9–13 %", or "tavallisesti 11 %" when the band's ends print the same. */
export function rateRange(u: NonNullable<CashflowReport["usualRate"]>): string {
  return t("rpt.cf_usual", { range: rateBounds(u) });
}

/** "9–13 %", or "11 %" when the band's ends print the same. */
export function rateBounds(u: NonNullable<CashflowReport["usualRate"]>): string {
  const [low, high] = [Math.round(u.low * 100), Math.round(u.high * 100)];
  return low === high ? percent(u.mid) : `${low}–${percent(u.high)}`;
}

/** Every complete month's rate prints inside the band as printed: the answer says so in one sentence. */
export function rateStaysUsual(rows: CashflowReport["rows"], u: CashflowReport["usualRate"]): boolean {
  if (!u) return false;
  const [low, high] = [Math.round(u.low * 100), Math.round(u.high * 100)];
  return rows.every((r) => !r.complete || r.savingsRate === null || (Math.round(r.savingsRate * 100) >= low && Math.round(r.savingsRate * 100) <= high));
}
