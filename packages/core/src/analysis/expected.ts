// Decision: how much should the month have cost by now, and which categories explain the difference
/**
 * "Odotettu": the one figure for what a month is expected to cost (ADR 0021). It is made per category and the headline
 * is the sum of the categories, so the bars of the first page, the rows of the change report and the line of the pace
 * chart add up to the same number. Every page that says what a month usually costs reads it here.
 *
 * Per category, from the complete months before the month (`USUAL_MONTHS`, at least `MIN_COMPARE_MONTHS`):
 * - an ordinary category is the mean of what the base months had spent by the same day. A rent paid on the 1st is in
 *   the figure from the 1st, a food category grows day by day, so the day decides what is expected.
 * - a bill that comes every three months or less often (`PERIODIC_MONTHS`) is expected whole in the month it falls
 *   due and on its day, and in no other month. It is not part of the mean of the other months.
 * - a one-off is left out of the figure and listed (`Expected.oneOffs`), so a sofa does not raise next month's
 *   expectation. What is a one-off is the level policy of one-offs.ts (ADR 0005), the same everywhere.
 * The range is the lower to the upper quartile of the base months' total by the same day, moved to the headline.
 * A month the linked cards' purchases are missing from has no categories to expect (`itemised`), only the headline.
 */
import { addDays, dayNumber, daysInMonth, monthEnd, monthIndex, monthOf } from "../dates.ts";
import type { RecurringSeries } from "../recurring.ts";
import { CADENCES } from "../recurring-cadence.ts";
import { MIN_COMPARE_MONTHS, PERIODIC_MONTHS, RANGE_HIGH, RANGE_LOW, SPARSE_SHARE } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, spendRows } from "./context.ts";
import { LEVEL, oneOffs as levelOneOffs } from "./one-offs.ts";
import { cardsBreakUsual, completeMonthsBefore, earnedIncome } from "./usual.ts";

/** How a category's expected spending behaves: it grows day by day, falls on a date, comes in some months, or comes rarely. */
type ExpectedKind = "daily" | "dated" | "periodic" | "sparse";

interface ExpectedCategory {
  category: string;
  kind: ExpectedKind;
  /** Expected spending on the month's days 1 to `day`, in cents. */
  cents: number;
}

/** A purchase the figure leaves out, named so the page can say so. */
interface ExpectedOneOff {
  id: string;
  month: string;
  day: number;
  merchant: string;
  category: string;
  cents: number;
}

/** A bill of a rare cadence that falls due in the month. */
export interface ExpectedDue {
  seriesId: string;
  merchant: string;
  category: string;
  /** The day of the month it is paid on. */
  day: number;
  cents: number;
}

interface ExpectedAt {
  day: number;
  /** The headline: the sum of `categories`. */
  cents: number;
  /** The middle half of the base months by the same day, around the headline; `lowCents <= cents <= highCents`. */
  lowCents: number;
  highCents: number;
  /** Largest first. */
  categories: ExpectedCategory[];
}

interface Expected {
  month: string;
  /** The base months, oldest first. */
  months: string[];
  /** False when the base months lack the purchases of a linked card: only the headline is true. */
  itemised: boolean;
  oneOffs: ExpectedOneOff[];
  due: ExpectedDue[];
  /** The figure on the month's days 1 to `day` (31: the whole month). */
  at(day?: number): ExpectedAt;
  /** What each base month, oldest first, had spent on its days 1 to `day`, as `at` reads them. */
  totals(day?: number): number[];
}

interface ExpectedInput {
  /** The month the figure is for. */
  month: string;
  /** The base months, oldest first. */
  months: readonly string[];
  /** The rows of a base month as the caller counts them, cut to the days it compares. */
  rows: (month: string) => readonly AnalysisTx[];
  series: readonly RecurringSeries[];
  /** The rows that are one-offs: left out of the figure and listed. */
  oneOffs: ReadonlySet<string>;
}

