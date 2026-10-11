// Decision: is this month a reason to worry
/**
 * Why a month cost more or less than usual. Spending per category is set against that category's usual level
 * (`usualCents` over the complete months before the month), a running month against the same days of those months.
 * The five categories that moved most are named, the rest are one row, and the rows add up to the month's total
 * minus the usual total. A row says what caused the move when the data shows one: a single payment, a bill that
 * came twice or not at all, or a new recurring charge.
 */
import { getCategory } from "../categories.ts";
import { monthIndex, monthOf } from "../dates.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { IsoDate } from "../types.ts";
import { type BucketKind, type ContextIndex, contextIndex, GAP_LABEL, restLabel, spendingChange } from "./change.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { formatEur } from "./format.ts";
import { completeMonthsBefore, MIN_COMPARE_MONTHS, usualCents } from "./usual.ts";

/** At most this many categories are named; the rest are one row. */
const MAX_ROWS = 5;
/** A move under a euro is rounding, not news. */
const MIN_ROW_CENTS = 100;
/** A bill is "usual" when it came in at least this share of the usual months. */
const USUAL_PRESENCE = 2 / 3;
/** A new recurring charge repeats at least this often (days apart); a yearly fee is a payment, not a new habit. */
const NEW_SERIES_MAX_INTERVAL_DAYS = 100;

export type ExplanationCauseKind = "oneoff" | "twice" | "missing" | "new";

export interface ExplanationCause {
  kind: ExplanationCauseKind;
  merchant: string;
  /** The date of the payment, null when the cause is a payment that did not come. */
  date: IsoDate | null;
  /** The payment that explains the move: the one-off, the extra charge, the missing bill, the new charge. */
  amountCents: number;
  /** Ready to show, Finnish. */
  text: string;
}

/** A named category, the row for the smaller ones, or the gap between the category medians and the usual total. */
export type ExplanationRowKind = "category" | "smaller" | "between";

export interface ExplanationRow {
  kind: ExplanationRowKind;
  /** Category id, null for the two rows that are no single category. */
  category: string | null;
  label: string;
  nowCents: number;
  usualCents: number;
  /** now − usual: positive means more than usual. */
  changeCents: number;
  cause: ExplanationCause | null;
  /** The largest cause of the move in whole cents (`spendingChange`, usual view): a dearer ticket, more visits, a new shop. null when no cause passes the gate. */
  driver: { kind: BucketKind; cents: number } | null;
}

export interface MonthExplanation {
  month: string;
  /** The month has not ended: its spending is set against the same days of the usual months. */
  running: boolean;
  /** Spending (consumption + debt) of the month, so far when it is running. */
  nowCents: number;
  /** The usual level of that total. */
  usualCents: number;
  changeCents: number;
  /** The complete months the usual level comes from, oldest first. */
  basis: string[];
  /** The named categories by absolute change, the smaller ones, then the gap row when there is one. Their changes add up to `changeCents`. */
  rows: ExplanationRow[];
}

const dayOfMonth = (t: Pick<AnalysisTx, "bookingDate">) => Number(t.bookingDate.slice(8, 10));
const total = (sums: ReadonlyMap<string, number>) => [...sums.values()].reduce((s, v) => s + v, 0);
/** "2026-09-30" → "30.9." */
const shortDate = (iso: IsoDate) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
/** What a purchase cost in the end: its spending less what came back. */
const netSpend = (t: Pick<AnalysisTx, "spend" | "refunded">) => Math.max(0, t.spend - t.refunded);

interface Basis {
  index: ContextIndex;
  month: string;
  usualMonths: string[];
  running: boolean;
  /** Rows on days after this day of the month are left out: a running month is compared on the days it has had. */
  cap: number;
}

