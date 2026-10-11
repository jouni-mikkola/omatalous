/**
 * The causes of one merchant's change in the spending change (change.ts): one-off, timing, new, stopped, price and
 * volume, in whole cents that add up to the merchant's change.
 */
import type { RecurringSeries } from "../recurring.ts";
import type { Bucket, BucketKind, CategoryChange } from "./change.ts";
import type { Plan } from "./change-plan.ts";
import type { AnalysisTx } from "./context.ts";

export const MIN_PRICE_VISITS = 3;
export const MIN_BASE_ROWS = 4;
/** A bill is expected when the base had it in this share of its months. */
const PRESENCE = 2 / 3;
/** Bills that come less often than every month: in an ordinary month they are not expected. */
export const RARE = new Set(["quarterly", "semiannual", "yearly"]);

export const dayOfMonth = (t: Pick<AnalysisTx, "bookingDate">) => Number(t.bookingDate.slice(8, 10));
export const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
export const spendOf = (rows: readonly AnalysisTx[]) => sum(rows.map((t) => t.spend));
export const purchases = (rows: readonly AnalysisTx[]) => rows.filter((t) => t.spend > 0);

/**
 * A purchase and the return of it in the same rows count once, at what stays: a bought and returned TV is no cause,
 * and a part that was kept is one purchase of that size. The rows add up as before, so no category total moves.
 */
export function netReturns(rows: AnalysisTx[], returns: ReadonlyMap<string, string>): AnalysisTx[] {
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

/** `totals` (whole cents over n months) as per-month cents that add up to round(total / n), the rest going to the largest remainders. */
export function apportion(totals: readonly number[], n: number): number[] {
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

export interface Facts {
  category: string;
  /** The category's change: target − base level. */
  change: number;
  /** The one-offs of the target and the base (`oneOffs`, the level policy). */
  oneOffs: ReadonlySet<string>;
  restricted: boolean;
}

export interface Merch {
  name: string;
  target: AnalysisTx[];
  base: AnalysisTx[];
  baseCents: number;
  /** Purchases in the base, per base period. */
  baseVisits: number;
}

export type Split = Partial<Record<BucketKind, number>>;

export function splitMerchant(m: Merch, f: Facts, plan: Plan, n: number, seriesOf: ReadonlyMap<string, RecurringSeries>): Split {
  const out: Split = {};
  const add = (kind: BucketKind, cents: number) => {
    if (cents) out[kind] = (out[kind] ?? 0) + cents;
  };
  let rest = m.target;
  // 1. one-off: the level policy every view strikes with (one-offs.ts)
  const one = rest.filter((t) => t.spend > 0 && !seriesOf.has(t.id) && f.oneOffs.has(t.id));
  add("oneoff", spendOf(one));
  rest = rest.filter((t) => !one.includes(t));
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

export const bucketList = (split: Split): Bucket[] =>
  (Object.entries(split) as [BucketKind, number][])
    .filter(([, cents]) => cents !== 0)
    .map(([kind, cents]) => ({ kind, cents }))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.kind.localeCompare(b.kind));

export function addSplit(into: Split, from: Split): void {
  for (const [kind, cents] of Object.entries(from) as [BucketKind, number][]) into[kind] = (into[kind] ?? 0) + cents;
}

/** The causes at or over the gate, and the others together. */
export function gated(split: Split, gate: number): Pick<CategoryChange, "buckets" | "restCents" | "restCount"> {
  const all = bucketList(split);
  const small = all.filter((b) => Math.abs(b.cents) < gate);
  return { buckets: all.filter((b) => Math.abs(b.cents) >= gate), restCents: sum(small.map((b) => b.cents)), restCount: small.length };
}
