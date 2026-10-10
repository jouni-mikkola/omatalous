import { getCategory } from "../categories.ts";
import { daysBetween, daysInMonth, fromMonthIndex, monthIndex } from "../dates.ts";
import { priceChangeYearlyCents, type RecurringSeries } from "../recurring.ts";
import { median } from "../stats.ts";
import type { Alert } from "./alerts.ts";
import { type AnalysisContext, type AnalysisTx, historyCovers, isPurchase, recurringAt } from "./context.ts";
import type { CategoryTotal } from "./dashboard.ts";
import type { PeriodTotals } from "./flows.ts";
import { finnishList, formatEur, formatFiDate } from "./format.ts";
import type { DateRange } from "./period.ts";

export type InsightTone = "good" | "warning" | "info";

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
}

const MAX_INSIGHTS = 5;

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

/** Spending kinds: a price change in a fund saving is not a price. */
const isSpendingSeries = (s: RecurringSeries) => {
  const kind = getCategory(s.category).kind;
  return kind === "expense" || kind === "debt";
};

/** A share of income on debt service above this is a warning (a common bank limit for all loans). */
const DEBT_WARNING_SHARE = 0.35;
/** A purchase below this is not news on its own. */
const LARGEST_MIN_CENTS = 20000;
const SWING_BASE_MONTHS = 6;
const SWING_MIN_BASE_MONTHS = 3;

/** Day care, after-school clubs, music lessons and hobby groups pause from June to mid-August. */
const TERM_CATEGORIES = new Set(["kids", "education", "fitness", "entertainment"]);

/** A term fee last paid in May or June and looked at before the autumn term has started billing. */
function summerBreak(s: RecurringSeries, end: string): boolean {
  const lastMonth = Number(s.lastDate.slice(5, 7));
  return TERM_CATEGORIES.has(s.category) && (lastMonth === 5 || lastMonth === 6) && end.slice(0, 4) === s.lastDate.slice(0, 4) && end.slice(5) <= "09-30";
}

/** The month a range covers from its 1st to its last day, or null. */
function wholeMonth(range: DateRange): number | null {
  const month = range.from.slice(0, 7);
  if (!range.from.endsWith("-01") || range.to !== `${month}-${String(daysInMonth(month)).padStart(2, "0")}`) return null;
  return monthIndex(month);
}

interface Swing {
  category: string;
  label: string;
  cents: number;
  base: number;
  /** The base is the usual month, not the previous period. */
  usual: boolean;
}

/**
 * Categories that moved clearly. A month is compared with its usual level,
 * the median of up to six complete months before it, and only when it falls
 * outside every one of them: groceries move ±30 % with the number of
 * Saturdays, and a month after a busy one always looks like a saving. A
 * longer period is compared with the previous one. A running period has no
 * swings: the pace chart shows how the month is going.
 */
