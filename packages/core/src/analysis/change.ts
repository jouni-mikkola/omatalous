// Decision: is the change in spending a reason to act, and where
/**
 * What moved spending and why. A target period is set against a base period: a month against its usual level, the
 * last months against the same months a year earlier, or a month against the same month a year ago. Each category's
 * change is split into causes, in whole cents, and the causes add up to the change with no residual; the categories
 * add up to the total change.
 *
 * Inside a category each merchant's change goes to buckets in this order. A single large payment is a one-off. A
 * recurring bill that came twice, did not come, or is not part of an ordinary month is timing. A merchant with no
 * rows in the base is new, one with no rows now has stopped. A merchant in both periods splits into price (the ticket
 * now against the base ticket, on the visits now) and volume (the change in visits, on the base ticket). Price needs
 * three visits on both sides; below that the change is volume, except one charge a period on both sides (a bill whose amount
 * moved), which is price. A category with fewer than four rows in the base, and every debt category, has
 * only one-off and timing, the rest is "other".
 *
 * The expected level of a category is its own figure of `expected.ts` (ADR 0021): a mean of the base months with a
 * bill that comes every three months or less often placed in the month it falls due, so the categories add up to the
 * expected month to the cent. The merchants' mean base differs from it by a bucket of its own (`spread`), which is the only
 * one that is no cause.
 *
 * The usual view also owns what a category cost against its usual level for the spike alert (ADR 0013):
 * `categoryRises` gives the categories that rose over the gate and stand out, and whose ordinary purchases stand out
 * on their own, with the report's own figures, and the alert tells nothing else.
 */
import { getCategory } from "../categories.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { addMonths, monthIndex } from "../dates.ts";
import { monthSpan, sameAccounts } from "./coverage.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { IsoDate } from "../types.ts";
import { type Plan, planOf, rowsComplete, windowOf } from "./change-plan.ts";
import { floorsOf, monthSeries, type SignalInput, standsOut } from "./change-signal.ts";
import { addSplit, apportion, bucketList, dayOfMonth, type Facts, gated, isMonthlyOrLonger, type Merch, MIN_BASE_ROWS, NO_DUE, netReturns, purchases, RARE, type Split, spendOf, splitMerchant, sum } from "./change-split.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { LEVEL, oneOffs } from "./one-offs.ts";
import { type ExpectedDue, expectedFor, expectedLevel, expectedOver } from "./expected.ts";
import { cardsBreakUsual, gateFor, isCompleteMonth } from "./usual.ts";

export type ChangeView = "expected" | "year" | "season";
export type BucketKind = "oneoff" | "timing" | "new" | "stopped" | "price" | "volume" | "spread" | "other";

export interface Bucket {
  kind: BucketKind;
  /** target − base: positive means more spending. */
  cents: number;
}

export interface MerchantChange {
  kind: "merchant" | "smaller" | "spread";
  label: string;
  nowCents: number;
  baseCents: number;
  changeCents: number;
  /** Purchases in the target, and per base period (a mean over the months in the usual view). */
  visitsNow: number;
  visitsBase: number;
  ticketNowCents: number | null;
  ticketBaseCents: number | null;
  buckets: Bucket[];
}

/** A named category, or the row for the smaller ones. */
export interface CategoryChange {
  kind: "category" | "smaller";
  category: string | null;
  label: string;
  nowCents: number;
  baseCents: number;
  changeCents: number;
  /** The causes that pass the gate, largest first. */
  buckets: Bucket[];
  /** The causes under the gate, together: they add up with `buckets` to `changeCents`. */
  restCents: number;
  restCount: number;
  visitsNow: number;
  visitsBase: number;
  /** Spend at merchants that have rows in both periods: how much of the category the comparison of tickets rests on. */
  sameShopsNowCents: number;
  sameShopsBaseCents: number;
  /** Purchases at those same merchants, now and in the base (per base period). */
  sameShopsVisitsNow: number;
  sameShopsVisitsBase: number;
  /** The same month a year ago (usual view, when the history reaches back), and whether it moved as far as this one. */
  yearAgoCents: number | null;
  season: boolean;
  /** The change stands out from the category's own month-to-month noise (change-signal.ts): only then is it named. */
  standsOut: boolean;
  /** Every row that is no one-off is a bill or a subscription: a moved amount is a bigger or smaller bill. */
  bills: boolean;
  merchants: MerchantChange[];
}

