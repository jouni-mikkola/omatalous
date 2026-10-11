/**
 * New regular charges (the old `new:`) and H-insights 13: how many subscriptions run now against a year ago, and what
 * the new ones cost. A subscription is new when its first charge is less than a year old. A new charge that began
 * after a charge of 2 € or less from the same merchant says so: a trial turned paid. A series that took over from
 * the same merchant's series on another account is the same subscription on a new card, not a new one. When the year
 * count is shown, its new subscriptions are not told again one by one. Instalment plans (Klarna and the like) are told by
 * instalments.ts and are left out here.
 */
import { getCategory } from "../../categories.ts";
import { cancelledMerchants, isSubscription } from "../../commitments.ts";
import { addDays, daysBetween } from "../../dates.ts";
import { parseSeriesId, type RecurringSeries } from "../../recurring.ts";
import { historyCovers, netPurchase, recurringAt } from "../context.ts";
import { finnishList, formatEur, formatFiDate } from "../format.ts";
import { answeredSubscriptions, isLender, ITEM_GATE_MONTHLY_CENTS, MONTHLY_OR_LONGER, settledBy } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** A charge that started this many days before the end is new. */
const NEW_DAYS = 75;
/** Near the start of the history everything looks new. */
const SETTLE_DAYS = 45;
/** A subscription that moved to another account starts there within this many intervals of its last charge on the old one. */
const MOVE_GAP = 1.5;
/** A trial costs this much at most and comes this many days before the first full charge (H-insights 13). */
const TRIAL_MAX_CENTS = 200;
const TRIAL_DAYS = 45;
/** The year comparison needs the year-ago list settled: a year and the days a monthly series needs to show. */
const YEAR_HISTORY_DAYS = 365 + 75;

const price = (cents: number) => formatEur(cents, cents % 100 !== 0);

export function subscriptionChanges({ ctx, end, inputs }: InsightArgs): Insight[] {
  const cancelled = cancelledMerchants(inputs);
  // a new charge the household answered (Lopetettu or Käytössä) is known to them
  const answered = answeredSubscriptions(inputs, ctx.today);
  const now = recurringAt(ctx, end);
  const out: Insight[] = [];
  const told = new Set<string>();

  if (historyCovers(ctx, addDays(end, -YEAR_HISTORY_DAYS))) {
    const yearAgo = addDays(end, -365);
    const subs = now.filter((s) => isSubscription(s) && !cancelled.has(s.merchant) && !isLender(s.merchant));
    const before = recurringAt(ctx, yearAgo).filter((s) => isSubscription(s) && !isLender(s.merchant));
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
      out.push({
        id: "subscriptions-added",
        tone: "info",
        title: `Tilauksia ${subs.length}, vuosi sitten ${then}: +${formatEur(monthly, false)} kuussa`,
        detail: `Uudet: ${finnishList(added.map((s) => s.merchant))}, ${formatEur(yearly, false)} vuodessa.`,
        yearlyCents: yearly,
        rows: added.flatMap((s) => s.transactionIds),
      });
    }
  }

  const dataFrom = ctx.dataFrom ?? end;
  const isNew = (s: RecurringSeries) => {
    const kind = getCategory(s.category).kind;
    // a fixed amount once a month or less often: a weekly fixed sum is a habit, a new bill of varying amount is a
    // cause in the spending change (Uudet kaupat)
    return s.kind === "subscription" && s.active && !isLender(s.merchant) && MONTHLY_OR_LONGER.has(s.cadence ?? "") && (kind === "expense" || kind === "debt");
  };
  // the same merchant's series on another account that stopped at most MOVE_GAP intervals before this one began: the
  // service moved to a new card and keeps its history, the third charge there only makes the series
  const movedFrom = (s: RecurringSeries) => {
    const account = parseSeriesId(s.id)?.accountId;
    return now.some(
      (o) =>
        o.merchant === s.merchant &&
        o.kind === "subscription" &&
        MONTHLY_OR_LONGER.has(o.cadence ?? "") &&
        parseSeriesId(o.id)?.accountId !== account &&
        o.lastDate < s.firstDate &&
        daysBetween(o.lastDate, s.firstDate) <= s.intervalDays * MOVE_GAP,
    );
  };
  for (const s of now) {
    if (!isNew(s) || told.has(s.id) || settledBy(answered.get(s.merchant), s.firstDate) || daysBetween(s.firstDate, end) > NEW_DAYS || daysBetween(dataFrom, s.firstDate) < SETTLE_DAYS || movedFrom(s)) continue;
    if (s.monthlyCents < ITEM_GATE_MONTHLY_CENTS) continue;
    const trial = ctx.txs.find(
      (t) => t.merchant === s.merchant && t.bookingDate < s.firstDate && daysBetween(t.bookingDate, s.firstDate) <= TRIAL_DAYS && netPurchase(t) > 0 && netPurchase(t) <= TRIAL_MAX_CENTS,
    );
    const charges = s.occurrences === 1 ? "yksi veloitus" : `${s.occurrences} veloitusta`;
    out.push({
      id: `new:${s.id}`,
      tone: "info",
      title: `Uusi toistuva maksu: ${s.merchant} ${price(s.monthlyCents)} kuussa`,
      detail: trial
        ? `${price(netPurchase(trial))} kokeilu ${formatFiDate(trial.bookingDate)}, sen jälkeen ${charges} ${formatFiDate(s.firstDate)} alkaen.`
        : `Ensimmäinen veloitus ${formatFiDate(s.firstDate)}, ${charges} tähän mennessä.`,
      yearlyCents: s.yearlyCents,
      rows: trial ? [trial.id, ...s.transactionIds] : s.transactionIds,
      link: { merchant: s.merchant },
      merchant: s.merchant,
    });
  }
  return out;
}
