/**
 * New regular charges (the old `new:`) and H-insights 13: how many subscriptions run now against a year ago, and what
 * the new ones cost. A subscription is new when its first charge is less than a year old. A new charge that began
 * after a charge of 2 € or less from the same merchant says so: a trial turned paid. A series that took over from
 * the same merchant's series on another account is the same subscription on a new card, not a new one. When the year
 * count is shown, its new subscriptions are not told again one by one. Instalment plans (Klarna and the like) are told by
 * instalments.ts and are left out here.
 */
import { getCategory } from "../../categories.ts";
import { cancelledSubjects, isCancelled, isSubscription } from "../../commitments.ts";
import { addDays, daysBetween } from "../../dates.ts";
import { parseSeriesId, type RecurringSeries } from "../../recurring.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import { type AnalysisContext, type AnalysisTx, netPurchase, recurringAt } from "../context.ts";
import { accountCovers } from "../coverage.ts";
import { formatEur, formatFiDate } from "../format.ts";
import { MOVE_GAP, NEW_SUBSCRIPTION_DAYS, SETTLE_DAYS, TRIAL_DAYS, TRIAL_MAX_CENTS, YEAR_HISTORY_DAYS } from "../../thresholds.ts";
import { answeredSubscriptions, answerOf, insightOf, isLender, ITEM_GATE_MONTHLY_CENTS, MONTHLY_OR_LONGER, settledBy } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";


const accountOf = (s: RecurringSeries) => parseSeriesId(s.id)?.accountId;

/** A regular charge that began lately, with the small charge it followed when it was a trial that turned paid. */
interface NewCharge {
  series: RecurringSeries;
  trial: AnalysisTx | null;
}

/**
 * The new regular charges the household has not answered, one per series in the order of the series: a fixed amount
 * once a month or less often whose first charge is at most `NEW_SUBSCRIPTION_DAYS` old, worth the gate a month, on an
 * account that had rows before it, and not a service that moved from another card. The insight below and the queue of
 * Tarkistettavat read this one list.
 */
export function newCharges(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): NewCharge[] {
  // a new charge the household answered (Lopetettu or Käytössä) is known to them
  const answered = answeredSubscriptions(inputs, ctx.today);
  const now = recurringAt(ctx, end);
  const isNew = (s: RecurringSeries) => {
    const kind = getCategory(s.category).kind;
    // a fixed amount once a month or less often: a weekly fixed sum is a habit, a new bill of varying amount is a
    // cause in the spending change (Uudet kaupat)
    return s.kind === "subscription" && s.active && !isLender(s.merchant) && MONTHLY_OR_LONGER.has(s.cadence ?? "") && (kind === "expense" || kind === "debt");
  };
  // the same merchant's series on another account that stopped at most MOVE_GAP intervals before this one began: the
  // service moved to a new card and keeps its history, the third charge there only makes the series
  const movedFrom = (s: RecurringSeries) => {
    const account = accountOf(s);
    return now.some(
      (o) =>
        o.merchant === s.merchant &&
        o.kind === "subscription" &&
        MONTHLY_OR_LONGER.has(o.cadence ?? "") &&
        accountOf(o) !== account &&
        o.lastDate < s.firstDate &&
        daysBetween(o.lastDate, s.firstDate) <= s.intervalDays * MOVE_GAP,
    );
  };
  const out: NewCharge[] = [];
  for (const s of now) {
    if (!isNew(s) || settledBy(answerOf(answered, s), s.firstDate) || daysBetween(s.firstDate, end) > NEW_SUBSCRIPTION_DAYS || !accountCovers(ctx, [accountOf(s) ?? ""], addDays(s.firstDate, -SETTLE_DAYS)) || movedFrom(s)) continue;
    if (s.monthlyCents < ITEM_GATE_MONTHLY_CENTS) continue;
    const trial = ctx.txs.find(
      (t) => t.merchant === s.merchant && t.bookingDate < s.firstDate && daysBetween(t.bookingDate, s.firstDate) <= TRIAL_DAYS && netPurchase(t) > 0 && netPurchase(t) <= TRIAL_MAX_CENTS,
    );
    out.push({ series: s, trial: trial ?? null });
  }
  return out;
}