/** One cause of one category: the pieces of all categories add up to the total change. */
export interface ChangePiece {
  category: string | null;
  kind: BucketKind;
  cents: number;
  season: boolean;
}

export interface ChangeWindow {
  months: string[];
  from: IsoDate;
  to: IsoDate;
}

export interface SpendingChange {
  view: ChangeView;
  target: ChangeWindow;
  base: ChangeWindow;
  /** The target month has not ended: both periods are cut at the same day of the month. */
  running: boolean;
  nowCents: number;
  baseCents: number;
  changeCents: number;
  /** A cause shows on its own at this size or more (10 € and 2 % of the expected monthly spending, for each month of the target). */
  gateCents: number;
  /** The total's change stands out from the household's month-to-month noise: only then is the period dearer or cheaper. */
  standsOut: boolean;
  categories: CategoryChange[];
  pieces: ChangePiece[];
}

/**
 * A category that rose in the usual view (`moved`), whose ordinary purchases stand out on their own: what the spike
 * alert may tell (alerts.ts). The figures are the report's, so the two cannot disagree (ADR 0013).
 */
export interface CategoryRise {
  category: string;
  label: string;
  /** The category's row of the report: the month's spending and its expected level, both to the same day in a running month. */
  nowCents: number;
  expectedCents: number;
  changeCents: number;
  /**
   * The rise in ordinary purchases: rows that are no one-off and no bill or subscription of a month or longer
   * (`isMonthlyOrLonger`), against the usual level of the same rows. A sofa, a new subscription, a bigger bill and a
   * bill that came twice are not in it.
   */
  moreCents: number;
  /** Ordinary purchases in the month. */
  purchases: number;
  /** The month's ordinary purchases are over those of every base month: a peak. A new level is over them only in its first month. */
  peak: boolean;
  /** The report's season mark, and the same month a year ago (null when the history does not reach it). */
  season: boolean;
  yearAgoCents: number | null;
}

export interface MonthRises {
  /** The month has not ended, or its rows do not reach its end: every figure is cut at the same day of the month. */
  running: boolean;
  /** The last day the figures count, the end of the report's window: before today when the rows lag. */
  through: IsoDate;
  gateCents: number;
  rises: CategoryRise[];
}

const MAX_CATEGORIES = 8;
const MAX_MERCHANTS = 8;
/** A move under a euro is rounding. */
const MIN_ROW_CENTS = 100;

export interface ContextIndex {
  byMonth: Map<number, AnalysisTx[]>;
  /** Transactions of subscriptions and bills (the fixed costs) to their series. */
  seriesOf: Map<string, RecurringSeries>;
}

const indexes = new WeakMap<AnalysisContext, ContextIndex>();

/** Built once per context: a dashboard explains twelve months from the same rows. */
export function contextIndex(ctx: AnalysisContext): ContextIndex {
  let index = indexes.get(ctx);
  if (index) return index;
  const byMonth = new Map<number, AnalysisTx[]>();
  for (const t of ctx.txs) {
    const list = byMonth.get(t.month);
    if (list) list.push(t);
    else byMonth.set(t.month, [t]);
  }
  const seriesOf = new Map<string, RecurringSeries>();
  for (const s of ctx.recurring) if (s.kind === "subscription" || s.kind === "bill") for (const id of s.transactionIds) seriesOf.set(id, s);
  index = { byMonth, seriesOf };
  indexes.set(ctx, index);
  return index;
}

/** The row for the categories under the gate together. */
export const restLabel = (count: number, lang: Language = DEFAULT_LANGUAGE) => (count ? messageIn(lang, "rep.rest_count", { count }) : messageIn(lang, "rep.other"));

