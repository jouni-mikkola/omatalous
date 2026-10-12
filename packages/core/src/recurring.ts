import { getCategory, SUBSCRIPTION_CATEGORIES } from "./categories.ts";
import { addDays, addMonths, dateIn, DAYS_PER_MONTH, daysBetween, monthEnd, monthIndex, monthOf } from "./dates.ts";
import { fold, UNKNOWN_MERCHANT } from "./merchant.ts";
import { followDay, type PayFollow, payFollowOf } from "./pay-follow.ts";
import { addMonthsKeepDay, CADENCES, type Cadence, type CadenceDef, fitCadence, nextDateOf, SEMIMONTHLY } from "./recurring-cadence.ts";
import { chargesPerYear, isFixedAmount, latestPriceChange, yearlyCostOf } from "./recurring-cost.ts";
import { type Occurrence, type SeriesInput, toOccurrences } from "./recurring-occurrence.ts";
import { median, sum } from "./stats.ts";
import type { IsoDate } from "./types.ts";
import { isEssentialService } from "./wording.ts";

// the cadence table moved to recurring-cadence.ts: what was importable from here still is
export { type Cadence, cadenceMonths } from "./recurring-cadence.ts";

/**
 * subscription – fixed amount on a fixed cadence (Spotify, gym, rent)
 * bill         – fixed cadence, varying amount (electricity, phone bill)
 * habit        – frequent but irregular (groceries, Wolt, coffee)
 * income       – regular money in (salary, benefits)
 */
export type RecurringKind = "subscription" | "bill" | "habit" | "income";

export interface PriceChange {
  fromCents: number;
  toCents: number;
  date: IsoDate;
}

export interface RecurringSeries {
  id: string;
  merchant: string;
  category: string;
  kind: RecurringKind;
  cadence: Cadence | null;
  intervalDays: number;
  occurrences: number;
  firstDate: IsoDate;
  lastDate: IsoDate;
  nextDate: IsoDate | null;
  /** Set on a series that follows a pay (pay-follow.ts): its dates are the days of that pay, not days of its own. */
  follows?: PayFollow;
  /** Always positive. Median of the latest charges. */
  typicalAmountCents: number;
  lastAmountCents: number;
  /** Cost (or income) normalised to one month, positive: the yearly cost / 12. */
  monthlyCents: number;
  /** Over a year, positive. A monthly series with a year of history counts its own charges of the last twelve months (a summer break, a winter electricity bill). */
  yearlyCents: number;
  /** How many times per month this happens, based on the last 90 days for habits and the last year for monthly series. */
  perMonth: number;
  /** Calendar months from the first charge to the last, both included. */
  monthsActive: number;
  active: boolean;
  /** Active, but the next charge is more than 5 days late. */
  overdue: boolean;
  /** A small service that has run for half a year or more: worth asking whether it is still used. */
  review: boolean;
  confidence: number;
  priceChange: PriceChange | null;
  transactionIds: string[];
}

/**
 * The parts of a series id, `<in|out>:<account>:<merchant>` with `#habit` or `#<cents>` after it when one merchant on
 * one account has several series. Ids are stored (marks, Optimoi decisions and inputs), so the format never changes
 * (ADR 0009). An account id has no ":" and a merchant name no "#" (cleanDescription drops it), so ids from real rows
 * never need the escape below.
 */
export interface SeriesIdParts {
  direction: "in" | "out";
  accountId: string;
  merchant: string;
  /** `habit` for the everyday purchases, the typical cents of one of several fixed products, null for the one series. */
  product: "habit" | number | null;
}

const PRODUCT = String.raw`#(?:habit|-?[1-9]\d*|0)`;
/** A merchant that ends like a product suffix, or in "#", gets one more "#" when it has no product. */
const LOOKS_LIKE_PRODUCT = new RegExp(`(?:${PRODUCT}|#)$`, "u");
const WITH_PRODUCT = new RegExp(`^(.+?)(${PRODUCT})?$`, "su");

