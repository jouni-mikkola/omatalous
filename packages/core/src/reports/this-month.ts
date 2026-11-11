// Decision: whether this month is running over what it usually costs, which days and categories did it, and what the month will end at
import { spendRows } from "../analysis/context.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { expectedFor, quantile } from "../analysis/expected.ts";
import { toDayRange } from "../analysis/period.ts";
import { getCategory } from "../categories.ts";
import { cancelledSubjects, isBillSeries, isCancelled } from "../commitments.ts";
import { categoryLabel } from "../category-names.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { messageIn } from "../messages.ts";
import { daysInMonth, dateIn, monthEnd, monthOf } from "../dates.ts";
import { expectedBillRows } from "../analysis/forecast.ts";
import { projectDates } from "../recurring.ts";
import { CONCLUSION_ROWS, RANGE_HIGH, RANGE_LOW } from "../thresholds.ts";
import type { IsoDate, UserInputs } from "../types.ts";

/** One part of the gap: what was spent, what was expected, and the difference. The `gapCents` of the rows add up to the gap to the cent. */
export interface GapRow {
  /** Category id, or null for the rest row. */
  category: string | null;
  /** The day of the month, or null for a category row and the rest row. */
  day: number | null;
  label: string;
  spentCents: number;
  expectedCents: number;
  gapCents: number;
  /** The largest purchase of a day row, so the day has a name. */
  top?: { merchant: string; cents: number };
}

interface ComingBill {
  date: IsoDate;
  merchant: string;
  category: string;
  /** Positive. */
  cents: number;
  estimate: boolean;
  /** Its day has passed and it is not paid. */
  late: boolean;
}

/** The month-end estimate: what is spent plus the rest of the month as the base months spent it, with the lower and the upper quartile months around it. */
interface MonthEstimate {
  lowCents: number;
  cents: number;
  highCents: number;
}

export interface ThisMonthReport {
  /** The running month, `YYYY-MM`; it is the month of today whatever period the page is set to. */
  month: string;
  day: number;
  daysInMonth: number;
  /** Consumption and debt service on days 1 to `day`. */
  spentCents: number;
  /** What the month is expected to have cost by `day` (`expectedFor`); null without enough history or when a linked card's purchases are missing. */
  expectedCents: number | null;
  /** `spentCents` less `expectedCents`. */
  gapCents: number | null;
  /** The reason there is no expected figure: too little history, or a card's purchases missing. */
  gapReason: "history" | "cards" | null;
  /** The categories that make the gap, largest first, the rest in one row; they add up to `gapCents`. */
  categories: GapRow[];
  /** The days that make the gap, largest first, the rest in one row; they add up to `gapCents`. */
  days: GapRow[];
  /** What is still to leave: the rest of the month as the base months spent it (the expected month less the expected so far) and the late bills the spending lacks. null without an expected figure. */
  stillComingCents: number | null;
  /** The bills the recurring series still expect this month and the late ones , named for the reader. The base months already hold such bills, so they are not added to `stillComingCents`; a late one of this month is added to it as far as the expected figure to date holds it and the spending lacks it. */
  bills: ComingBill[];
  billsCents: number;
  /** The listed bills dated before this month (overdue): they are in `billsCents` and not in `stillComingCents`. */
  earlierBillsCents: number;
  /** `stillComingCents` less the listed bills of this month: what the rest of the month holds besides them (negative when the bills are more than the base months' rest). null without an expected figure. */
  otherComingCents: number | null;
  /** null without an expected figure, and on the last day. */
  estimate: MonthEstimate | null;
}

/** The largest rows first, by size of the gap, and what is left in one row so the rows add up to `total`. */
function topRows(rows: GapRow[], total: number, rest: string): GapRow[] {
  const sorted = rows.filter((r) => r.gapCents !== 0).sort((a, b) => Math.abs(b.gapCents) - Math.abs(a.gapCents) || a.label.localeCompare(b.label));
  const shown = sorted.slice(0, CONCLUSION_ROWS);
  const left = shown.reduce((s, r) => ({ spent: s.spent - r.spentCents, expected: s.expected - r.expectedCents }), { spent: rows.reduce((s, r) => s + r.spentCents, 0), expected: rows.reduce((s, r) => s + r.expectedCents, 0) });
  const gap = total - shown.reduce((s, r) => s + r.gapCents, 0);
  return gap === 0 && left.spent === 0 && left.expected === 0 ? shown : [...shown, { category: null, day: null, label: rest, spentCents: left.spent, expectedCents: left.expected, gapCents: gap }];
}