const LABEL: Record<BucketKind, string> = { oneoff: "Kertaosto", timing: "Ajoitus", new: "Uudet kaupat", stopped: "Ostoja jäi pois", price: "Kalliimpi ostoskerta", volume: "Useammin", spread: "Kuukausien vaihtelu", other: "Syy ei näy tiedoista" };

export function bucketLabel(kind: BucketKind, cents: number, bills = false, lang: Language = DEFAULT_LANGUAGE): string {
  if (lang !== DEFAULT_LANGUAGE) {
    if (bills && kind === "price") return messageIn(lang, cents < 0 ? "rep.bucket_smaller_bill" : "rep.bucket_bigger_bill");
    if (cents < 0 && kind === "price") return messageIn(lang, "rep.bucket_cheaper");
    return messageIn(lang, cents < 0 && kind === "volume" ? "rep.bucket_rarer" : (`rep.bucket_${kind}` as const));
  }
  // a contract's moved amount is a bigger bill, never a dearer purchase
  if (bills && kind === "price") return cents < 0 ? "Pienempi lasku" : "Suurempi lasku";
  if (cents < 0 && kind === "price") return "Halvempi ostoskerta";
  return cents < 0 && kind === "volume" ? "Harvemmin" : LABEL[kind];
}

interface Rows {
  plan: Plan;
  rowsOf: (m: string) => AnalysisTx[];
  target: AnalysisTx[];
  /** Per base month in the usual view, else one entry for the whole base; one-offs struck in the usual view. */
  baseByMonth: AnalysisTx[][];
  /** One-offs of the target and the base (the level policy). */
  struck: ReadonlySet<string>;
  seriesOf: ReadonlyMap<string, RecurringSeries>;
  /** Base periods: the months of the usual view, else 1. */
  n: number;
  gate: number;
  signal: SignalInput;
  yearAgo: Map<string, number> | null;
  /** The usual view: the expected spending of each category and in all on the days of the plan (`expectedFor`), else null. */
  expected: { byCategory: ReadonlyMap<string, number>; totalCents: number; due: ReadonlyMap<string, ExpectedDue> } | null;
}

/** The expected figure of the usual view's month on the plan's days, from the plan's own base months. */
function expectedOfPlan(ctx: AnalysisContext, plan: Plan): Rows["expected"] {
  if (!plan.mean) return null;
  const month = plan.target[0]!;
  const shared = expectedFor(ctx, month);
  const figure = shared && shared.months.join() === plan.base.join() ? shared : expectedOver(ctx, month, plan.base);
  const at = figure.at(plan.cap);
  // the bills that fall due in the month by the plan's last day: a yearly bill is expected in its month, not a timing
  const due = new Map(figure.due.filter((d) => d.day <= plan.cap).map((d) => [d.seriesId, d]));
  return { byCategory: new Map(at.categories.map((c) => [c.category, c.cents])), totalCents: at.cents, due };
}