/** The one maker of a series id. */
export function seriesId(p: SeriesIdParts): string {
  const tail = p.product !== null ? `#${p.product}` : LOOKS_LIKE_PRODUCT.test(p.merchant) ? "#" : "";
  return `${p.direction}:${p.accountId}:${p.merchant}${tail}`;
}

/** The one reader of a series id, or null for any other subject (a merchant name, a code). */
export function parseSeriesId(id: string): SeriesIdParts | null {
  const head = /^(in|out):([^:]*):(.+)$/su.exec(id);
  if (!head) return null;
  const [, direction, accountId, rest] = head as unknown as [string, "in" | "out", string, string];
  if (rest.endsWith("#") && LOOKS_LIKE_PRODUCT.test(rest.slice(0, -1))) return { direction, accountId, merchant: rest.slice(0, -1), product: null };
  const [, merchant, suffix] = WITH_PRODUCT.exec(rest)!;
  const product = suffix === undefined ? null : suffix === "#habit" ? "habit" : Number(suffix.slice(1));
  return { direction, accountId, merchant: merchant!, product };
}

const LOOKBACK_DAYS = 800;
const OVERDUE_DAYS = 5;

/** Payments to and from people, cash and own transfers are not services, even when they repeat. */
const NEVER_RECURRING = new Set(["p2p", "p2p_in", "cash"]);

const monthsBetween = (first: IsoDate, last: IsoDate) => monthIndex(last) - monthIndex(first) + 1;
/** Active, and the next charge is more than five days late. */
const isOverdue = (active: boolean, nextDate: IsoDate, today: IsoDate) => active && daysBetween(nextDate, today) > OVERDUE_DAYS;

function buildSeries(
  id: string,
  merchant: string,
  category: string,
  direction: "in" | "out",
  occ: readonly Occurrence[],
  fit: { cadence: CadenceDef; regularity: number },
  today: IsoDate,
): RecurringSeries {
  const { cadence, regularity } = fit;
  const first = occ[0]!;
  const last = occ[occ.length - 1]!;
  const fixedAmount = isFixedAmount(occ);
  const kind: RecurringKind =
    direction === "in" ? "income" : fixedAmount ? "subscription" : cadence.days < 20 ? "habit" : "bill";
  const priceChange = fixedAmount ? latestPriceChange(occ) : null;
  // after a price change the new price is what the next charges will be; two payments a
  // month of different sizes (housing allowance and child benefit) have no single typical one
  const typical = priceChange
    ? last.cents
    : cadence.id === "semimonthly" && !fixedAmount
      ? Math.round(sum(occ.slice(-4).map((o) => o.cents)) / Math.min(4, occ.length))
      : Math.round(median(occ.slice(-3).map((o) => o.cents)));
  const perYear = chargesPerYear(occ, cadence);
  const yearly = yearlyCostOf(occ, cadence, kind, typical, perYear);
  const since = daysBetween(last.date, today);
  const nextDate = nextDateOf(occ, cadence);
  const active = since <= cadence.days + cadence.tolerance * 2;
  return {
    id,
    merchant,
    category,
    kind,
    cadence: cadence.id,
    intervalDays: cadence.days,
    occurrences: occ.length,
    firstDate: first.date,
    lastDate: last.date,
    nextDate,
    typicalAmountCents: typical,
    lastAmountCents: last.cents,
    monthlyCents: Math.round(yearly / 12),
    yearlyCents: yearly,
    perMonth: perYear / 12,
    monthsActive: monthsBetween(first.date, last.date),
    active,
    overdue: isOverdue(active, nextDate, today),
    review: false,
    confidence: Math.round(regularity * Math.min(1, occ.length / (cadence.minOccurrences + 3)) * 100) / 100,
    priceChange,
    transactionIds: occ.flatMap((o) => o.ids),
  };
}

/**
 * Splits a merchant's charges into amount clusters, so that e.g. three
 * different Apple subscriptions (0,99 / 2,99 / 12,99) become three series.
 */
const MIN_PRODUCT_CHARGES = 3;

