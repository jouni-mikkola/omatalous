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
 * The usual level of a category is a median, and medians do not add up, so the merchants' mean base differs from it
 * by a bucket of its own (`spread`). That bucket is the only one that is no cause.
 */
import { getCategory } from "../categories.ts";
import { addMonths, daysInMonth, fromMonthIndex, monthIndex, monthOf } from "../dates.ts";
import type { RecurringSeries } from "../recurring.ts";
import { pairedReturns } from "../returns.ts";
import { median } from "../stats.ts";
import { normalizeIban } from "../transfers.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { completeMonthsBefore, isCompleteMonth, MIN_COMPARE_MONTHS, usualCents } from "./usual.ts";

export type ChangeView = "usual" | "year" | "season";
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

/** A named category, the row for the smaller ones, or the gap between the category medians and the usual total. */
export interface CategoryChange {
  kind: "category" | "smaller" | "between";
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
  /** A cause shows on its own at this size or more (10 € and 2 % of the usual monthly spending, for each month of the target). */
  gateCents: number;
  categories: CategoryChange[];
  pieces: ChangePiece[];
}

const GATE_MIN_CENTS = 1000;
const GATE_SHARE = 0.02;
const MIN_PRICE_VISITS = 3;
const MIN_BASE_ROWS = 4;
const ONE_OFF_MIN_CENTS = 5000;
const ONE_OFF_TICKET_MULTIPLE = 3;
const MAX_CATEGORIES = 8;
const MAX_MERCHANTS = 8;
/** A move under a euro is rounding. */
const MIN_ROW_CENTS = 100;
/** A bill is expected when the base had it in this share of its months. */
const PRESENCE = 2 / 3;
/** Bills that come less often than every month: in an ordinary month they are not expected. */
const RARE = new Set(["quarterly", "semiannual", "yearly"]);