function rowsFor(ctx: AnalysisContext, plan: Plan): Omit<Rows, "gate"> {
  const { byMonth, seriesOf } = contextIndex(ctx);
  // a returning row to the payment it takes back: the pairing that set `refunded`
  const { returns } = ctx;
  const rowsOf = (m: string) => (byMonth.get(monthIndex(m)) ?? []).filter((t) => t.spend !== 0 && dayOfMonth(t) <= plan.cap);
  const target = netReturns(plan.target.flatMap(rowsOf), returns);
  const struck = oneOffs([...target, ...plan.base.flatMap(rowsOf)], LEVEL, ctx.fixedIds);
  // the expected level is read from months with their one-offs struck, so a pair nets inside its month; otherwise the
  // base is the whole period as it was
  const baseByMonth = plan.mean ? plan.base.map((m) => netReturns(rowsOf(m), returns).filter((t) => !struck.has(t.id))) : [netReturns(plan.base.flatMap(rowsOf), returns)];
  const noiseRows = plan.noise.flatMap(rowsOf);
  const signal: SignalInput = {
    plan,
    noise: monthSeries(plan.noise, rowsOf, oneOffs(noiseRows, LEVEL, ctx.fixedIds)),
    now: monthSeries(plan.target, rowsOf, struck),
    then: monthSeries(plan.base, rowsOf, struck),
    // a rare category's floor comes from its purchases: no one-off and no bill
    floors: floorsOf([...(plan.view === "year" ? [...target, ...plan.base.flatMap(rowsOf)] : noiseRows)].filter((t) => !struck.has(t.id) && !ctx.fixedIds.has(t.id)), plan.view === "year" ? 2 * plan.target.length : plan.noise.length),
  };
  // a year ago, for the season mark of the usual view
  const ago = addMonths(plan.target[0]!, -12);
  let yearAgo: Map<string, number> | null = null;
  if (plan.view === "expected" && isCompleteMonth(ctx, ago, undefined, { from: rowsComplete(ctx).from, today: ctx.today }) && sameAccounts(ctx, monthSpan(ago), monthSpan(plan.target[0]!))) {
    yearAgo = new Map();
    for (const t of rowsOf(ago)) yearAgo.set(t.category, (yearAgo.get(t.category) ?? 0) + t.spend);
  }
  return { plan, rowsOf, target, baseByMonth, struck, seriesOf, n: plan.mean ? plan.base.length : 1, signal, yearAgo, expected: expectedOfPlan(ctx, plan) };
}

/** The merchants of a category with their base, a mean over the months in the usual view (apportioned to whole cents). */
function merchantsOf(r: Rows, id: string, target: AnalysisTx[], flatBase: AnalysisTx[]): Merch[] {
  const byName = new Map<string, Merch>();
  const merch = (name: string) => byName.get(name) ?? (byName.set(name, { name, target: [], base: [], baseCents: 0, baseVisits: 0 }), byName.get(name)!);
  for (const t of target) merch(t.merchant).target.push(t);
  // a bill of a rare cadence is not part of an ordinary month, so it is not in the mean base
  for (const t of flatBase) if (!(r.plan.mean && RARE.has(r.seriesOf.get(t.id)?.cadence ?? ""))) merch(t.merchant).base.push(t);
  // a bill that falls due in the month is in the expected figure whole: its merchant has it as its base
  const dues = [...(r.expected?.due.values() ?? [])].filter((d) => d.category === id);
  for (const d of dues) merch(d.merchant);
  const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const shares = r.plan.mean ? apportion(list.map((m) => spendOf(m.base)), r.n) : list.map((m) => spendOf(m.base));
  list.forEach((m, i) => {
    const own = dues.filter((d) => d.merchant === m.name);
    m.baseCents = shares[i]! + sum(own.map((d) => d.cents));
    m.baseVisits = purchases(m.base).length / r.n + own.length;
  });
  return list;
}

type Item = MerchantChange & { split: Split };

function merchantRows(items: Item[], gate: number, spread: number): MerchantChange[] {
  items.sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.label.localeCompare(b.label));
  const shown = items.filter((m) => Math.abs(m.changeCents) >= gate).slice(0, MAX_MERCHANTS);
  const small = items.filter((m) => !shown.includes(m));
  const merchants: MerchantChange[] = shown.map(({ split: _s, ...m }) => m);
  if (small.length) {
    const split: Split = {};
    for (const m of small) addSplit(split, m.split);
    const s = (key: "nowCents" | "baseCents" | "visitsNow") => sum(small.map((m) => m[key]));
    merchants.push({ kind: "smaller", label: restLabel(small.length), nowCents: s("nowCents"), baseCents: s("baseCents"), changeCents: s("nowCents") - s("baseCents"), visitsNow: s("visitsNow"), visitsBase: 0, ticketNowCents: null, ticketBaseCents: null, buckets: bucketList(split) });
  }
  if (spread) merchants.push({ kind: "spread", label: bucketLabel("spread", spread), nowCents: 0, baseCents: 0, changeCents: spread, visitsNow: 0, visitsBase: 0, ticketNowCents: null, ticketBaseCents: null, buckets: [{ kind: "spread", cents: spread }] });
  return merchants;
}