export function subscriptionChanges({ ctx, end, inputs, lang }: InsightArgs): Insight[] {
  const price = (cents: number) => formatEur(cents, cents % 100 !== 0, lang);
  const cancelled = cancelledSubjects(inputs);
  const now = recurringAt(ctx, end);
  const out: Insight[] = [];
  const told = new Set<string>();

  // a subscription on an account connected later has no year to compare with: it is left out of both counts
  const yearFrom = addDays(end, -YEAR_HISTORY_DAYS);
  const hasYear = (s: RecurringSeries) => {
    const account = accountOf(s);
    return account !== undefined && accountCovers(ctx, [account], yearFrom);
  };
  {
    const yearAgo = addDays(end, -365);
    const subs = now.filter((s) => isSubscription(s) && !isCancelled(cancelled, s) && !isLender(s.merchant) && hasYear(s));
    const before = recurringAt(ctx, yearAgo).filter((s) => isSubscription(s) && !isLender(s.merchant) && hasYear(s));
    const known = new Set(before.map((s) => s.merchant));
    // a yearly subscription paid once by then had no series yet, but it ran: it counts a year ago, not as new
    const unseen = subs.filter((s) => !known.has(s.merchant));
    const added = unseen.filter((s) => s.firstDate > yearAgo).sort((a, b) => b.monthlyCents - a.monthlyCents || a.merchant.localeCompare(b.merchant));
    const then = before.length + unseen.length - added.length;
    const monthly = added.reduce((sum, s) => sum + s.monthlyCents, 0);
    const yearly = added.reduce((sum, s) => sum + s.yearlyCents, 0);
    // one new subscription is told on its own below, with its trial when it had one
    if (added.length >= 2 && subs.length > then && monthly >= ITEM_GATE_MONTHLY_CENTS) {
      for (const s of added) told.add(s.id);
      out.push(
        insightOf({
          lang,
          id: "subscriptions-added",
          fact: { type: "subscriptions-added", merchants: added.map((s) => s.merchant), now: subs.length, monthlyCents: monthly },
          comparison: { label: "yearAgoSubscriptions", value: q.count(then) },
          action: { label: "decideSubscription", target: { page: "bills" } },
          yearlyCents: -yearly,
          kind: "pattern",
          rows: added.flatMap((s) => s.transactionIds),
          calc: [
            { label: messageIn(lang, "calc.subs_now"), value: String(subs.length) },
            { label: messageIn(lang, "calc.subs_year_ago"), value: String(then) },
            ...added.map((s) => ({ label: messageIn(lang, "calc.sub_month", { merchant: s.merchant }), value: formatEur(s.monthlyCents, false, lang) })),
            { label: messageIn(lang, "calc.new_total_month"), value: formatEur(monthly, false, lang) },
          ],
        }),
      );
    }
  }

  for (const { series: s, trial } of newCharges(ctx, end, inputs)) {
    if (told.has(s.id)) continue;
    out.push(
      insightOf({
        lang,
        id: `new:${s.id}`,
        fact: { type: "new-subscription", merchant: s.merchant, monthlyCents: s.monthlyCents, firstDate: s.firstDate, charges: s.occurrences, trial: trial ? { cents: netPurchase(trial), date: trial.bookingDate } : null },
        comparison: { label: "before", value: q.cents(0) },
        action: { label: "decideSubscription", target: { page: "transactions", filter: { merchant: s.merchant } } },
        yearlyCents: -s.yearlyCents,
        kind: "pattern",
        rows: trial ? [trial.id, ...s.transactionIds] : s.transactionIds,
        link: { merchant: s.merchant },
        merchant: s.merchant,
        calc: [
          ...(trial ? [{ label: messageIn(lang, "calc.trial", { date: formatFiDate(trial.bookingDate, lang) }), value: price(netPurchase(trial)) }] : []),
          { label: messageIn(lang, "calc.first_charge"), value: formatFiDate(s.firstDate, lang) },
          { label: messageIn(lang, "calc.charges"), value: String(s.occurrences) },
          { label: messageIn(lang, "calc.month"), value: price(s.monthlyCents) },
        ],
      }),
    );
  }
  return out;
}