export interface ContextIndex {
  byMonth: Map<number, AnalysisTx[]>;
  /** Transactions of subscriptions and bills (the fixed costs) to their series. */
  seriesOf: Map<string, RecurringSeries>;
  /** A returning row to the purchase it cancels (the pairing that set `refunded`). */
  returns: Map<string, string>;
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
  const ownIbans = new Set(ctx.accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  index = { byMonth, seriesOf, returns: pairedReturns(ctx.txs, ownIbans) };
  indexes.set(ctx, index);
  return index;
}

/** The row for the categories under the gate together, here and in the month explanation. */
export const restLabel = (count: number) => `Muut (${count})`;
/** The row that holds the gap between the usual total and the sum of the usual categories. */
export const GAP_LABEL = "Tasauserä";
export const GAP_HELP = "Tavallisen kuukauden summan ja tavallisten kategorioiden summan erotus.";

const LABEL: Record<BucketKind, string> = { oneoff: "Kertaosto", timing: "Ajoitus", new: "Uudet kaupat", stopped: "Ostot jääneet pois", price: "Kalliimpi ostoskerta", volume: "Useammin", spread: "Kuukausien vaihtelu", other: "Ei eriteltyä syytä" };

export function bucketLabel(kind: BucketKind, cents: number): string {
  if (cents < 0 && kind === "price") return "Halvempi ostoskerta";
  return cents < 0 && kind === "volume" ? "Harvemmin" : LABEL[kind];
}

interface Plan {
  view: ChangeView;
  target: string[];
  base: string[];
  /** Rows on later days of the month are left out: a running month is compared on the days it has had. */
  cap: number;
  running: boolean;
  /** The base is the mean of several months (the usual view). Otherwise it is the sum over as many months as the target. */
  mean: boolean;
}

const dayOfMonth = (t: Pick<AnalysisTx, "bookingDate">) => Number(t.bookingDate.slice(8, 10));
const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const spendOf = (rows: readonly AnalysisTx[]) => sum(rows.map((t) => t.spend));
/** What a purchase cost in the end: its spending less what came back. */
const netSpend = (t: Pick<AnalysisTx, "spend" | "refunded">) => Math.max(0, t.spend - t.refunded);
const purchases = (rows: readonly AnalysisTx[]) => rows.filter((t) => t.spend > 0);

/**
 * A purchase and the return of it in the same rows count once, at what stays: a bought and returned TV is no cause,
 * and a part that was kept is one purchase of that size. The rows add up as before, so no category total moves.
 */
function netReturns(rows: AnalysisTx[], returns: ReadonlyMap<string, string>): AnalysisTx[] {
  const byId = new Map(rows.map((t) => [t.id, t]));
  const back = new Map<string, number>();
  const gone = new Set<string>();
  for (const t of rows) {
    const p = byId.get(returns.get(t.id) ?? "");
    if (!p || p.category !== t.category || p.spend <= 0 || t.spend >= 0) continue;
    back.set(p.id, (back.get(p.id) ?? 0) + t.spend);
    gone.add(t.id);
  }
  if (!gone.size) return rows;
  return rows.filter((t) => !gone.has(t.id)).map((t) => (back.has(t.id) ? { ...t, spend: t.spend + back.get(t.id)!, refunded: 0 } : t)).filter((t) => t.spend !== 0);
}

/**
 * The periods of a view for `month`: the month itself (usual and season) or the month the last twelve end in (year).
 * null when the history cannot support the comparison: under three complete months before, no complete month a year
 * earlier, or under three months to compare.
 */
function planOf(ctx: AnalysisContext, view: ChangeView, month: string): Plan | null {
  const thisMonth = monthOf(ctx.today);
  if (month > thisMonth) return null;
  const running = month === thisMonth;
  const cap = running ? Number(ctx.today.slice(8, 10)) : 31;
  if (view === "usual") {
    const base = completeMonthsBefore(ctx, month);
    return base.length < MIN_COMPARE_MONTHS ? null : { view, target: [month], base, cap, running, mean: true };
  }
  if (view === "season") {
    const base = addMonths(month, -12);
    return isCompleteMonth(ctx, base) ? { view, target: [month], base: [base], cap, running, mean: false } : null;
  }
  if (!isCompleteMonth(ctx, month) || !ctx.dataFrom) return null;
  let first = monthIndex(monthOf(ctx.dataFrom));
  while (!isCompleteMonth(ctx, fromMonthIndex(first)) && first < monthIndex(month)) first++;
  // a month of the target pairs with the month twelve earlier, which must be complete
  const k = Math.min(12, monthIndex(month) - 12 - first + 1);
  if (k < MIN_COMPARE_MONTHS) return null;
  const target = Array.from({ length: k }, (_, i) => addMonths(month, i - k + 1));
  return { view, target, base: target.map((m) => addMonths(m, -12)), cap: 31, running: false, mean: false };
}

/** `totals` (whole cents over n months) as per-month cents that add up to round(total / n), the rest going to the largest remainders. */
function apportion(totals: readonly number[], n: number): number[] {
  const floors = totals.map((v) => Math.floor(v / n));
  let left = Math.round(sum(totals) / n) - sum(floors);
  const order = totals.map((_, i) => i).sort((a, b) => totals[b]! - floors[b]! * n - (totals[a]! - floors[a]! * n) || a - b);
  const out = [...floors];
  for (const i of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

interface Facts {
  category: string;
  /** The category's change: target − base level. */
  change: number;
  /** The largest single base payment in the category. */
  maxBase: number;
  restricted: boolean;
}

interface Merch {
  name: string;
  target: AnalysisTx[];
  base: AnalysisTx[];
  baseCents: number;
  /** Purchases in the base, per base period. */
  baseVisits: number;
}

type Split = Partial<Record<BucketKind, number>>;

function splitMerchant(m: Merch, f: Facts, plan: Plan, n: number, seriesOf: ReadonlyMap<string, RecurringSeries>): Split {
  const out: Split = {};
  const add = (kind: BucketKind, cents: number) => {
    if (cents) out[kind] = (out[kind] ?? 0) + cents;
  };
  let rest = m.target;
  // 1. one-off: with a usual ticket (three base visits) a payment of three times it and 50 €. Without one, half of
  // the category's rise and above anything the base had (the rule of the month explanation).
  const tickets = purchases(m.base).map((t) => t.spend);
  const usualTicket = tickets.length >= MIN_PRICE_VISITS ? median(tickets) : null;
  if (f.category !== "card_bill") {
    const isOneOff = (t: AnalysisTx) =>
      usualTicket !== null ? netSpend(t) > ONE_OFF_TICKET_MULTIPLE * usualTicket && netSpend(t) >= ONE_OFF_MIN_CENTS : f.change > 0 && netSpend(t) * 2 >= f.change && netSpend(t) > f.maxBase;
    const one = new Set(rest.filter((t) => t.spend > 0 && !seriesOf.has(t.id) && isOneOff(t)));
    add("oneoff", spendOf([...one]));
    rest = rest.filter((t) => !one.has(t));
  }
  let now = spendOf(rest);
  let visits = purchases(rest).length;
  let base = m.baseCents;
  let baseVisits = m.baseVisits;

  // 2. timing: a bill that came more often than the period expects, or not at all
  const groups = new Map<string, { series: RecurringSeries; now: AnalysisTx[]; base: AnalysisTx[] }>();
  const group = (s: RecurringSeries) => groups.get(s.id) ?? (groups.set(s.id, { series: s, now: [], base: [] }), groups.get(s.id)!);
  for (const t of purchases(rest)) if (seriesOf.has(t.id)) group(seriesOf.get(t.id)!).now.push(t);
  for (const t of purchases(m.base)) if (seriesOf.has(t.id)) group(seriesOf.get(t.id)!).base.push(t);
  for (const g of [...groups.values()].sort((a, b) => a.series.id.localeCompare(b.series.id))) {
    const rare = RARE.has(g.series.cadence ?? "");
    if (g.series.cadence !== "monthly" && !rare) continue;
    const expected = rare ? (plan.mean ? 0 : g.base.length) : plan.target.length;
    if (g.now.length > expected) {
      const extra = [...g.now].sort((a, b) => b.spend - a.spend || b.bookingDate.localeCompare(a.bookingDate) || a.id.localeCompare(b.id)).slice(0, g.now.length - expected);
      add("timing", spendOf(extra));
      now -= spendOf(extra);
      visits -= extra.length;
    } else if (g.now.length < expected && g.series.active && (plan.mean ? g.base.length / n : g.base.length) >= PRESENCE * expected) {
      const missing = expected - g.now.length;
      const cents = Math.min(Math.round((missing * spendOf(g.base)) / g.base.length), Math.max(0, base));
      add("timing", -cents);
      base -= cents;
      baseVisits = Math.max(0, baseVisits - missing);
    }
  }

  // 3. the rest of the change
  const tail = now - base;
  if (f.restricted) add("other", tail);
  else if (base === 0 && baseVisits === 0) add(visits > 0 ? "new" : "other", tail);
  else if (visits === 0) add("stopped", tail);
  else if (visits >= MIN_PRICE_VISITS && purchases(m.base).length >= MIN_PRICE_VISITS && base > 0 && baseVisits > 0) {
    // price on the visits now, volume on the base ticket: together exactly the change
    const price = now - Math.round((visits * base) / baseVisits);
    add("price", price);
    add("volume", tail - price);
  } else if (visits === 1 && baseVisits >= 0.5 && baseVisits <= 1.5) add("price", tail); // one charge each period: a bill whose amount moved
  else add("volume", tail);
  return out;
}

const bucketList = (split: Split): Bucket[] =>
  (Object.entries(split) as [BucketKind, number][])
    .filter(([, cents]) => cents !== 0)
    .map(([kind, cents]) => ({ kind, cents }))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.kind.localeCompare(b.kind));

function addSplit(into: Split, from: Split): void {
  for (const [kind, cents] of Object.entries(from) as [BucketKind, number][]) into[kind] = (into[kind] ?? 0) + cents;
}

/** The causes at or over the gate, and the others together. */
function gated(split: Split, gate: number): Pick<CategoryChange, "buckets" | "restCents" | "restCount"> {
  const all = bucketList(split);
  const small = all.filter((b) => Math.abs(b.cents) < gate);
  return { buckets: all.filter((b) => Math.abs(b.cents) >= gate), restCents: sum(small.map((b) => b.cents)), restCount: small.length };
}

const windowOf = (ctx: AnalysisContext, months: string[], cut: number | null): ChangeWindow => {
  const last = months[months.length - 1]!;
  const end = `${last}-${String(cut !== null ? Math.min(cut, daysInMonth(last)) : daysInMonth(last)).padStart(2, "0")}`;
  return { months, from: `${months[0]}-01`, to: end < ctx.today ? end : ctx.today };
};

/**
 * The change of spending (consumption + debt) in a view, split into causes. `month` is the month the view is about:
 * the month itself for "usual" and "season", the last month of the twelve for "year". null when the history does not
 * support the comparison.
 */
export function spendingChange(ctx: AnalysisContext, view: ChangeView, month: string): SpendingChange | null {
  const plan = planOf(ctx, view, month);
  if (!plan) return null;
  const { byMonth, seriesOf, returns } = contextIndex(ctx);
  const rowsOf = (m: string) => (byMonth.get(monthIndex(m)) ?? []).filter((t) => t.spend !== 0 && dayOfMonth(t) <= plan.cap);
  const targetRows = netReturns(plan.target.flatMap(rowsOf), returns);
  // the usual level is a median of months, so a pair nets inside its month; otherwise over the whole base period
  const baseByMonth = plan.mean ? plan.base.map((m) => netReturns(rowsOf(m), returns)) : [netReturns(plan.base.flatMap(rowsOf), returns)];
  const n = plan.mean ? plan.base.length : 1;
  const months = plan.target.length;

  const baseTotal = plan.mean ? (usualCents(baseByMonth.map(spendOf)) ?? 0) : sum(baseByMonth.map(spendOf));
  const nowTotal = spendOf(targetRows);
  const gateCents = Math.max(GATE_MIN_CENTS, Math.round((GATE_SHARE * baseTotal) / (plan.mean ? 1 : months))) * months;

  // a year ago, for the season mark of the usual view
  const yearAgo = plan.view === "usual" && isCompleteMonth(ctx, addMonths(month, -12)) ? rowsOf(addMonths(month, -12)) : null;
  const yearAgoBy = new Map<string, number>();
  for (const t of yearAgo ?? []) yearAgoBy.set(t.category, (yearAgoBy.get(t.category) ?? 0) + t.spend);

  const ids = new Set([...targetRows, ...baseByMonth.flat()].map((t) => t.category));
  const categories: CategoryChange[] = [];
  const pieces: ChangePiece[] = [];
  for (const id of [...ids].sort()) {
    const target = targetRows.filter((t) => t.category === id);
    const baseMonths = baseByMonth.map((rows) => rows.filter((t) => t.category === id));
    const flatBase = baseMonths.flat();
    const baseCents = plan.mean ? (usualCents(baseMonths.map(spendOf)) ?? 0) : spendOf(flatBase);
    const nowCents = spendOf(target);
    const facts: Facts = { category: id, change: nowCents - baseCents, maxBase: flatBase.reduce((mx, t) => Math.max(mx, netSpend(t)), 0), restricted: purchases(flatBase).length < MIN_BASE_ROWS || getCategory(id).kind === "debt" };

    const byName = new Map<string, Merch>();
    const merch = (name: string) => byName.get(name) ?? (byName.set(name, { name, target: [], base: [], baseCents: 0, baseVisits: 0 }), byName.get(name)!);
    for (const t of target) merch(t.merchant).target.push(t);
    // a bill of a rare cadence is not part of an ordinary month, so it is not in the mean base
    for (const t of flatBase) if (!(plan.mean && RARE.has(seriesOf.get(t.id)?.cadence ?? ""))) merch(t.merchant).base.push(t);
    const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    const shares = plan.mean ? apportion(list.map((m) => spendOf(m.base)), n) : list.map((m) => spendOf(m.base));
    list.forEach((m, i) => {
      m.baseCents = shares[i]!;
      m.baseVisits = purchases(m.base).length / n;
    });

    const total: Split = {};
    const items = list.map((m): MerchantChange & { split: Split } => {
      const split = splitMerchant(m, facts, plan, n, seriesOf);
      addSplit(total, split);
      const now = spendOf(m.target);
      const visitsNow = purchases(m.target).length;
      return {
        kind: "merchant",
        label: m.name,
        nowCents: now,
        baseCents: m.baseCents,
        changeCents: now - m.baseCents,
        visitsNow,
        visitsBase: Math.round(m.baseVisits * 10) / 10,
        ticketNowCents: visitsNow ? Math.round(now / visitsNow) : null,
        ticketBaseCents: m.baseVisits > 0 ? Math.round(m.baseCents / m.baseVisits) : null,
        buckets: bucketList(split),
        split,
      };
    });
    // the merchants' base is a mean, the category's usual level a median: the difference is a bucket, not a cause
    const spread = sum(shares) - baseCents;
    addSplit(total, spread ? { spread } : {});

    items.sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.label.localeCompare(b.label));
    const shown = items.filter((m) => Math.abs(m.changeCents) >= gateCents).slice(0, MAX_MERCHANTS);
    const small = items.filter((m) => !shown.includes(m));
    const merchants: MerchantChange[] = shown.map(({ split: _s, ...m }) => m);
    if (small.length) {
      const split: Split = {};
      for (const m of small) addSplit(split, m.split);
      const s = (key: "nowCents" | "baseCents" | "visitsNow") => sum(small.map((m) => m[key]));
      merchants.push({ kind: "smaller", label: restLabel(small.length), nowCents: s("nowCents"), baseCents: s("baseCents"), changeCents: s("nowCents") - s("baseCents"), visitsNow: s("visitsNow"), visitsBase: 0, ticketNowCents: null, ticketBaseCents: null, buckets: bucketList(split) });
    }
    if (spread) merchants.push({ kind: "spread", label: bucketLabel("spread", spread), nowCents: 0, baseCents: 0, changeCents: spread, visitsNow: 0, visitsBase: 0, ticketNowCents: null, ticketBaseCents: null, buckets: [{ kind: "spread", cents: spread }] });

    const both = items.filter((m) => m.visitsNow > 0 && m.baseCents > 0);
    const ya = yearAgo ? (yearAgoBy.get(id) ?? 0) : null;
    const change = nowCents - baseCents;
    const season = ya !== null && Math.sign(ya - baseCents) === Math.sign(change) && Math.abs(ya - baseCents) * 2 >= Math.abs(change) && Math.abs(change) >= gateCents;
    for (const b of bucketList(total)) pieces.push({ category: id, kind: b.kind, cents: b.cents, season });
    categories.push({
      kind: "category",
      category: id,
      label: getCategory(id).label,
      nowCents,
      baseCents,
      changeCents: change,
      ...gated(total, gateCents),
      visitsNow: purchases(target).length,
      visitsBase: Math.round((purchases(flatBase).length / n) * 10) / 10,
      sameShopsNowCents: sum(both.map((m) => m.nowCents)),
      sameShopsBaseCents: sum(both.map((m) => m.baseCents)),
      sameShopsVisitsNow: sum(both.map((m) => m.visitsNow)),
      sameShopsVisitsBase: sum(both.map((m) => m.visitsBase)),
      yearAgoCents: ya,
      season,
      merchants,
    });
  }

  // The medians of the categories do not add up to the median of the total: this gap is a row and a piece of its own
  const gap = plan.mean ? baseTotal - sum(categories.map((c) => c.baseCents)) : 0;
  if (gap) pieces.push({ category: null, kind: "spread", cents: -gap, season: false });
  pieces.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || (a.category ?? "").localeCompare(b.category ?? "") || a.kind.localeCompare(b.kind));