/** One category's change, split into causes; its pieces go to `pieces`. */
function categoryChange(r: Rows, id: string, pieces: ChangePiece[]): CategoryChange {
  const target = r.target.filter((t) => t.category === id);
  const baseMonths = r.baseByMonth.map((rows) => rows.filter((t) => t.category === id));
  const flatBase = baseMonths.flat();
  const baseCents = r.expected ? (r.expected.byCategory.get(id) ?? 0) : spendOf(flatBase);
  const nowCents = spendOf(target);
  const facts: Facts = { category: id, change: nowCents - baseCents, oneOffs: r.struck, restricted: purchases(flatBase).length < MIN_BASE_ROWS || getCategory(id).kind === "debt" };
  const list = merchantsOf(r, id, target, flatBase);
  const total: Split = {};
  const items = list.map((m): Item => {
    const split = splitMerchant(m, facts, r.plan, r.n, r.seriesOf, r.expected?.due ?? NO_DUE);
    addSplit(total, split);
    const now = spendOf(m.target);
    const visitsNow = purchases(m.target).length;
    const ticketBaseCents = m.baseVisits > 0 ? Math.round(m.baseCents / m.baseVisits) : null;
    return { kind: "merchant", label: m.name, nowCents: now, baseCents: m.baseCents, changeCents: now - m.baseCents, visitsNow, visitsBase: Math.round(m.baseVisits * 10) / 10, ticketNowCents: visitsNow ? Math.round(now / visitsNow) : null, ticketBaseCents, buckets: bucketList(split), split };
  });
  // the merchants' base is a mean of the months, the category's expected figure also holds its bills by their months: the difference is a bucket, not a cause
  const spread = sum(list.map((m) => m.baseCents)) - baseCents;
  addSplit(total, spread ? { spread } : {});
  const both = items.filter((m) => m.visitsNow > 0 && m.baseCents > 0);
  const ya = r.yearAgo ? (r.yearAgo.get(id) ?? 0) : null;
  const change = nowCents - baseCents;
  const season = ya !== null && Math.sign(ya - baseCents) === Math.sign(change) && Math.abs(ya - baseCents) * 2 >= Math.abs(change) && Math.abs(change) >= r.gate;
  for (const b of bucketList(total)) pieces.push({ category: id, kind: b.kind, cents: b.cents, season });
  const counted = [...target, ...flatBase].filter((t) => !r.struck.has(t.id));
  return {
    kind: "category",
    category: id,
    label: getCategory(id).label,
    nowCents,
    baseCents,
    changeCents: change,
    ...gated(total, r.gate),
    visitsNow: purchases(target).length,
    visitsBase: Math.round((purchases(flatBase).length / r.n) * 10) / 10,
    sameShopsNowCents: sum(both.map((m) => m.nowCents)),
    sameShopsBaseCents: sum(both.map((m) => m.baseCents)),
    sameShopsVisitsNow: sum(both.map((m) => m.visitsNow)),
    sameShopsVisitsBase: sum(both.map((m) => m.visitsBase)),
    yearAgoCents: ya,
    season,
    standsOut: categoryStandsOut(r, change, target, flatBase, id),
    bills: counted.length > 0 && counted.every((t) => r.seriesOf.has(t.id)),
    merchants: merchantRows(items, r.gate, spread),
  };
}

/**
 * Whether a category's change stands out from its own noise: without the one-offs of either side, or the one-offs of
 * the target on their own (a television is news, a dear dinner in a month of dear dinners is not).
 */
function categoryStandsOut(r: Rows, change: number, target: readonly AnalysisTx[], flatBase: readonly AnalysisTx[], id: string): boolean {
  const oneOffNow = spendOf(target.filter((t) => r.struck.has(t.id)));
  // the usual base has its one-offs struck already
  const oneOffBase = r.plan.mean ? 0 : spendOf(flatBase.filter((t) => r.struck.has(t.id)));
  return standsOut(r.signal, id, change - oneOffNow + oneOffBase) || (oneOffNow >= r.gate && standsOut(r.signal, id, oneOffNow));
}