function clusterByAmount(txs: readonly SeriesInput[]): SeriesInput[][] {
  const sorted = [...txs].sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents));
  const clusters: SeriesInput[][] = [];
  for (const t of sorted) {
    const current = clusters[clusters.length - 1];
    const prev = current?.[current.length - 1];
    if (current && prev && Math.abs(t.amountCents) - Math.abs(prev.amountCents) <= Math.max(100, 0.1 * Math.abs(prev.amountCents))) {
      current.push(t);
    } else {
      clusters.push([t]);
    }
  }
  return clusters;
}

function habitSeries(id: string, merchant: string, txs: readonly SeriesInput[], today: IsoDate): RecurringSeries | null {
  const occ = toOccurrences(txs);
  const recent = txs.filter((t) => daysBetween(t.bookingDate, today) <= 90);
  if (recent.length < 4 || daysBetween(occ[0]!.date, today) < 45) return null;
  const last = occ[occ.length - 1]!;
  const recentTotal = sum(recent.map((t) => Math.abs(t.amountCents)));
  const months = 90 / DAYS_PER_MONTH;
  const monthly = Math.round(recentTotal / months);
  return {
    id: seriesId({ ...parseSeriesId(id)!, product: "habit" }),
    merchant,
    category: mostCommon(txs.map((t) => t.category)),
    kind: "habit",
    cadence: null,
    intervalDays: 90 / recent.length,
    occurrences: occ.length,
    firstDate: occ[0]!.date,
    lastDate: last.date,
    nextDate: null,
    typicalAmountCents: Math.round(median(recent.map((t) => Math.abs(t.amountCents)))),
    lastAmountCents: Math.abs(txs.find((t) => t.bookingDate === last.date)?.amountCents ?? last.cents),
    monthlyCents: monthly,
    yearlyCents: monthly * 12,
    perMonth: Math.round((recent.length / months) * 10) / 10,
    monthsActive: monthsBetween(occ[0]!.date, last.date),
    active: daysBetween(last.date, today) <= 30,
    overdue: false,
    review: false,
    confidence: Math.min(1, recent.length / 12),
    priceChange: null,
    transactionIds: txs.map((t) => t.id),
  };
}

const REVIEW_MIN_MONTHLY = 300; // tiny storage tiers (0,99 € and 2,99 €) and tips are not worth a question
const REVIEW_MAX_MONTHLY = 1500;
const GYM_MAX_MONTHLY = 6000;
const REVIEW_MIN_MONTHS = 6;

/**
 * A small subscription that has run for half a year. A gym membership counts
 * at a higher price when nothing else is ever bought there: it is the
 * classic fee paid long after the visits stopped.
 */
function needsReview(s: RecurringSeries, otherPurchases: number): boolean {
  if (!s.active || s.kind !== "subscription" || s.monthsActive < REVIEW_MIN_MONTHS) return false;
  if (!SUBSCRIPTION_CATEGORIES.has(s.category) || isEssentialService(fold(s.merchant))) return false;
  if (s.monthlyCents < REVIEW_MIN_MONTHLY) return false;
  if (s.monthlyCents <= REVIEW_MAX_MONTHLY) return true;
  return s.category === "fitness" && otherPurchases === 0 && s.monthlyCents <= GYM_MAX_MONTHLY;
}

/**
 * Detects subscriptions, bills, habits and regular income from transaction
 * history up to `today`. Pure and deterministic: same input, same output.
 * Each account is its own series, so two family members paying the same
 * service on the same day are two subscriptions, not a price change.
 */