  const ranked = categories
    .filter((c) => c.nowCents !== 0 || c.baseCents !== 0)
    .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || (a.category ?? "").localeCompare(b.category ?? ""));
  const rows = ranked.filter((c) => Math.abs(c.changeCents) >= MIN_ROW_CENTS).slice(0, MAX_CATEGORIES);
  const rest = ranked.filter((c) => !rows.includes(c));
  if (rest.length) {
    const split: Split = {};
    const ids = new Set(rest.map((c) => c.category));
    for (const p of pieces) if (p.category !== null && ids.has(p.category)) split[p.kind] = (split[p.kind] ?? 0) + p.cents;
    const s = (key: "nowCents" | "baseCents" | "changeCents" | "visitsNow" | "visitsBase" | "sameShopsNowCents" | "sameShopsBaseCents" | "sameShopsVisitsNow" | "sameShopsVisitsBase") => sum(rest.map((c) => c[key]));
    rows.push({ kind: "smaller", category: null, label: restLabel(rest.length), nowCents: s("nowCents"), baseCents: s("baseCents"), changeCents: s("changeCents"), ...gated(split, gateCents), visitsNow: s("visitsNow"), visitsBase: s("visitsBase"), sameShopsNowCents: s("sameShopsNowCents"), sameShopsBaseCents: s("sameShopsBaseCents"), sameShopsVisitsNow: s("sameShopsVisitsNow"), sameShopsVisitsBase: s("sameShopsVisitsBase"), yearAgoCents: null, season: false, merchants: [] });
  }
  if (Math.abs(gap) >= MIN_ROW_CENTS || (gap !== 0 && !rows.length)) {
    rows.push({ kind: "between", category: null, label: GAP_LABEL, nowCents: 0, baseCents: gap, changeCents: -gap, buckets: [{ kind: "spread", cents: -gap }], restCents: 0, restCount: 0, visitsNow: 0, visitsBase: 0, sameShopsNowCents: 0, sameShopsBaseCents: 0, sameShopsVisitsNow: 0, sameShopsVisitsBase: 0, yearAgoCents: null, season: false, merchants: [] });
  } else if (gap !== 0) {
    // a gap under a euro is the rounding of the medians and goes into the last row
    const last = rows[rows.length - 1]!;
    last.baseCents += gap;
    last.changeCents -= gap;
    last.restCents -= gap;
    last.restCount += 1;
  }

  return {
    view,
    target: windowOf(ctx, plan.target, plan.running ? plan.cap : null),
    base: windowOf(ctx, plan.base, plan.running ? plan.cap : null),
    running: plan.running,
    nowCents: nowTotal,
    baseCents: baseTotal,
    changeCents: nowTotal - baseTotal,
    gateCents,
    categories: rows,
    pieces,
  };
}
