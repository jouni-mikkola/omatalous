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
 * A base month the linked cards' purchases are missing from (`covered` leaves it out) has no categories to read, only
 * the total: its card bills count as spending, so the headline holds in every base month.
 */
import { dayNumber, daysBetween, daysInMonth, monthEnd, monthIndex, monthOf } from "../dates.ts";
import type { RecurringSeries } from "../recurring.ts";
import { CADENCES } from "../recurring-cadence.ts";
import { MIN_COMPARE_MONTHS, PERIODIC_MONTHS, RANGE_HIGH, RANGE_LOW, SPARSE_SHARE } from "../thresholds.ts";
import { namesCard } from "../transfers.ts";
import type { IsoDate } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, spendRows } from "./context.ts";
import { flowSpendOf } from "./counted.ts";
import { accountCovers } from "./coverage.ts";
import { LEVEL, oneOffs as levelOneOffs } from "./one-offs.ts";
import { usualBase } from "./change-plan.ts";
import { accountsWithRows, cardsBreakUsual, completeIncomeMonthsBefore, coveredMonths, earnedIncome } from "./usual.ts";

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
  /** The base months whose categories hold every card's purchases (`coveredMonths`). A month outside it still holds its whole total: only the headline reads it. */
  covered: string[];
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
  /** Whether a series' latest charge `t` is put back into a base month before the series began; false for a month that holds the same money as a card bill. Default: yes. */
  backfill?: (t: AnalysisTx, month: string) => boolean;
}

const dayOf = (t: Pick<AnalysisTx, "bookingDate">) => Number(t.bookingDate.slice(8, 10));
const sumOf = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const bills = (s: RecurringSeries) => s.kind === "subscription" || s.kind === "bill";

/** The value at share `q` of sorted values, between the two nearest by linear interpolation, in whole cents. */
function quantile(sorted: readonly number[], q: number): number {
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
  for (const [id, t] of latest) months.forEach((m, i) => m < (started.get(id) ?? "") && (input.backfill?.(t, m) ?? true) && place(t.category, i, dayOf(t) - 1, t.spend, true));
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
  return { month, months: [...months], covered: [...months], oneOffs, due, at, totals: totalsAt };
}

const cache = new WeakMap<AnalysisContext, Map<string, Expected | null>>();

/** A row of the spending of the flows (`flowSpendOf`): every row but a debt paid from a savings account, which Tulos counts once, as saved. */
const inFlowSpend = (t: AnalysisTx): boolean => t.spend === 0 || flowSpendOf(t) !== 0;

/** The figure of `month` read from `months`, the rows the month table counts (`spendRows`), or only those `keep` accepts (and the series that start in them). */
function expectedOver(ctx: AnalysisContext, month: string, months: readonly string[], keep?: (t: AnalysisTx) => boolean): Expected {
  // the one-offs are judged in the window of the month and its base, as the change report judges them
  const oneOffs = expectedOneOffs(ctx, [...months, month]);
  const rows = keep ? (m: string) => rowsOf(ctx, m).filter(keep) : (m: string) => rowsOf(ctx, m);
  return expectedOf({ month, months, rows, series: keep ? seriesWhere(ctx, keep) : ctx.recurring, oneOffs, backfill: backfillOf(ctx) });
}

/**
 * A card's series is not put back into a month before that card's own rows begin: its purchases are then in a bill,
 * which is already that month's spending, and the charge again would count it twice. Per card: another card's gap or
 * bill leaves this card's series as it is.
 */
function backfillOf(ctx: AnalysisContext): (t: AnalysisTx, month: string) => boolean {
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  return (t, month) => !cards.has(t.accountId) || accountCovers(ctx, [t.accountId], `${month}-01`);
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
  const struck = oneOffs ?? expectedOneOffs(ctx, [...months, month]);
  return expectedOf({ month, months, rows: (m) => rowsOf(ctx, m).filter(keep), series: seriesWhere(ctx, keep), oneOffs: struck, backfill: backfillOf(ctx) }).at().cents;
}