function swings(input: Parameters<typeof buildInsights>[0], alerted: ReadonlySet<string | undefined>): Swing[] {
  const { ctx, range, current, previous, categories, comparable } = input;
  if (input.running) return [];
  // mostly bills (electricity, rent): a swing there is a bill paid late or early, not spending
  const fixed = new Map<string, [number, number]>();
  for (const t of [...current, ...previous]) {
    if (!t.spend) continue;
    const e = fixed.get(t.category) ?? [0, 0];
    e[0] += ctx.fixedIds.has(t.id) ? t.spend : 0;
    e[1] += t.spend;
    fixed.set(t.category, e);
  }
  const mostlyBills = (category: string) => {
    const [f, all] = fixed.get(category) ?? [0, 0];
    return all > 0 && f >= 0.8 * all;
  };
  const candidates = categories.filter((c) => c.category !== "other" && !alerted.has(c.category) && !mostlyBills(c.category) && c.count >= 2);
  // a few euros before makes any change look huge ("+648 %")
  const clear = (now: number, base: number) => base >= 2000 && Math.abs(now - base) >= 3000 && Math.abs(now - base) / base >= 0.25;
  // a rise that is one sofa or one car repair is the largest purchase, told on its own
  const largest = new Map<string, number>();
  for (const t of current) if (t.spend > (largest.get(t.category) ?? 0)) largest.set(t.category, t.spend);
  const withoutLargest = (category: string, now: number) => now - (largest.get(category) ?? 0);

  const month = wholeMonth(range);
  if (month !== null) {
    const base: number[] = [];
    for (let m = month - SWING_BASE_MONTHS; m < month; m++) if (historyCovers(ctx, `${fromMonthIndex(m)}-01`)) base.push(m);
    if (base.length < SWING_MIN_BASE_MONTHS) return [];
    const perMonth = new Map<string, Map<number, number>>();
    for (const t of ctx.txs) {
      if (!t.spend || t.month < base[0]! || t.month >= month) continue;
      const e = perMonth.get(t.category) ?? new Map<number, number>();
      e.set(t.month, (e.get(t.month) ?? 0) + t.spend);
      perMonth.set(t.category, e);
    }
    return candidates
      .map((c) => {
        const values = base.map((m) => perMonth.get(c.category)?.get(m) ?? 0);
        const outside = withoutLargest(c.category, c.cents) > Math.max(...values) || c.cents < Math.min(...values);
        return { category: c.category, label: c.label, cents: c.cents, base: median(values), usual: true, outside };
      })
      .filter((s) => s.outside && clear(s.cents, s.base))
      .map(({ outside: _outside, ...s }) => s);
  }

  if (!comparable) return [];
  const previousCounts = new Map<string, number>();
  for (const t of previous) if (t.spend) previousCounts.set(t.category, (previousCounts.get(t.category) ?? 0) + 1);
  // a category with a single charge on either side is a bill that moved dates
  return candidates
    .filter((c) => (previousCounts.get(c.category) ?? 0) >= 2 && clear(c.cents, c.previousCents))
    .filter((c) => c.cents < c.previousCents || clear(withoutLargest(c.category, c.cents), c.previousCents))
    .map((c) => ({ category: c.category, label: c.label, cents: c.cents, base: c.previousCents, usual: false }));
}

/**
 * Short, prioritised observations about the selected period, judged at its
 * end (range.to) so a past month reads as it was then. Each says something
 * about this period: the tiles show the totals, the savings rate and the
 * fixed costs, and the recurring page lists subscriptions and habits, so
 * these do not repeat them. The list is cut to the most important few, and
 * the largest purchase keeps its place.
 */