const dayOf = (t: Pick<AnalysisTx, "bookingDate">) => Number(t.bookingDate.slice(8, 10));
const sumOf = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const bills = (s: RecurringSeries) => s.kind === "subscription" || s.kind === "bill";

/** The value at share `q` of sorted values, between the two nearest by linear interpolation, in whole cents. */
export function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo));
}

/** Calendar months between two charges of a series' cadence; 0 for a cadence of days. */
const stepOf = (s: RecurringSeries) => CADENCES.find((c) => c.id === s.cadence)?.months ?? 0;

/** A bill or subscription that comes every `PERIODIC_MONTHS` months or less often. */
const isPeriodic = (s: RecurringSeries): boolean => bills(s) && stepOf(s) >= PERIODIC_MONTHS;

/** The periodic bills that fall due in `month`: in the months its cadence steps to from its latest charge, while it still charges. */
function dueIn(series: readonly RecurringSeries[], month: string): ExpectedDue[] {
  const out: ExpectedDue[] = [];
  for (const s of series) {
    if (!isPeriodic(s)) continue;
    const step = stepOf(s);
    const gap = monthIndex(month) - monthIndex(s.lastDate.slice(0, 7));
    if (month < s.firstDate.slice(0, 7) || ((gap % step) + step) % step !== 0 || (gap > 0 && !s.active)) continue;
    out.push({ seriesId: s.id, merchant: s.merchant, category: s.category, day: Math.min(Number(s.lastDate.slice(8, 10)), daysInMonth(month)), cents: s.typicalAmountCents });
  }
  return out.sort((a, b) => a.day - b.day || a.seriesId.localeCompare(b.seriesId));
}

/** Spending by day of month, cumulative: index d − 1 is days 1 to d. */
const cumulative = (daily: number[]): number[] => {
  let run = 0;
  return daily.map((v) => (run += v));
};

