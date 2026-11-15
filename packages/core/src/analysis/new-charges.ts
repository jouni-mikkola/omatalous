/**
 * New regular charges. A subscription is new when its first charge is less than a year old. A new charge that began
 * after a charge of 2 € or less from the same merchant is a trial turned paid. A series that took over from the same
 * merchant's series on another account is the same subscription on a new card, not a new one. Instalment plans
 * (Klarna and the like) are left out.
 */
import { getCategory } from "../categories.ts";
import { addDays, daysBetween } from "../dates.ts";
import { fold } from "../merchant.ts";
import { parseSeriesId, type RecurringSeries } from "../recurring.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import { isLenderName } from "../wording.ts";
import { type AnalysisContext, type AnalysisTx, netPurchase, recurringAt } from "./context.ts";
import { isMonthlyOrLonger } from "./change-split.ts";
import { accountCovers } from "./coverage.ts";
import { GATE_FLOOR_CENTS, MOVE_GAP, NEW_SUBSCRIPTION_DAYS, SETTLE_DAYS, TRIAL_DAYS, TRIAL_MAX_CENTS } from "../thresholds.ts";
import { answeredSubscriptions, answerOf, settledBy } from "./subscription-alerts.ts";

const accountOf = (s: RecurringSeries) => parseSeriesId(s.id)?.accountId;

/** A regular charge that began lately, with the small charge it followed when it was a trial that turned paid. */
interface NewCharge {
  series: RecurringSeries;
  trial: AnalysisTx | null;
}

/**
 * The new regular charges the household has not answered, one per series in the order of the series: a fixed amount
 * once a month or less often whose first charge is at most `NEW_SUBSCRIPTION_DAYS` old, worth the gate a month, on an
 * account that had rows before it, and not a service that moved from another card. The queue of Tarkistettavat reads
 * this one list.
 */
export function newCharges(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): NewCharge[] {
  // a new charge the household answered (Lopetettu or Käytössä) is known to them
  const answered = answeredSubscriptions(inputs, ctx.today);
  const now = recurringAt(ctx, end);
  const isNew = (s: RecurringSeries) => {
    const kind = getCategory(s.category).kind;
    // a fixed amount once a month or less often: a weekly fixed sum is a habit, a new bill of varying amount is a
    // cause in the spending change (Uudet kaupat)
    return s.kind === "subscription" && s.active && !isLenderName(fold(s.merchant)) && isMonthlyOrLonger(s) && (kind === "expense" || kind === "debt");
  };
  // the same merchant's series on another account that stopped at most MOVE_GAP intervals before this one began: the
  // service moved to a new card and keeps its history, the third charge there only makes the series
  const movedFrom = (s: RecurringSeries) => {
    const account = accountOf(s);
    return now.some((o) => o.merchant === s.merchant && o.kind === "subscription" && isMonthlyOrLonger(o) && accountOf(o) !== account && o.lastDate < s.firstDate && daysBetween(o.lastDate, s.firstDate) <= s.intervalDays * MOVE_GAP);
  };
  const out: NewCharge[] = [];
  for (const s of now) {
    if (!isNew(s) || settledBy(answerOf(answered, s), s.firstDate) || daysBetween(s.firstDate, end) > NEW_SUBSCRIPTION_DAYS || !accountCovers(ctx, [accountOf(s) ?? ""], addDays(s.firstDate, -SETTLE_DAYS)) || movedFrom(s)) continue;
    if (s.monthlyCents < GATE_FLOOR_CENTS) continue;
    const trial = ctx.txs.find(
      (t) => t.merchant === s.merchant && t.bookingDate < s.firstDate && daysBetween(t.bookingDate, s.firstDate) <= TRIAL_DAYS && netPurchase(t) > 0 && netPurchase(t) <= TRIAL_MAX_CENTS,
    );
    out.push({ series: s, trial: trial ?? null });
  }
  return out;
}
