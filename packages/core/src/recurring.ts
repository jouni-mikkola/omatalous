import { getCategory } from "./categories.ts";
import { addDays, daysBetween, daysInMonth, monthIndex } from "./dates.ts";
import { fold, UNKNOWN_MERCHANT } from "./merchant.ts";
import { median, sum } from "./stats.ts";
import type { IsoDate, Transaction } from "./types.ts";

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "yearly";

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

interface CadenceDef {
  id: Cadence;
  days: number;
  tolerance: number;
  minOccurrences: number;
  perYear: number;
  /** Calendar months per step for month-based cadences (the next charge keeps the day of month), 0 otherwise. */
  months: number;
}

const CADENCES: readonly CadenceDef[] = [
  { id: "weekly", days: 7, tolerance: 2, minOccurrences: 4, perYear: 365.25 / 7, months: 0 },
  { id: "biweekly", days: 14, tolerance: 3, minOccurrences: 4, perYear: 365.25 / 14, months: 0 },
  { id: "monthly", days: 30.44, tolerance: 5, minOccurrences: 3, perYear: 12, months: 1 },
  { id: "bimonthly", days: 60.88, tolerance: 8, minOccurrences: 3, perYear: 6, months: 2 },
  { id: "quarterly", days: 91.31, tolerance: 12, minOccurrences: 3, perYear: 4, months: 3 },
  { id: "semiannual", days: 182.62, tolerance: 20, minOccurrences: 2, perYear: 2, months: 6 },
  { id: "yearly", days: 365.25, tolerance: 25, minOccurrences: 2, perYear: 1, months: 12 },
];

/** Two charges a month on fixed days (salary on the 15th and the last day): looks biweekly by gaps alone. */
const SEMIMONTHLY: CadenceDef = { id: "semimonthly", days: 365.25 / 24, tolerance: 3, minOccurrences: 4, perYear: 24, months: 0 };

const DAYS_PER_MONTH = 30.44;
const MIN_REGULARITY = 0.7;
const LOOKBACK_DAYS = 800;
const OVERDUE_DAYS = 5;

/** Payments to and from people, cash and own transfers are not services, even when they repeat. */
const NEVER_RECURRING = new Set(["p2p", "p2p_in", "cash"]);

type SeriesInput = Pick<Transaction, "id" | "accountId" | "bookingDate" | "amountCents" | "merchant" | "category" | "isTransfer" | "status">;

interface Occurrence {
  date: IsoDate;
  cents: number; // positive
  ids: string[];
}

/** Two charges differ when they are at least 50 cents and 3 % apart. */
function amountsDiffer(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff >= 50 && diff >= 0.03 * Math.max(a, b);
}