export function detectRecurring(txs: readonly SeriesInput[], today: IsoDate): RecurringSeries[] {
  const groups = new Map<string, { id: string; merchant: string; direction: "in" | "out"; txs: SeriesInput[] }>();
  // the household's first charge of each merchant on any account: a series that starts after it has moved, not started
  const firstPaid = new Map<string, IsoDate>();
  for (const t of txs) {
    if (t.isTransfer || t.status !== "booked" || t.amountCents === 0 || t.merchant === UNKNOWN_MERCHANT) continue;
    if (NEVER_RECURRING.has(t.category) || getCategory(t.category).kind === "transfer") continue;
    if (t.bookingDate > today || daysBetween(t.bookingDate, today) > LOOKBACK_DAYS) continue;
    const direction = t.amountCents < 0 ? "out" : "in";
    const key = seriesId({ direction, accountId: t.accountId, merchant: t.merchant, product: null });
    const g = groups.get(key) ?? { id: key, merchant: t.merchant, direction, txs: [] };
    g.txs.push(t);
    groups.set(key, g);
    const paid = `${direction}:${t.merchant}`;
    if ((firstPaid.get(paid) ?? t.bookingDate) >= t.bookingDate) firstPaid.set(paid, t.bookingDate);
  }

  const result: RecurringSeries[] = [];
  for (const { id, merchant, direction, txs: group } of groups.values()) {
    if (group.length < 2) continue;
    const back = direction === "out" ? (groups.get(seriesId({ direction: "in", accountId: group[0]!.accountId, merchant, product: null }))?.txs ?? []) : [];
    const found = seriesOfGroup(id, merchant, direction, group, today, firstPaid.get(`${direction}:${merchant}`)!, back);
    const covered = new Set(found.flatMap((s) => s.transactionIds));
    const otherPurchases = group.filter((t) => !covered.has(t.id)).length;
    for (const s of found) s.review = needsReview(s, otherPurchases);
    result.push(...found);
  }
  // a bill paid when the pay arrives comes with the next pay, not a month from its last charge
  const bookedOn = new Map<string, IsoDate>();
  const datesOf = (s: RecurringSeries) => {
    if (!bookedOn.size) for (const t of txs) bookedOn.set(t.id, t.bookingDate);
    return [...new Set(s.transactionIds.map((id) => bookedOn.get(id)!))].sort();
  };
  for (const [s, follows] of payFollowOf(result, datesOf)) {
    s.follows = follows;
    s.nextDate = followDay(s.nextDate!, follows);
    s.overdue = isOverdue(s.active, s.nextDate, today);
  }
  return result.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

/** Shops and restaurants are visited, not billed: varying amounts there are purchases, even monthly ones. */
const SHOPPING_CATEGORIES = new Set([
  "groceries", "restaurants", "food_delivery", "alcohol", "shopping", "home", "entertainment", "travel", "personal_care", "gifts_donations", "gambling",
]);
const MIN_BILL_CHARGES = 4;
/** Shops plus garages and clinics: paid per visit, so two equal charges are weak evidence of a schedule. */
const VISITED_CATEGORIES = new Set([...SHOPPING_CATEGORIES, "car", "health"]);

/**
 * A varying amount on a monthly or slower cadence is a bill only with some
 * evidence: three shop visits a month apart happen by chance.
 */
function isBill(occ: readonly Occurrence[], fit: { cadence: CadenceDef }, category: string, direction: "in" | "out"): boolean {
  // two repairs at a garage half a year apart can cost the same by chance: a third charge decides
  if (direction === "out" && occ.length < 3 && fit.cadence.days >= 180 && VISITED_CATEGORIES.has(category)) return false;
  if (direction === "in" || fit.cadence.days < 20 || isFixedAmount(occ)) return true;
  return occ.length >= MIN_BILL_CHARGES && !SHOPPING_CATEGORIES.has(category);
}

/** `back`: money in from the merchant on the same account; a refund after the first charge leaves two charges unproven. */
function seriesOfGroup(id: string, merchant: string, direction: "in" | "out", group: readonly SeriesInput[], today: IsoDate, firstPaid: IsoDate, back: readonly SeriesInput[]): RecurringSeries[] {
  const occ = toOccurrences(group);
  const categoryOf = (rows: readonly SeriesInput[]) => mostCommon(rows.map((t) => t.category));
  const category = categoryOf(group);
  const fitted = fitCadence(occ, direction === "out" && category === "subscriptions" && firstPaid >= occ[0]!.date && !back.some((t) => t.bookingDate >= occ[0]!.date));
  const fit = fitted && isBill(occ, fitted, category, direction) ? fitted : null;
  if (fit && isFixedAmount(occ)) return [buildSeries(id, merchant, category, direction, occ, fit, today)];
  // Several fixed-price products from one merchant (Apple 0,99 + 12,99)
  // can look like one irregular or alternating series: split by amount.
  const products: RecurringSeries[] = [];
  if (group.length >= 4) {
    // two similar baskets a year apart are not a product: a cluster needs three charges
    for (const cluster of clusterByAmount(group).filter((c) => c.length >= MIN_PRODUCT_CHARGES)) {
      const cOcc = toOccurrences(cluster);
      const cFit = fitCadence(cOcc);
      if (cFit && isFixedAmount(cOcc)) {
        const typical = Math.round(median(cOcc.map((o) => o.cents)));
        // the cluster's own rows decide its category: a bank's loan instalment is not its service fee
        products.push(buildSeries(seriesId({ ...parseSeriesId(id)!, product: typical }), merchant, categoryOf(cluster), direction, cOcc, cFit, today));
      }
    }
  }
  const covered = sum(products.map((p) => p.transactionIds.length));
  if (products.length && covered >= 0.6 * group.length) return products;
  if (fit) return [buildSeries(id, merchant, category, direction, occ, fit, today)];
  if (products.length) {
    // a fixed product among everyday purchases: report both
    const inProducts = new Set(products.flatMap((p) => p.transactionIds));
    const habit = direction === "out" ? habitSeries(id, merchant, group.filter((t) => !inProducts.has(t.id)), today) : null;
    return habit ? [...products, habit] : products;
  }
  const habit = direction === "out" ? habitSeries(id, merchant, group, today) : null;
  return habit ? [habit] : [];
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "other";
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

/**
 * Expected charge dates after the last one, up to `until` (inclusive): the next date of the series and the steps of
 * its cadence from there. Empty for habits, which have no schedule.
 */
export function projectDates(s: Pick<RecurringSeries, "cadence" | "lastDate" | "nextDate" | "follows">, until: IsoDate): IsoDate[] {
  if (!s.cadence || !s.nextDate) return [];
  const def = s.cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.id === s.cadence)!;
  const out: IsoDate[] = [];
  if (def.months) {
    // every step keeps the day of the next date; a next date on the last day of a shorter month stands for the later day of the last charge
    const month = monthOf(s.nextDate);
    const [day, lastDay] = [Number(s.nextDate.slice(8, 10)), Number(s.lastDate.slice(8, 10))];
    const keep = s.nextDate === monthEnd(month) && lastDay > day ? lastDay : day;
    for (let k = 0; ; k++) {
      // a series that follows a pay comes with the pay of each of those months
      const d = k === 0 ? s.nextDate : s.follows ? followDay(addMonthsKeepDay(s.nextDate, k * def.months), s.follows) : dateIn(addMonths(month, k * def.months), keep);
      if (d > until) break;
      out.push(d);
    }
  } else if (def.id === "semimonthly") {
    // two anchors a month: the next date's day and the last charge's day
    for (let k = 0; k < 1200; k++) {
      const a = addMonthsKeepDay(s.nextDate, k);
      const b = addMonthsKeepDay(s.lastDate, k + 1);
      if (a > until) break;
      out.push(a);
      if (b <= until) out.push(b);
    }
  } else {
    for (let d = s.nextDate; d <= until; d = addDays(d, Math.round(def.days))) out.push(d);
  }
  return out;
}

/** How much a price change adds to (or takes off) a year of charges; null without a change. */
export function priceChangeYearlyCents(s: Pick<RecurringSeries, "cadence" | "priceChange"> & { perMonth?: number }): number | null {
  if (!s.priceChange || !s.cadence) return null;
  const def = s.cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.id === s.cadence)!;
  // the series' own charges a year: a rise in a day care fee applies to 11 months
  return Math.round((s.priceChange.toCents - s.priceChange.fromCents) * (s.perMonth ? s.perMonth * 12 : def.perYear));
}