export function buildInsights(input: {
  ctx: AnalysisContext;
  range: DateRange;
  current: readonly AnalysisTx[];
  previous: readonly AnalysisTx[];
  categories: readonly CategoryTotal[];
  totals: PeriodTotals;
  /** False when the history does not cover the previous period: no swings then. */
  comparable: boolean;
  /** The period reaches today: it is not over, so it has no swings. */
  running?: boolean;
  /** Shown already as alerts: not repeated here. */
  alerts?: readonly Alert[];
}): Insight[] {
  const { ctx, range, current, totals } = input;
  const end = range.to < ctx.today ? range.to : ctx.today;
  const recurring = recurringAt(ctx, range.to);
  const alerted = new Set((input.alerts ?? []).flatMap((a) => [a.merchant, a.category]).filter(Boolean));
  const out: Insight[] = [];

  // 1. the two clearest category swings
  for (const s of swings(input, alerted)
    .sort((a, b) => Math.abs(b.cents - b.base) - Math.abs(a.cents - a.base))
    .slice(0, 2)) {
    const diff = s.cents - s.base;
    out.push({
      id: `swing:${s.category}`,
      tone: diff > 0 ? "warning" : "good",
      title: `${s.label} ${diff > 0 ? "+" : "−"}${Math.abs(pct(diff, s.base))} %`,
      detail: s.usual
        ? `${formatEur(s.cents, false)}, tavallisesti noin ${formatEur(Math.round(s.base / 1000) * 1000 || s.base, false)} kuussa.`
        : `Nyt ${formatEur(s.cents, false)}, edellisellä jaksolla ${formatEur(s.base, false)}.`,
    });
  }

  // 2. price changes inside the period: one by one when few, else together
  const changes = recurring.filter(
    (s) => s.active && s.kind === "subscription" && s.priceChange && s.priceChange.date >= range.from && s.priceChange.date <= range.to && isSpendingSeries(s),
  );
  const rises = changes.filter((s) => s.priceChange!.toCents > s.priceChange!.fromCents);
  const drops = changes.filter((s) => s.priceChange!.toCents < s.priceChange!.fromCents);
  const one = (s: RecurringSeries, up: boolean): Insight => ({
    id: `price:${s.id}`,
    tone: up ? "warning" : "good",
    // a loan instalment has no price, it grows or shrinks
    title: getCategory(s.category).kind === "debt" ? `${s.merchant}: maksu ${up ? "kasvoi" : "pieneni"}` : `${s.merchant}: hinta ${up ? "nousi" : "laski"}`,
    detail: `${formatEur(s.priceChange!.fromCents)} → ${formatEur(s.priceChange!.toCents)} (${formatFiDate(s.priceChange!.date)}).`,
  });
  const yearlyEffect = (s: RecurringSeries) => priceChangeYearlyCents(s)!;
  if (rises.length > 2) {
    const sorted = [...rises].sort((a, b) => yearlyEffect(b) - yearlyEffect(a));
    const total = sorted.reduce((s, x) => s + yearlyEffect(x), 0);
    out.push({
      id: "price-rises",
      tone: "warning",
      title: `${rises.length} hinnankorotusta, +${formatEur(total, false)} vuodessa`,
      detail: `Suurimmat: ${finnishList(sorted.slice(0, 2).map((s) => s.merchant))}.`,
    });
  } else {
    for (const s of rises) out.push(one(s, true));
  }
  const biggestDrop = [...drops].sort((a, b) => yearlyEffect(a) - yearlyEffect(b))[0];
  if (biggestDrop) out.push(one(biggestDrop, false));

  // 3. new regular charges. Near the start of the history everything looks new.
  const dataFrom = ctx.dataFrom ?? range.from;
  for (const s of recurring
    .filter((s) => (s.kind === "subscription" || s.kind === "bill") && s.active && isSpendingSeries(s))
    .filter((s) => daysBetween(s.firstDate, end) <= 75 && daysBetween(dataFrom, s.firstDate) >= 45)
    .slice(0, 2)) {
    out.push({ id: `new:${s.id}`, tone: "info", title: `Uusi toistuva maksu: ${s.merchant}`, detail: `Noin ${formatEur(s.monthlyCents)}/kk, alkaen ${formatFiDate(s.firstDate)}.` });
  }

  // 4. borrowing, and debt service only when it is heavy (a mortgage at 15 % of income is ordinary)
  if (totals.borrowedCents > 0) {
    out.push({ id: "borrowed", tone: "warning", title: `Luottoa nostettu ${formatEur(totals.borrowedCents, false)}`, detail: "" });
  }
  if (totals.incomeCents > 0 && totals.debtCents / totals.incomeCents > DEBT_WARNING_SHARE) {
    out.push({
      id: "debt",
      tone: "warning",
      title: `Velanhoitoon ${pct(totals.debtCents, totals.incomeCents)} % tuloista`,
      detail: `Yhteensä ${formatEur(totals.debtCents, false)}. Yli kolmannes tuloista on paljon.`,
    });
  }

  // 5. a subscription that stopped: two charges missed, and not a school's summer break
  for (const s of recurring) {
    const since = daysBetween(s.lastDate, end);
    if (s.kind === "subscription" && !s.active && since > 2 * s.intervalDays + 5 && since <= 120 && !summerBreak(s, end)) {
      out.push({ id: `stopped:${s.id}`, tone: "info", title: `${s.merchant}: maksut loppuneet?`, detail: `Viimeksi ${formatEur(s.lastAmountCents)}, ${formatFiDate(s.lastDate)}.` });
    }
  }

  // 6. the largest one-off purchase in the period (rent and other fixed costs are known already)
  const largest = current.reduce<AnalysisTx | null>(
    (best, t) => (!ctx.fixedIds.has(t.id) && isPurchase(t) && t.flows.consumption > (best?.flows.consumption ?? 0) ? t : best),
    null,
  );
  if (largest && largest.flows.consumption >= LARGEST_MIN_CENTS) {
    return [
      ...out.slice(0, MAX_INSIGHTS - 1),
      { id: "largest", tone: "info", title: `Suurin ostos: ${formatEur(largest.flows.consumption, false)}`, detail: `${largest.merchant}, ${formatFiDate(largest.bookingDate)}.` },
    ];
  }
  return out.slice(0, MAX_INSIGHTS);
}