function explain(basis: Basis, category: string, change: number): ExplanationCause | null {
  const { index, month, usualMonths, running, cap } = basis;
  const counted = (t: AnalysisTx) => t.category === category && t.spend !== 0 && dayOfMonth(t) <= cap;
  const monthTxs = (m: string) => index.byMonth.get(monthIndex(m)) ?? [];
  // per usual month: how many charges the series had and what they came to
  const ofSeries = new Map<string, { series: RecurringSeries; usual: number[]; sums: number[]; now: AnalysisTx[] }>();
  const entry = (s: RecurringSeries) => {
    let e = ofSeries.get(s.id);
    if (!e) ofSeries.set(s.id, (e = { series: s, usual: usualMonths.map(() => 0), sums: usualMonths.map(() => 0), now: [] }));
    return e;
  };
  usualMonths.forEach((m, k) => {
    for (const t of monthTxs(m)) {
      const s = index.seriesOf.get(t.id);
      if (!s || !counted(t)) continue;
      const e = entry(s);
      e.usual[k]!++;
      e.sums[k]! += t.spend;
    }
  });
  for (const t of monthTxs(month)) {
    const s = index.seriesOf.get(t.id);
    if (s && counted(t)) entry(s).now.push(t);
  }
  // a cause explains the move when its payment is half of it or more
  const explains = (cents: number) => cents * 2 >= Math.abs(change);
  const sorted = [...ofSeries.values()].sort((a, b) => a.series.merchant.localeCompare(b.series.merchant));

  if (change > 0) {
    // a monthly bill that came more often than in any usual month: paid late and early, or twice
    for (const { series, usual, now } of sorted) {
      const most = Math.max(...usual);
      if (series.cadence !== "monthly" || most < 1 || now.length <= most) continue;
      // the extra ones are the largest: a true-up before the ordinary bill is the cause, the ordinary bill is not
      const extra = [...now].sort((a, b) => b.spend - a.spend || b.bookingDate.localeCompare(a.bookingDate)).slice(0, now.length - most);
      const cents = extra.reduce((s, t) => s + t.spend, 0);
      if (!explains(cents)) continue;
      const when = now.map((t) => shortDate(t.bookingDate));
      const times = now.length === 2 ? "kahdesti" : `${now.length} kertaa`;
      return { kind: "twice", merchant: series.merchant, date: extra[0]!.bookingDate, amountCents: cents, text: `Lasku tuli ${times}: ${series.merchant}, ${when.join(" ja ")}` };
    }
    // a recurring charge that did not exist before the month
    for (const { series, usual, now } of sorted) {
      const cents = now.reduce((s, t) => s + t.spend, 0);
      if (series.firstDate < `${month}-01` || series.intervalDays > NEW_SERIES_MAX_INTERVAL_DAYS || usual.some((c) => c > 0) || !now.length || !explains(cents)) continue;
      return { kind: "new", merchant: series.merchant, date: now[0]!.bookingDate, amountCents: cents, text: `Uusi toistuva maksu: ${series.merchant}, noin ${formatEur(series.monthlyCents, false)} kuussa` };
    }
    // one payment that is half the move or more and larger than anything in the category in the usual months,
    // bills of a recurring series included. A card bill pays purchases made earlier: it is never a purchase itself.
    let biggest: AnalysisTx | null = null;
    if (category !== "card_bill") for (const t of monthTxs(month)) if (counted(t) && !index.seriesOf.has(t.id) && netSpend(t) > (biggest ? netSpend(biggest) : 0)) biggest = t;
    if (biggest && explains(netSpend(biggest))) {
      let before = 0;
      for (const m of usualMonths) for (const t of monthTxs(m)) if (t.category === category) before = Math.max(before, netSpend(t));
      if (netSpend(biggest) > before) {
        const cents = netSpend(biggest);
        return { kind: "oneoff", merchant: biggest.merchant, date: biggest.bookingDate, amountCents: cents, text: `Yksi maksu: ${biggest.merchant}, ${shortDate(biggest.bookingDate)}, ${formatEur(cents)}` };
      }
    }
    return null;
  }

  // a usual bill that has not come: late, stopped, or (in a running month) not due yet. It says the usual figure
  // of the months compared, the one the table shows, not the price of its latest charge.
  for (const { series, usual, sums, now } of sorted) {
    const present = usual.filter((c) => c > 0).length;
    const cents = usualCents(sums) ?? 0;
    if (now.length || present / usual.length < USUAL_PRESENCE || cents <= 0 || !explains(cents)) continue;
    const text = running ? `Lasku ei ole vielä tullut: ${series.merchant}, tavallisesti ${formatEur(cents)}` : `Lasku puuttuu: ${series.merchant}, tavallisesti ${formatEur(cents)}`;
    return { kind: "missing", merchant: series.merchant, date: null, amountCents: cents, text };
  }
  return null;
}