/** The running month of `ctx.today`, set against its expected level day by day. */
export function thisMonthReport(ctx: AnalysisContext, inputs: UserInputs, lang: Language = DEFAULT_LANGUAGE): ThisMonthReport {
  const month = monthOf(ctx.today);
  const day = Number(ctx.today.slice(8, 10));
  const days = daysInMonth(month);
  const rows = spendRows(ctx, toDayRange({ from: `${month}-01`, to: ctx.today })).filter((t) => t.spend !== 0);
  const byDay = new Array<number>(days).fill(0);
  const byCategory = new Map<string, number>();
  const topOfDay = new Map<number, { merchant: string; cents: number }>();
  for (const t of rows) {
    const d = Number(t.bookingDate.slice(8, 10));
    byDay[d - 1]! += t.spend;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.spend);
    if (t.spend > (topOfDay.get(d)?.cents ?? 0)) topOfDay.set(d, { merchant: t.merchant, cents: t.spend });
  }
  const spentCents = byDay.reduce((s, v) => s + v, 0);

  const cancelled = cancelledSubjects(inputs, ctx.today);
  const to = monthEnd(month);
  const from = dateIn(month, 1);
  // a bill of a live series not yet charged: an overdue one stays on the list whatever month its day was in, a coming one is projected into the month
  const bills: ComingBill[] = [];
  for (const sr of ctx.recurring) {
    if (!isBillSeries(sr) || isCancelled(cancelled, sr) || !sr.active) continue;
    const estimate = sr.kind === "bill";
    const row = (date: string) => ({ date, merchant: sr.merchant, category: sr.category, cents: sr.typicalAmountCents, estimate, late: date < ctx.today });
    if (sr.overdue && sr.nextDate) {
      if (sr.nextDate <= to) bills.push(row(sr.nextDate));
      continue;
    }
    for (const d of projectDates(sr, to)) if (d >= from || month === monthOf(ctx.today)) bills.push(row(d));
  }
  // a typed-in bill due from today to the month's end that is unpaid and carried by no series; the base months do not hold it
  const typed: ComingBill[] = expectedBillRows(ctx, inputs.expectedBills, ctx.today, to).map((r) => ({ date: r.date, merchant: r.name, category: r.category ?? "other", cents: r.amountCents, estimate: false, late: false }));
  const typedCents = typed.reduce((s, b) => s + b.cents, 0);
  const recurringBills = [...bills];
  bills.push(...typed);
  bills.sort((a, b) => Number(b.late) - Number(a.late) || a.date.localeCompare(b.date) || b.cents - a.cents);
  const billsCents = bills.reduce((s, b) => s + b.cents, 0);
  const earlierBillsCents = bills.filter((b) => b.date < from).reduce((s, b) => s + b.cents, 0);
  const none = { month, day, daysInMonth: days, spentCents, bills, billsCents, categories: [], days: [], stillComingCents: null, otherComingCents: null, earlierBillsCents, estimate: null };

  const figure = expectedFor(ctx, month);
  if (!figure || !figure.itemised) return { ...none, expectedCents: null, gapCents: null, gapReason: figure ? "cards" : "history" };

  const now = figure.at(day);
  const whole = figure.at(days);
  const gapCents = spentCents - now.cents;

  const expectedOf = new Map(now.categories.map((c) => [c.category, c.cents] as const));
  const categoryRows: GapRow[] = [...new Set([...byCategory.keys(), ...expectedOf.keys()])].map((category) => {
    const spent = byCategory.get(category) ?? 0;
    const expected = expectedOf.get(category) ?? 0;
    return { category, day: null, label: categoryLabel(getCategory(category), lang), spentCents: spent, expectedCents: expected, gapCents: spent - expected };
  });

  let before = 0;
  const dayRows: GapRow[] = byDay.slice(0, day).map((spent, i) => {
    const upTo = figure.at(i + 1).cents;
    const expected = upTo - before;
    before = upTo;
    return { category: null, day: i + 1, label: messageIn(lang, "rep.day_label", { day: i + 1 }), spentCents: spent, expectedCents: expected, gapCents: spent - expected, top: topOfDay.get(i + 1) };
  });

  // the expected figure to date holds an unpaid bill of this month (all of it, or a part when its day varies, also before its day), the spending does not:
  // per category the estimate takes up what the expected holds and the spending lacks, up to the unpaid bills of the category
  const lateByCategory = new Map<string, number>();
  for (const b of recurringBills) if (b.date >= `${month}-01`) lateByCategory.set(b.category, (lateByCategory.get(b.category) ?? 0) + b.cents);
  const lateCents = [...lateByCategory].reduce((s, [category, cents]) => s + Math.min(cents, Math.max(0, (expectedOf.get(category) ?? 0) - (byCategory.get(category) ?? 0))), 0);
  const stillComingCents = whole.cents - now.cents + lateCents + typedCents;
  // the range is the lower and the upper quartile of what the base months spent after this day, each month's own rest
  const rest = figure.totals(days).map((total, i) => total - figure.totals(day)[i]!).sort((a, b) => a - b);
  const mid = spentCents + stillComingCents;
  const base = spentCents + lateCents + typedCents;
  const estimate: MonthEstimate | null = day >= days ? null : { lowCents: Math.min(mid, base + quantile(rest, RANGE_LOW)), cents: mid, highCents: Math.max(mid, base + quantile(rest, RANGE_HIGH)) };

  return {
    ...none,
    expectedCents: now.cents,
    gapCents,
    gapReason: null,
    categories: topRows(categoryRows, gapCents, messageIn(lang, "rep.other_categories")),
    days: topRows(dayRows, gapCents, messageIn(lang, "rep.other_days")),
    stillComingCents,
    // an overdue bill of an earlier month is in the list but not in `stillComingCents`, so it is left out of the difference
    otherComingCents: stillComingCents - (billsCents - earlierBillsCents),
    earlierBillsCents,
    estimate,
  };
}

/**
 * The categories of a month with too little history for a usual: each with what was spent, the largest first. A category
 * that has a row in two groups is one row here, with the sum of both.
 */
export function spentRows(groups: readonly { categories: readonly { category: string; label: string; totalCents: number }[] }[]): GapRow[] {
  const sums = new Map<string, GapRow>();
  for (const c of groups.flatMap((g) => g.categories)) {
    const row = sums.get(c.category) ?? { category: c.category, day: null, label: c.label, spentCents: 0, expectedCents: 0, gapCents: 0 };
    sums.set(c.category, { ...row, spentCents: row.spentCents + c.totalCents });
  }
  return [...sums.values()].filter((x) => x.spentCents !== 0).sort((a, b) => b.spentCents - a.spentCents);
}