/** The series that belong to the part `keep` accepts: a series belongs to the part its first row is in. */
function seriesWhere(ctx: AnalysisContext, keep: (t: AnalysisTx) => boolean): RecurringSeries[] {
  let byId = idCache.get(ctx);
  if (!byId) idCache.set(ctx, (byId = new Map(ctx.txs.map((t) => [t.id, t] as const))));
  return ctx.recurring.filter((s) => {
    const first = byId!.get(s.transactionIds[0] ?? "");
    return first !== undefined && keep(first);
  });
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
  return figureOf(ctx, month, month);
}

/**
 * `expectedFor` on the spending of the flows (`flowSpendOf`), the base of everything the first page shows under Menot: the
 * pace and its usual, the spending goal. A debt paid from a savings account is spending in the categories, so `expectedFor`
 * holds it, and Säästöön in Tulos, so Menot leave it out: the usual of Menot is read from the rows Menot are read from.
 */
export function expectedFlowsFor(ctx: AnalysisContext, month: string): Expected | null {
  return figureOf(ctx, month, `flows:${month}`, inFlowSpend);
}

/** The figure of `month`, cached per context under `key` (a base reads different rows for the same month). */
function figureOf(ctx: AnalysisContext, month: string, key: string, keep?: (t: AnalysisTx) => boolean): Expected | null {
  let byMonth = cache.get(ctx);
  if (!byMonth) cache.set(ctx, (byMonth = new Map()));
  if (byMonth.has(key)) return byMonth.get(key)!;
  const months = usualBase(ctx, month);
  const found = months.length < MIN_COMPARE_MONTHS ? null : { ...expectedOver(ctx, month, months, keep), covered: coveredMonths(ctx, months) };
  byMonth.set(key, found);
  return found;
}

/** Whether every base month of the figure holds the cards' purchases in its categories: only then may it be read by category and by day. Its total never needs it. */
export const coversCategories = (figure: Pick<Expected, "months" | "covered">): boolean => figure.covered.length === figure.months.length;

/**
 * Why `month` has no expected figure by category and day, null when it has one. "cards": the complete months before it
 * are there, but they lack the purchases of a card by category (`cardsBreakUsual`); the base of the figure starts at a
 * card connected later, so a household with a long history is not told to wait for three months. "history": under
 * `MIN_COMPARE_MONTHS` complete months. Yhteenveto's month reads this one reason.
 */