function toOccurrences(txs: readonly SeriesInput[]): Occurrence[] {
  const byDate = new Map<IsoDate, Occurrence>();
  for (const t of txs) {
    const o = byDate.get(t.bookingDate) ?? { date: t.bookingDate, cents: 0, ids: [] };
    o.cents += Math.abs(t.amountCents);
    o.ids.push(t.id);
    byDate.set(t.bookingDate, o);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function latestPriceChange(occ: readonly Occurrence[]): PriceChange | null {
  for (let i = occ.length - 1; i > 0; i--) {
    if (amountsDiffer(occ[i]!.cents, occ[i - 1]!.cents)) {
      return { fromCents: occ[i - 1]!.cents, toCents: occ[i]!.cents, date: occ[i]!.date };
    }
  }
  return null;
}

function countAmountChanges(occ: readonly Occurrence[]): number {
  let changes = 0;
  for (let i = 1; i < occ.length; i++) if (amountsDiffer(occ[i]!.cents, occ[i - 1]!.cents)) changes++;
  return changes;
}

/**
 * Fixed price: no change at all, or one price change after the old price
 * repeated at least twice (with only two charges, "one change" is two
 * different purchases, not a subscription).
 */
function isFixedAmount(occ: readonly Occurrence[]): boolean {
  const changes = countAmountChanges(occ);
  if (changes === 0) return true;
  if (changes > 1 || occ.length < 4) return false;
  const at = occ.findIndex((o, i) => i > 0 && amountsDiffer(o.cents, occ[i - 1]!.cents));
  return at >= 2;
}

/** Two charges far apart only count as recurring when they are nearly the same amount. */
function enoughEvidence(occ: readonly Occurrence[], cadence: CadenceDef): boolean {
  if (occ.length >= 3 || cadence.days < 180) return true;
  const [a, b] = [occ[0]!.cents, occ[1]!.cents];
  return Math.abs(a - b) <= 0.15 * Math.max(a, b);
}

const dayOfMonth = (d: IsoDate) => Number(d.slice(8, 10));

/**
 * Full months between the first and the last have two charges, and the
 * first and second charge of a month each stay on about the same day.
 * Biweekly charges drift through the month by two to three days a month,
 * so they fail the second test. One odd month in six (holiday pay as a
 * third payment) is allowed.
 */
function isSemimonthly(occ: readonly Occurrence[]): boolean {
  const perMonth = new Map<number, IsoDate[]>();
  for (const o of occ) {
    const m = monthIndex(o.date);
    perMonth.set(m, [...(perMonth.get(m) ?? []), o.date]);
  }
  const first = monthIndex(occ[0]!.date);
  const last = monthIndex(occ[occ.length - 1]!.date);
  if (last - first < 2) return false;
  const firsts: number[] = [];
  const seconds: number[] = [];
  let odd = 0;
  for (let m = first; m <= last; m++) {
    const dates = perMonth.get(m) ?? [];
    const inner = m !== first && m !== last;
    if (dates.length > 2 || (inner && dates.length !== 2)) odd += 1;
    else if (dates.length === 2) {
      firsts.push(dayOfMonth(dates[0]!));
      seconds.push(dayOfMonth(dates[1]!));
    }
  }
  if (odd > Math.max(1, Math.floor((last - first + 1) / 6))) return false;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  // weekend shifts and month lengths move a day by a few days, not more
  return firsts.length >= 2 && spread(firsts) <= 6 && spread(seconds) <= 6;
}

/** Fits a fixed cadence to the occurrences, or returns null when they are not regular. */
function fitCadence(occ: readonly Occurrence[]): { cadence: CadenceDef; regularity: number } | null {
  if (occ.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < occ.length; i++) intervals.push(daysBetween(occ[i - 1]!.date, occ[i]!.date));
  const m = median(intervals);
  let cadence = CADENCES.find((c) => Math.abs(m - c.days) <= c.tolerance);
  if (cadence?.id === "biweekly" && m >= 13 && m <= 17 && isSemimonthly(occ)) cadence = SEMIMONTHLY;
  if (!cadence || occ.length < cadence.minOccurrences) return null;
  let score = 0;
  for (const iv of intervals) {
    if (Math.abs(iv - cadence.days) <= cadence.tolerance * 1.5) score += 1;
    // one missed charge (e.g. a skipped month) still counts half
    else if (Math.abs(iv - 2 * cadence.days) <= cadence.tolerance * 2) score += 0.5;
  }
  const regularity = score / intervals.length;
  return regularity >= MIN_REGULARITY && enoughEvidence(occ, cadence) ? { cadence, regularity } : null;
}

/** Same day of month `n` months later, clamped to the month's length (31.1. + 1 → 28.2.). */
function addMonthsKeepDay(date: IsoDate, n: number): IsoDate {
  const i = monthIndex(date) + n;
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  const month = `${y}-${String(m).padStart(2, "0")}`;
  const day = Math.min(dayOfMonth(date), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

/**
 * Month-based cadences land on the day of month of the last charge (rent on
 * the 1st → the 1st), semimonthly on the day of the charge before it.
 */
function nextDateOf(occ: readonly Occurrence[], cadence: CadenceDef): IsoDate {
  const last = occ[occ.length - 1]!.date;
  if (cadence.months) return addMonthsKeepDay(last, cadence.months);
  if (cadence.id === "semimonthly" && occ.length >= 2) {
    const next = addMonthsKeepDay(occ[occ.length - 2]!.date, 1);
    return next > last ? next : addMonthsKeepDay(last, 1);
  }
  return addDays(last, Math.round(cadence.days));
}

const monthsBetween = (first: IsoDate, last: IsoDate) => monthIndex(last) - monthIndex(first) + 1;

/**
 * Charges a year. A monthly series with a year of history counts its charges
 * in the twelve months up to the last one: day care is free in July and
 * after-school care pauses for the summer, so they cost 11 and 9 charges a
 * year. A late payment moves a charge to the next month and keeps the count.
 */
function chargesPerYear(occ: readonly Occurrence[], cadence: CadenceDef): number {
  const year = lastTwelveMonths(occ, cadence);
  return year ? Math.min(cadence.perYear, year.length) : cadence.perYear;
}

/** A monthly series' charges in the twelve months up to its last one; null with less than a year of history. */
function lastTwelveMonths(occ: readonly Occurrence[], cadence: CadenceDef): Occurrence[] | null {
  if (cadence.months !== 1) return null;
  const last = monthIndex(occ[occ.length - 1]!.date);
  if (last - monthIndex(occ[0]!.date) < 11) return null;
  return occ.filter((o) => monthIndex(o.date) > last - 12);
}

/**
 * What a series costs in a year. A bill that varies with the season
 * (electricity) is what its last twelve charges came to: the latest
 * summer bills times twelve would miss the winter.
 */
function yearlyCostOf(occ: readonly Occurrence[], cadence: CadenceDef, kind: RecurringKind, typical: number, perYear: number): number {
  const year = kind === "bill" ? lastTwelveMonths(occ, cadence) : null;
  return year && year.length >= perYear ? sum(year.slice(-perYear).map((o) => o.cents)) : Math.round(typical * perYear);
}

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
    overdue: active && daysBetween(nextDate, today) > OVERDUE_DAYS,
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
    id: `${id}#habit`,
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

/** Categories of services people sign up for and forget; housing, insurance, telecom and the like are needs. */
const REVIEW_CATEGORIES = new Set(["subscriptions", "entertainment", "fitness", "shopping", "education", "other"]);
/** Storage and security keep the phone and the files working: not asked about. */
const ESSENTIAL_SERVICES = /ICLOUD|GOOGLE ?ONE|ONEDRIVE|MICROSOFT|OFFICE ?365|DROPBOX|F-?SECURE|NORTON|MCAFEE|1PASSWORD|BITWARDEN|LASTPASS/;
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
  if (!REVIEW_CATEGORIES.has(s.category) || ESSENTIAL_SERVICES.test(fold(s.merchant))) return false;
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
  for (const t of txs) {
    if (t.isTransfer || t.status !== "booked" || t.amountCents === 0 || t.merchant === UNKNOWN_MERCHANT) continue;
    if (NEVER_RECURRING.has(t.category) || getCategory(t.category).kind === "transfer") continue;
    if (t.bookingDate > today || daysBetween(t.bookingDate, today) > LOOKBACK_DAYS) continue;
    const direction = t.amountCents < 0 ? "out" : "in";
    const key = `${direction}:${t.accountId}:${t.merchant}`;
    const g = groups.get(key) ?? { id: key, merchant: t.merchant, direction, txs: [] };
    g.txs.push(t);
    groups.set(key, g);
  }

  const result: RecurringSeries[] = [];
  for (const { id, merchant, direction, txs: group } of groups.values()) {
    if (group.length < 2) continue;
    const found = seriesOfGroup(id, merchant, direction, group, today);
    const covered = new Set(found.flatMap((s) => s.transactionIds));
    const otherPurchases = group.filter((t) => !covered.has(t.id)).length;
    for (const s of found) s.review = needsReview(s, otherPurchases);
    result.push(...found);
  }
  return result.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

/** Shops and restaurants are visited, not billed: varying amounts there are purchases, even monthly ones. */
const SHOPPING_CATEGORIES = new Set([
  "groceries",
  "restaurants",
  "food_delivery",
  "alcohol",
  "shopping",
  "home",
  "entertainment",
  "travel",
  "personal_care",
  "gifts_donations",
  "gambling",
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

function seriesOfGroup(id: string, merchant: string, direction: "in" | "out", group: readonly SeriesInput[], today: IsoDate): RecurringSeries[] {
  const occ = toOccurrences(group);
  const categoryOf = (rows: readonly SeriesInput[]) => mostCommon(rows.map((t) => t.category));
  const fitted = fitCadence(occ);
  const fit = fitted && isBill(occ, fitted, categoryOf(group), direction) ? fitted : null;
  if (fit && isFixedAmount(occ)) return [buildSeries(id, merchant, categoryOf(group), direction, occ, fit, today)];
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
        products.push(buildSeries(`${id}#${typical}`, merchant, categoryOf(cluster), direction, cOcc, cFit, today));
      }
    }
  }
  const covered = sum(products.map((p) => p.transactionIds.length));
  if (products.length && covered >= 0.6 * group.length) return products;
  if (fit) return [buildSeries(id, merchant, categoryOf(group), direction, occ, fit, today)];
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
 * Expected charge dates after the last one, up to `until` (inclusive). Empty
 * for habits, which have no schedule.
 */
export function projectDates(s: Pick<RecurringSeries, "cadence" | "lastDate" | "nextDate">, until: IsoDate): IsoDate[] {
  if (!s.cadence || !s.nextDate) return [];
  const def = s.cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.id === s.cadence)!;
  const out: IsoDate[] = [];
  if (def.months) {
    for (let k = 1; ; k++) {
      const d = addMonthsKeepDay(s.lastDate, k * def.months);
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

type FixedInput = Pick<RecurringSeries, "active" | "kind" | "category" | "monthlyCents">;

/**
 * An active subscription or bill that is a fixed cost. The credit card bill
 * is regular, but it pays last month's everyday card purchases, so it is
 * left out (the month forecast still expects it).
 */
export function isFixedCost(s: Pick<RecurringSeries, "active" | "kind" | "category">): boolean {
  return s.active && (s.kind === "subscription" || s.kind === "bill") && s.category !== "card_bill";
}

/**
 * Monthly cost of active subscriptions and bills by what they are: spending,
 * debt service (loan instalments) or saving (a monthly fund saving).
 */
export function fixedSplit(series: readonly FixedInput[]): { consumptionCents: number; debtCents: number; savingsCents: number } {
  const out = { consumptionCents: 0, debtCents: 0, savingsCents: 0 };
  for (const s of series) {
    if (!isFixedCost(s)) continue;
    const kind = getCategory(s.category).kind;
    if (kind === "expense") out.consumptionCents += s.monthlyCents;
    else if (kind === "debt") out.debtCents += s.monthlyCents;
    else if (kind === "savings") out.savingsCents += s.monthlyCents;
  }
  return out;
}

/** Fixed costs per month: spending and debt service (what leaves for good), savings not included. */
export function fixedMonthlyCents(series: readonly FixedInput[]): number {
  const split = fixedSplit(series);
  return split.consumptionCents + split.debtCents;
}