/** The figure of `month` from the rows of its base months. Pure: the caller chooses the months and the rows. */
function expectedOf(input: ExpectedInput): Expected {
  const { month, months, series } = input;
  const n = months.length;
  // the longest month: a base month shorter than the day asked for has spent all of its month
  const lastDay = 31;
  const rows = months.map((m) => input.rows(m).filter((t) => t.spend !== 0));
  const struck = input.oneOffs;
  const periodic = new Set(series.filter(isPeriodic).flatMap((s) => s.transactionIds));
  const monthlySeries = series.filter((s) => bills(s) && s.cadence === "monthly");
  const monthly = new Set(monthlySeries.flatMap((s) => s.transactionIds));
  // a contract holds until it changes: an active monthly bill is expected at its latest charge, not at the mean of
  // the months before a rise
  const seriesOfRow = new Map(monthlySeries.filter((s) => s.active).flatMap((s) => s.transactionIds.map((id) => [id, s.id] as const)));
  const startOf = new Map(monthlySeries.filter((s) => s.active).map((s) => [`${s.merchant}|${s.category}`, s.firstDate.slice(0, 7)] as const));
  const beforeSeries = (t: AnalysisTx, month: string) => month < (startOf.get(`${t.merchant}|${t.category}`) ?? "");
  const latest = new Map<string, AnalysisTx>();
  for (const t of rows.flat()) {
    const id = seriesOfRow.get(t.id);
    if (id !== undefined && t.spend > 0 && (latest.get(id)?.bookingDate ?? "") <= t.bookingDate) latest.set(id, t);
  }
  const daily = new Map<string, number[][]>();
  const dated = new Map<string, number>();
  const whole = new Map<string, number>();
  const boughtIn = new Map<string, Set<number>>();
  const oneOffs: ExpectedOneOff[] = [];
  const place = (category: string, i: number, d: number, cents: number, isDated: boolean) => {
    const perMonth = daily.get(category) ?? daily.set(category, months.map(() => new Array<number>(lastDay).fill(0))).get(category)!;
    perMonth[i]![d]! += cents;
    whole.set(category, (whole.get(category) ?? 0) + cents);
    if (isDated) dated.set(category, (dated.get(category) ?? 0) + cents);
    (boughtIn.get(category) ?? boughtIn.set(category, new Set()).get(category)!).add(i);
  };
  rows.forEach((list, i) => {
    for (const t of list) {
      const d = dayOf(t) - 1;
      if (!t.spend || periodic.has(t.id)) continue;
      if (struck.has(t.id)) {
        oneOffs.push({ id: t.id, month: months[i]!, day: d + 1, merchant: t.merchant, category: t.category, cents: t.spend });
        continue;
      }
      // the same payee's rows from before the series began are put back below as the latest charge
      if (t.spend > 0 && beforeSeries(t, months[i]!)) continue;
      const id = seriesOfRow.get(t.id);
      place(t.category, i, d, id !== undefined && t.spend > 0 ? latest.get(id)!.spend : t.spend, monthly.has(t.id));
    }
  });
  // the contract holds in every base month, also before it began: the latest charge on its day, so a bill that began
  // in the middle of the base is not diluted by the months before it
  const started = new Map(monthlySeries.filter((s) => s.active).map((s) => [s.id, s.firstDate.slice(0, 7)] as const));
  for (const [id, t] of latest) months.forEach((m, i) => m < (started.get(id) ?? "") && place(t.category, i, dayOf(t) - 1, t.spend, true));
  const curves = new Map([...daily].map(([category, perMonth]) => [category, perMonth.map(cumulative)]));
  const due = dueIn(series, month);
  const duePerCategory = new Map<string, number>();
  for (const d of due) duePerCategory.set(d.category, (duePerCategory.get(d.category) ?? 0) + d.cents);
  const ids = [...new Set([...curves.keys(), ...duePerCategory.keys()])].sort();
  const kindOf = (category: string): ExpectedKind => {
    const periodicCents = duePerCategory.get(category) ?? 0;
    const curveCents = whole.get(category) ?? 0;
    if (periodicCents > curveCents / Math.max(1, n)) return "periodic";
    if ((boughtIn.get(category)?.size ?? 0) < SPARSE_SHARE * n) return "sparse";
    return (dated.get(category) ?? 0) * 2 >= curveCents ? "dated" : "daily";
  };
  const kinds = new Map(ids.map((id) => [id, kindOf(id)]));
  oneOffs.sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));

  const dayOfAsk = (day: number) => (day >= daysInMonth(month) ? lastDay : Math.max(1, day));
  // a bill of a rare cadence is in no base month's curve: it falls due on its day whatever the month, so each total holds it from then
  const totalsAt = (day = lastDay): number[] => {
    const d = dayOfAsk(day);
    const falls = sumOf(due.filter((x) => x.day <= d).map((x) => x.cents));
    return months.map((_, i) => sumOf([...curves.values()].map((c) => c[i]![d - 1]!)) + falls);
  };
  const at = (day = lastDay): ExpectedAt => {
    // the month's last day is the whole month: a bill paid on the 31st of a base month is due by the 28th of February
    const d = day >= daysInMonth(month) ? lastDay : Math.max(1, day);
    const categories = ids
      .map((category): ExpectedCategory => {
        const perMonth = curves.get(category);
        const mean = perMonth ? Math.round(sumOf(perMonth.map((c) => c[d - 1]!)) / n) : 0;
        const falls = sumOf(due.filter((x) => x.category === category && x.day <= d).map((x) => x.cents));
        return { category, kind: kinds.get(category)!, cents: mean + falls };
      })
      .filter((c) => c.cents !== 0)
      .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
    const cents = sumOf(categories.map((c) => c.cents));
    // the months' own totals by this day, set against their mean: the same distance either side of the headline
    const totals = months.map((_, i) => sumOf([...curves.values()].map((c) => c[i]![d - 1]!)));
    const sorted = [...totals].sort((a, b) => a - b);
    const centre = Math.round(sumOf(totals) / n);
    return {
      day: d,
      cents,
      lowCents: Math.min(cents, cents + quantile(sorted, RANGE_LOW) - centre),
      highCents: Math.max(cents, cents + quantile(sorted, RANGE_HIGH) - centre),
      categories,
    };
  };
  return { month, months: [...months], itemised: true, oneOffs, due, at, totals: totalsAt };
}