export function usualGap(ctx: AnalysisContext, month: string): "cards" | "history" | null {
  const figure = expectedFor(ctx, month);
  if (figure && coversCategories(figure)) return null;
  return figure || cardsBreakUsual(ctx, month) ? "cards" : "history";
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

/** The expected earned income of `month`: the mean of the complete income months before it (`completeIncomeMonthsBefore`, the months the income report calls complete) of `earnedIncome`, null under `MIN_COMPARE_MONTHS`. Money from people, refunds and own money are left out. */
export function expectedIncome(ctx: AnalysisContext, month: string): number | null {
  return expectedLevel(completeIncomeMonthsBefore(ctx, month).map((m) => earnedIncome(ctx, m)));
}

/** The expected everyday spending of a span of days, with the lower and the upper quartile of the base months around it. */
interface ExpectedEveryday {
  cents: number;
  lowCents: number;
  highCents: number;
  /** How many complete months it is read from. */
  months: number;
}

/** Why there is no expected everyday spending: under `MIN_COMPARE_MONTHS` complete months, or the base starts at a card connected later. */
export type EverydayGap = "history" | "cards";

/**
 * The expected everyday spending of the days `from` to `until` (inclusive, `until` before `from` is none): what the
 * base months of `from`'s month (`expectedFor`) spent a day, outside every subscription and bill series (`fixedIds`),
 * the debt part of a row of a loan the calendar walks by its plan (`planned`), a card's bill and the one-offs the headline leaves out. Each base month counts as its even
 * daily rate (its spending over its length), so a span of days is that many days of the pace and never what happened to
 * fall on its dates. It is the mean of the base months, and the range is their lower and upper quartile, as the headline
 * has it. A span may run over a month's end. `keep` limits it to the rows of some accounts: the
 * payday runway asks for the ones the counted accounts pay themselves. `month` is the month whose base months it reads (`from`'s by default): a span that starts in the next month (the day after the month's last day) still reads this one's, since the next one has no complete month yet. The day-by-day rate of the first page and the
 * runway read this, so everyday spending has one definition. A base month that holds a card's purchases only as a bill
 * (outside `covered`) has no days for them: the bill's sum is spread evenly over the month's days, so the total pace of
 * the month is whole and the spans that read it still have a figure. A bill of a connected card that has rows in the
 * month is not spread (`paysCardWithRows`). Only a base too short, or one that starts at a card connected later, leaves it
 * without.
 */
export function expectedEveryday(ctx: AnalysisContext, from: IsoDate, until: IsoDate, keep: (t: AnalysisTx) => boolean = () => true, month: string = monthOf(from), planned: (t: AnalysisTx) => boolean = () => false): ExpectedEveryday | EverydayGap {
  const span = everydaySpans(ctx, keep, month, planned);
  return typeof span === "string" ? span : span(from, until);
}

/**
 * `expectedEveryday` of one set of rows for many spans: the base months' days are read once and each span sums them, so a
 * walk that asks for a span to every day of 60 reads the rows once. The same figure as `expectedEveryday` for the same span.
 */
export function everydaySpans(ctx: AnalysisContext, keep: (t: AnalysisTx) => boolean, month: string, planned: (t: AnalysisTx) => boolean = () => false): ((from: IsoDate, until: IsoDate) => ExpectedEveryday) | EverydayGap {
  const figure = expectedFor(ctx, month);
  // the reason Yhteenveto's month gives, so the runway's cannot say "history" beside their "cards"
  if (!figure) return usualGap(ctx, month) ?? "history";
  const struck = expectedOneOffs(ctx, [...figure.months, figure.month]);
  // each base month's everyday spending as one even daily rate: a span reads the months' pace, not what landed on its days of the month
  const rates = figure.months.map((m) => {
    const bridged = !figure.covered.includes(m);
    let total = 0;
    for (const t of rowsOf(ctx, m)) {
      if (t.spend === 0 || struck.has(t.id) || !keep(t)) continue;
      // the only record of a card's purchases in a month the feed does not cover: its sum, with no day of its own
      if (t.category === "card_bill") {
        if (bridged && !paysCardWithRows(ctx, t, m)) total += t.spend;
      } else if (!ctx.fixedIds.has(t.id)) {
        // a loan the calendar walks by its plan: the plan's row stands for the payment, so its debt part is no everyday spending. Any other repayment, interest or collection row stays in
        total += planned(t) ? t.spend - t.flows.debt : t.spend;
      }
    }
    return total / daysInMonth(m);
  });
  return (from, until) => {
    const days = until < from ? 0 : daysBetween(from, until) + 1;
    const totals = rates.map((rate) => rate * days);
    const sorted = [...totals].sort((a, b) => a - b);
    const cents = Math.round(sumOf(totals) / totals.length);
    return { cents, lowCents: Math.min(cents, quantile(sorted, RANGE_LOW)), highCents: Math.max(cents, quantile(sorted, RANGE_HIGH)), months: totals.length };
  };
}

/**
 * Whether a card bill of `month` names a connected card (`namesCard`) that has rows in the month. Such a bill pays the
 * card's period before its rows began or soon after (`paysPurchasesBeforeRows`): the month's own purchases are its rows,
 * and the period's purchases from the first row on are rows too, so spreading the bill would count them twice.
 */
function paysCardWithRows(ctx: AnalysisContext, t: AnalysisTx, month: string): boolean {
  const here = accountsWithRows(ctx, month);
  const text = [t.merchant, t.counterparty, t.description].filter(Boolean).join(" ");
  return ctx.accounts.some((a) => a.type === "credit_card" && here.has(a.id) && namesCard(text, a));
}

/** The expected everyday spending of a day of `month` in whole cents, over all the accounts in view: the month's expected everyday spending over its days. 0 without a figure. */
export function expectedEverydayPerDay(ctx: AnalysisContext, month: string, planned?: (t: AnalysisTx) => boolean): number {
  const found = expectedEveryday(ctx, `${month}-01`, monthEnd(month), () => true, month, planned);
  return typeof found === "string" ? 0 : Math.round(found.cents / daysInMonth(month));
}
