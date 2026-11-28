// Decision: can the money on the accounts pay the bills that fall due before payday, and which bill breaks first, so the household moves money or a due date.
import type { IsoDate } from "../types.ts";
import type { AheadData, AheadRow } from "./ahead.ts";
import { paydayOf } from "./runway.ts";

/** "covered": the money pays the bill whole. "split": it pays a part. "short": it pays none of it. */
type BillCover = "covered" | "split" | "short";

interface CoveredBill {
  date: IsoDate;
  name: string;
  /** The bill's sum, positive. */
  cents: number;
  /** The part of it the money left when its turn came, 0 to `cents`. */
  coveredCents: number;
  /** The part of it the money did not pay: `cents - coveredCents`. */
  missingCents: number;
  /** Null without a balance: nothing is known of the cover then. */
  state: BillCover | null;
}

export interface BillsBeforePayday {
  /** The pay the window ends at, null without one: the window is then the 30 days. */
  payday: IsoDate | null;
  /** What the counted checking accounts hold today, null when a balance is missing. Below zero when they are overdrawn. */
  moneyCents: number | null;
  /** In due order, as `AheadData.rows` has them. */
  bills: CoveredBill[];
  /** The bills added up. */
  billsCents: number;
  /** The part of them the money pays, `min(moneyCents, billsCents)` and never below 0. Null with no balance. */
  coveredCents: number | null;
  /** The part that is left unpaid: `billsCents - coveredCents`. Null with no balance. */
  missingCents: number | null;
  /** The bills the money does not pay whole: the split one and the short ones. Null with no balance. */
  leftOverCount: number | null;
}

/** What leaves the counted accounts as a bill: not the pays and not a regular transfer to an account the balance leaves out. */
const isBill = (r: AheadRow): r is AheadRow & { cents: number } => (r.source === "recurring" || r.source === "expected" || r.source === "card") && r.cents !== null && r.cents < 0;

/**
 * The bills due before payday laid against the money of the counted accounts, in due order: each takes what is left of
 * the money, down to nothing. The money of today and the pay dated before a bill count, as in the walk of the first
 * page (`shortOn`, `lowPoint`). The everyday spending between the bills and the debt of a card that has no bill are
 * left out, so this figure is kinder than the low point of the first page. A bill dated on the payday itself is paid from the pay and is no row of the window.
 */
export function billsBeforePayday(ahead: Pick<AheadData, "reason" | "payday" | "rows" | "balance">): BillsBeforePayday {
  const moneyCents = ahead.balance?.startCents ?? null;
  // an overdraft stays in the sum, as in `shortOn`: a pay before a bill fills it first
  let left = moneyCents ?? 0;
  let counted = 0;
  const bills = ahead.rows.filter(isBill).map((r): CoveredBill => {
    const cents = -r.cents;
    // the pay dated before this bill's day arrives before it falls due
    const paid = ahead.rows.reduce((sum, p) => (p.source === "income" && p.date < r.date ? sum + (p.cents ?? 0) : sum), 0);
    left += paid - counted;
    counted = paid;
    const coveredCents = moneyCents === null ? 0 : Math.max(0, Math.min(left, cents));
    // the bill leaves the account even when the money is not enough, so the walk goes on below zero
    left -= cents;
    const state = moneyCents === null ? null : coveredCents === cents ? "covered" : coveredCents > 0 ? "split" : "short";
    return { date: r.date, name: r.name, cents, coveredCents, missingCents: cents - coveredCents, state };
  });
  const billsCents = bills.reduce((sum, b) => sum + b.cents, 0);
  const known = moneyCents !== null;
  const coveredCents = known ? bills.reduce((sum, b) => sum + b.coveredCents, 0) : null;
  return {
    payday: paydayOf(ahead)?.date ?? null,
    moneyCents,
    bills,
    billsCents,
    coveredCents,
    missingCents: coveredCents === null ? null : billsCents - coveredCents,
    leftOverCount: known ? bills.filter((b) => b.missingCents > 0).length : null,
  };
}