const cache = new WeakMap<AnalysisContext, Map<string, Expected | null>>();

/** The figure of `month` read from `months`, the rows the month table counts (`spendRows`). */
export function expectedOver(ctx: AnalysisContext, month: string, months: readonly string[]): Expected {
  // the one-offs are judged in the window of the month and its base, as the insights and the change report judge them
  const oneOffs = expectedOneOffs(ctx, [...months, month]);
  return expectedOf({ month, months, rows: (m) => rowsOf(ctx, m), series: ctx.recurring, oneOffs });
}

const rowCache = new WeakMap<AnalysisContext, Map<string, readonly AnalysisTx[]>>();
const idCache = new WeakMap<AnalysisContext, Map<string, AnalysisTx>>();

/** The rows the month table counts (`spendRows`) for one calendar month, kept per context: a page asks for the same months over and over. */
function rowsOf(ctx: AnalysisContext, month: string): readonly AnalysisTx[] {
  let byMonth = rowCache.get(ctx);
  if (!byMonth) rowCache.set(ctx, (byMonth = new Map()));
  if (!byMonth.has(month)) byMonth.set(month, spendRows(ctx, { fromDay: dayNumber(`${month}-01`), toDay: dayNumber(monthEnd(month)) }));
  return byMonth.get(month)!;
}

/**
 * The expected spending of `month` on the rows `keep` accepts (one row of a report, a line, a theme), the whole month,
 * from the base `months`. The same method as `expectedOver` on those rows alone: bills of a rare cadence in the month
 * they fall due, an active monthly bill at its latest amount, one-offs left out. `oneOffs` are the rows to leave out
 * when the caller has judged them once for many parts; by default they are judged in the window of the month and its base.
 */
export function expectedPart(ctx: AnalysisContext, month: string, months: readonly string[], keep: (t: AnalysisTx) => boolean, oneOffs?: ReadonlySet<string>): number {
  let byId = idCache.get(ctx);
  if (!byId) idCache.set(ctx, (byId = new Map(ctx.txs.map((t) => [t.id, t] as const))));
  // a series belongs to the part its first row is in
  const series = ctx.recurring.filter((s) => {
    const first = byId!.get(s.transactionIds[0] ?? "");
    return first !== undefined && keep(first);
  });
  const struck = oneOffs ?? expectedOneOffs(ctx, [...months, month]);
  return expectedOf({ month, months, rows: (m) => rowsOf(ctx, m).filter(keep), series, oneOffs: struck }).at().cents;
}

/** The ids of the rows of `months` that are one-offs by the level policy (ADR 0005): what the expected figure leaves out, wherever a page reads a level over months. */
export function expectedOneOffs(ctx: AnalysisContext, months: readonly string[]): ReadonlySet<string> {
  const window = new Set(months);
  return levelOneOffs(ctx.txs.filter((t) => window.has(t.bookingDate.slice(0, 7))), LEVEL, ctx.fixedIds);
}

/**
 * The expected figure of `month` from the complete months before it (`completeMonthsBefore`). null under
 * `MIN_COMPARE_MONTHS` complete months. Cached per context and month.
 */
export function expectedFor(ctx: AnalysisContext, month: string): Expected | null {
  let byMonth = cache.get(ctx);
  if (!byMonth) cache.set(ctx, (byMonth = new Map()));
  if (byMonth.has(month)) return byMonth.get(month)!;
  const months = completeMonthsBefore(ctx, month);
  const found = months.length < MIN_COMPARE_MONTHS ? null : { ...expectedOver(ctx, month, months), itemised: !cardsBreakUsual(ctx, month) };
  byMonth.set(month, found);
  return found;
}