const KEYS = ["nowCents", "baseCents", "changeCents", "visitsNow", "visitsBase", "sameShopsNowCents", "sameShopsBaseCents", "sameShopsVisitsNow", "sameShopsVisitsBase"] as const;

/** The categories that did not make the list, as one row. */
function smallerRow(rest: readonly CategoryChange[], pieces: readonly ChangePiece[], gate: number): CategoryChange {
  const split: Split = {};
  const ids = new Set(rest.map((c) => c.category));
  for (const p of pieces) if (p.category !== null && ids.has(p.category)) split[p.kind] = (split[p.kind] ?? 0) + p.cents;
  const totals = Object.fromEntries(KEYS.map((key) => [key, sum(rest.map((c) => c[key]))])) as Record<(typeof KEYS)[number], number>;
  return { kind: "smaller", category: null, label: restLabel(rest.length), ...totals, ...gated(split, gate), yearAgoCents: null, season: false, standsOut: false, bills: false, merchants: [] };
}

/**
 * The total stands out from its noise without its one-offs, or one of its categories does. The noise is read from
 * month totals with their one-offs struck, so in the usual view the month is set against the expected total less
 * the one-offs it already leaves out.
 */
function totalStandsOut(r: Rows, categories: readonly CategoryChange[], nowTotal: number, change: number): boolean {
  const oneOffNow = spendOf(r.target.filter((t) => r.struck.has(t.id)));
  const moved = r.plan.mean
    ? nowTotal - oneOffNow - r.expected!.totalCents
    : change - oneOffNow + spendOf(r.baseByMonth.flat().filter((t) => r.struck.has(t.id)));
  // like a category, the total counts only a move the same way as the change the sentence states
  return (Math.sign(moved) === Math.sign(change) && standsOut(r.signal, null, moved)) || categories.some((c) => c.standsOut && Math.abs(c.changeCents) >= r.gate && Math.sign(c.changeCents) === Math.sign(change));
}

/** Whether a row moved: a category whose change is over the gate and stands out from its own noise. */
const moved = (gateCents: number, row: CategoryChange) => row.kind === "category" && row.category !== null && row.standsOut && Math.abs(row.changeCents) >= gateCents;

/**
 * The causes the report names for a row: those over the gate, the spread left out (it is no cause). None when the row
 * did not move (`moved`): the report then gives the figures and calls nothing moved.
 */
export function namedCauses(c: Pick<SpendingChange, "gateCents">, row: CategoryChange): Bucket[] {
  return moved(c.gateCents, row) ? row.buckets.filter((b) => b.kind !== "spread") : [];
}

/**
 * The rise of a category that moved up (`moved`), when its ordinary purchases rose and stand out without the rest
 * (`CategoryRise`). A cause over the gate is not asked for: a rise split over a new shop, more visits and dearer
 * tickets is a rise all the same, and the alert sizes it by `moreCents`. The ordinary rows are read from the same
 * months, days, one-offs and returns as the row itself.
 */
function riseOf(r: Rows, row: CategoryChange): CategoryRise[] {
  const id = row.category;
  if (id === null || row.changeCents <= 0 || !moved(r.gate, row)) return [];
  const ordinary = (rows: readonly AnalysisTx[]) => rows.filter((t) => t.category === id && !r.struck.has(t.id) && !isMonthlyOrLonger(r.seriesOf.get(t.id)));
  const now = ordinary(r.target);
  const months = r.baseByMonth.map((rows) => spendOf(ordinary(rows)));
  const moreCents = spendOf(now) - (expectedLevel(months) ?? 0);
  if (moreCents <= 0 || !standsOut(r.signal, id, moreCents)) return [];
  return [{ category: id, label: row.label, nowCents: row.nowCents, expectedCents: row.baseCents, changeCents: row.changeCents, moreCents, purchases: purchases(now).length, peak: spendOf(now) > Math.max(...months), season: row.season, yearAgoCents: row.yearAgoCents }];
}