/**
 * What made `month` differ from a usual one. null when fewer than three complete months come before it (the usual
 * level is not defined then), and for a month in the future.
 */
export function explainMonth(ctx: AnalysisContext, month: string): MonthExplanation | null {
  const usualMonths = completeMonthsBefore(ctx, month);
  if (usualMonths.length < MIN_COMPARE_MONTHS) return null;
  const index = contextIndex(ctx);
  const running = month === monthOf(ctx.today);
  const basis: Basis = { index, month, usualMonths, running, cap: running ? Number(ctx.today.slice(8, 10)) : 31 };
  const sums = (m: string) => {
    const out = new Map<string, number>();
    for (const t of index.byMonth.get(monthIndex(m)) ?? []) if (t.spend !== 0 && dayOfMonth(t) <= basis.cap) out.set(t.category, (out.get(t.category) ?? 0) + t.spend);
    return out;
  };
  const now = sums(month);
  const before = usualMonths.map(sums);
  const nowCents = total(now);
  const usualTotal = usualCents(before.map(total)) ?? 0;

  const categories = new Set([...now.keys(), ...before.flatMap((m) => [...m.keys()])]);
  const moves = [...categories]
    .map((category) => {
      const n = now.get(category) ?? 0;
      const u = usualCents(before.map((m) => m.get(category) ?? 0)) ?? 0;
      return { category, nowCents: n, usualCents: u, changeCents: n - u };
    })
    // a category that was used once in six months has a usual level of nothing and is not in this month either
    .filter((x) => x.nowCents !== 0 || x.usualCents !== 0)
    .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.category.localeCompare(b.category));
  const named = moves.filter((x) => Math.abs(x.changeCents) >= MIN_ROW_CENTS).slice(0, MAX_ROWS);
  const split = spendingChange(ctx, "usual", month);
  const driverOf = (category: string) => split?.categories.find((c) => c.category === category)?.buckets.find((b) => b.kind !== "spread") ?? null;
  const rows: ExplanationRow[] = named.map((x) => ({ ...x, kind: "category", label: getCategory(x.category).label, cause: explain(basis, x.category, x.changeCents), driver: driverOf(x.category) }));

  // the categories that did not make the list: their own changes, nothing else
  const rest = moves.filter((x) => !named.includes(x));
  if (rest.length) {
    const sum = (key: "nowCents" | "usualCents" | "changeCents") => rest.reduce((s, x) => s + x[key], 0);
    rows.push({ kind: "smaller", category: null, label: restLabel(rest.length), nowCents: sum("nowCents"), usualCents: sum("usualCents"), changeCents: sum("changeCents"), cause: null, driver: null });
  }

  // The medians of the categories do not add up to the median of the total: a category that is high in one month is
  // low in another, and the months differ between categories. Without this row the gap would sit in a category row
  // and say something false (one month with only the usual groceries is 300 € below its usual total, and no
  // category moved). A gap under a euro is the rounding of the medians and goes into the last row.
  const gap = usualTotal - moves.reduce((s, x) => s + x.usualCents, 0);
  if (Math.abs(gap) >= MIN_ROW_CENTS || (gap !== 0 && !rows.length)) {
    rows.push({ kind: "between", category: null, label: GAP_LABEL, nowCents: 0, usualCents: gap, changeCents: -gap, cause: null, driver: null });
  } else if (gap !== 0) {
    const last = rows[rows.length - 1]!;
    last.usualCents += gap;
    last.changeCents -= gap;
  }
  return { month, running, nowCents, usualCents: usualTotal, changeCents: nowCents - usualTotal, basis: usualMonths, rows };
}