/** The expected spending of `month` on its days 1 to `day` (31: the whole month); null without a figure. */
export function expectedSpending(ctx: AnalysisContext, month: string, day = 31): number | null {
  return expectedFor(ctx, month)?.at(day).cents ?? null;
}

/**
 * The expected level of a plain series of month values (a category's spending, a saving): their mean, null under
 * `MIN_COMPARE_MONTHS` values. For a figure that is not the month's spending and has no days or bills of its own.
 */
export function expectedLevel(values: readonly number[]): number | null {
  return values.length < MIN_COMPARE_MONTHS ? null : Math.round(sumOf(values) / values.length);
}

/** The expected earned income of `month`: the mean of the complete months before it (`earnedIncome`), null under `MIN_COMPARE_MONTHS`. Money from people, refunds and own money are left out. */
export function expectedIncome(ctx: AnalysisContext, month: string): number | null {
  return expectedLevel(completeMonthsBefore(ctx, month).map((m) => earnedIncome(ctx, m)));
}

/** The expected everyday spending of a span of days, with the lower and the upper quartile of the base months around it. */
interface ExpectedEveryday {
  cents: number;
  lowCents: number;
  highCents: number;
  /** How many complete months it is read from. */
  months: number;
}

/** Why there is no expected everyday spending: under `MIN_COMPARE_MONTHS` complete months, or a linked card's purchases are missing from them. */
export type EverydayGap = "history" | "cards";

/**
 * The expected everyday spending of the days `from` to `until` (inclusive, `until` before `from` is none): what the
 * base months of `from`'s month (`expectedFor`) spent on the same days of their months, outside every subscription
 * and bill series (`fixedIds`), a card's bill and the one-offs the headline leaves out. It is the mean of the base
 * months, and the range is their lower and upper quartile, as the headline has it. A span may run over a month's end;
 * a day a base month does not have (the 31st) adds nothing. `keep` limits it to the rows of some accounts: the
 * payday runway asks for the ones the counted accounts pay themselves. `month` is the month whose base months it reads (`from`'s by default): a span that starts in the next month (the day after the month's last day) still reads this one's, since the next one has no complete month yet. The day-by-day rate of the first page and the
 * runway read this, so everyday spending has one definition.
 */
export function expectedEveryday(ctx: AnalysisContext, from: IsoDate, until: IsoDate, keep: (t: AnalysisTx) => boolean = () => true, month: string = monthOf(from)): ExpectedEveryday | EverydayGap {
  const figure = expectedFor(ctx, month);
  if (!figure) return "history";
  if (!figure.itemised) return "cards";
  const struck = expectedOneOffs(ctx, [...figure.months, figure.month]);
  const perDay = figure.months.map((m) => {
    const days = new Array<number>(31).fill(0);
    for (const t of rowsOf(ctx, m)) if (t.spend !== 0 && !ctx.fixedIds.has(t.id) && t.category !== "card_bill" && !struck.has(t.id) && keep(t)) days[dayOf(t) - 1]! += t.spend;
    return days;
  });
  const totals = figure.months.map(() => 0);
  for (let day = from; day <= until; day = addDays(day, 1)) {
    const d = Number(day.slice(8, 10));
    figure.months.forEach((m, i) => {
      const length = daysInMonth(m);
      totals[i]! += d <= length ? perDay[i]![d - 1]! : sumOf(perDay[i]!) / length;
    });
  }
  const sorted = [...totals].sort((a, b) => a - b);
  const cents = Math.round(sumOf(totals) / totals.length);
  return { cents, lowCents: Math.min(cents, quantile(sorted, RANGE_LOW)), highCents: Math.max(cents, quantile(sorted, RANGE_HIGH)), months: totals.length };
}

/** The expected everyday spending of a day of `month` in whole cents, over all the accounts in view: the month's expected everyday spending over its days. 0 without a figure. */
export function expectedEverydayPerDay(ctx: AnalysisContext, month: string): number {
  const found = expectedEveryday(ctx, `${month}-01`, monthEnd(month));
  return typeof found === "string" ? 0 : Math.round(found.cents / daysInMonth(month));
}