interface Analysis {
  change: SpendingChange;
  rises: CategoryRise[];
}

/**
 * The change of spending (consumption + debt) in a view, split into causes. `month` is the month the view is about:
 * the month itself for "expected" and "season", the last month of the `yearMonths` (twelve unless a shorter range asks) for "year". null when the history does not
 * support the comparison. The expected level of a category is its own (`expectedFor`: its months' mean with one-offs
 * struck and bills of a rare cadence in their own month), so a deposit, a repayment or a trip in one base month does not
 * move it. The expected total is the sum of the categories, the figure every view of the month calls "odotettu".
 */
export function spendingChange(ctx: AnalysisContext, view: ChangeView, month: string, yearMonths = 12): SpendingChange | null {
  return analyse(ctx, view, month, yearMonths)?.change ?? null;
}

/**
 * The categories of `month` that rose by more of the same, read from the usual view the report shows for that month.
 * null when the history gives the month no usual view.
 */
export function categoryRises(ctx: AnalysisContext, month: string): MonthRises | null {
  const a = analyse(ctx, "expected", month);
  return a && { running: a.change.running, through: a.change.target.to, gateCents: a.change.gateCents, rises: a.rises };
}

function analyse(ctx: AnalysisContext, view: ChangeView, month: string, yearMonths = 12): Analysis | null {
  const plan = planOf(ctx, view, month, yearMonths);
  if (!plan) return null;
  const base = rowsFor(ctx, plan);
  // the expected categories join those with rows: a bill due this month is expected where no row of the base month has it
  const ids = [...new Set([...base.target, ...base.baseByMonth.flat()].map((t) => t.category).concat([...(base.expected?.byCategory.keys() ?? [])]))].sort();
  const baseTotal = base.expected ? base.expected.totalCents : sum(ids.map((id) => sum(base.baseByMonth.map((rows) => spendOf(rows.filter((t) => t.category === id))))));
  const nowTotal = spendOf(base.target);
  const months = plan.target.length;
  // the gate of a month against the base of a month, so a year's base is divided by its months
  const r: Rows = { ...base, gate: gateFor(plan.mean ? baseTotal : baseTotal / months) * months };
  const pieces: ChangePiece[] = [];
  // a card bill in the base months that is no transfer: the headline is true, the categories lack the card's purchases
  const itemised = !plan.mean || !cardsBreakUsual(ctx, plan.target[0]!);
  const categories = itemised ? ids.map((id) => categoryChange(r, id, pieces)) : [];
  pieces.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || (a.category ?? "").localeCompare(b.category ?? "") || a.kind.localeCompare(b.kind));

  const ranked = categories
    .filter((c) => c.nowCents !== 0 || c.baseCents !== 0)
    .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || (a.category ?? "").localeCompare(b.category ?? ""));
  const rows = ranked.filter((c) => Math.abs(c.changeCents) >= MIN_ROW_CENTS).slice(0, MAX_CATEGORIES);
  const rest = ranked.filter((c) => !rows.includes(c));
  if (rest.length) rows.push(smallerRow(rest, pieces, r.gate));

  const change: SpendingChange = {
    view,
    target: windowOf(ctx, plan.target, plan.running ? plan.cap : null),
    base: windowOf(ctx, plan.base, plan.running ? plan.cap : null),
    running: plan.running,
    nowCents: nowTotal,
    baseCents: baseTotal,
    changeCents: nowTotal - baseTotal,
    gateCents: r.gate,
    standsOut: totalStandsOut(r, categories, nowTotal, nowTotal - baseTotal),
    categories: rows,
    pieces,
  };
  // every category, also those the table folds into its row of smaller ones: a rise ranked ninth is a rise
  return { change, rises: plan.mean && itemised ? categories.flatMap((row) => riseOf(r, row)) : [] };
}
