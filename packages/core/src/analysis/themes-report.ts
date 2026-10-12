/**
 * What goes where: the themes (themes.ts) of the last twelve complete months, as one answer a page prints as given.
 * Each theme and each of its lines has what it took a month and in the year, and how that moved against the year before.
 *
 * - The window is complete months only, twelve at most. Every account with spending in it was in the data from its
 *   first day: an account's rows begin with its first row, so a card connected five months ago makes it five months.
 *   And it is the newest run of months in which every account that pays has rows, so a card that stopped syncing is no
 *   spending that fell. Under three months there is no answer.
 * - Nothing is scaled up to a year: a window under twelve months has a figure a month and none for the year.
 * - A large purchase (`largePurchases`) is in no theme. It stands apart, with the money that came back for it and
 *   with money in on Auton osto, so the themes and the large purchases add up to the spending of the window to the cent.
 * - The change is told against the twelve months before, placed by the same rule, and only over the gate (`gateFor`).
 *   It needs every account with spending in either year in the data from the first day of the year before.
 *
 * See docs/MONEY_FLOWS.md, "Themes".
 */
import { addMonthsToDate, dateIn, fromMonthIndex, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { fuelPurchases, themeOf, THEMES } from "../themes.ts";
import type { Account, IsoDate } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, inDays } from "./context.ts";
import { totalsOf } from "./flows.ts";
import { largePurchases } from "./large.ts";
import { toDayRange } from "./period.ts";
import { completeMonthsBefore, gateFor, isCompleteMonth, MIN_COMPARE_MONTHS } from "./usual.ts";

/** The months of the window at most, and what a year's figure and a change need. */
const YEAR = 12;
/** Auton osto: every purchase of it is large (`LARGE` in one-offs.ts), and here money in on it is too. */
const CAR_PURCHASE = "vehicle_purchase";

interface ThemeFigures {
  /** The window's sum divided by its months, in whole cents. */
  monthlyCents: number;
  /** The window's sum when the window is twelve months, null of a shorter one. */
  yearCents: number | null;
  /**
   * The change against the twelve months before in whole percent, with its sign. null without twelve months before
   * that every paying account covers, without spending in them, and under the gate: never 0.
   */
  changePct: number | null;
}

interface ThemeLineSum extends ThemeFigures {
  /** The line's id in `THEMES`: a category's id, or in Auto what the row was for. */
  id: string;
  heading: string;
}

interface ThemeSum extends ThemeFigures {
  id: (typeof THEMES)[number]["id"];
  heading: string;
  /**
   * The lines that have a sum, in the order of `THEMES`. Their `yearCents` add up to the theme's, and so do their
   * `monthlyCents`: the theme's cents a month are shared out among them, so one of them may be a cent off its own
   * sum divided by the months.
   */
  lines: ThemeLineSum[];
}

/** A row of the large purchases: a purchase, money that came back for one, or money in on Auton osto. */
interface LargeRow {
  id: string;
  /** The booking day. */
  date: IsoDate;
  /** The payee as the lists of Tapahtumat name it (`merchant`). */
  payee: string;
  /** What the row counts for in the sum, in the view's cents: money back has a minus. */
  cents: number;
}

export interface ThemesReport {
  /** The months the figures are of, `first` to `last` with both included (`2025-10`), and how many they are: 3 to 12. */
  window: { first: string; last: string; months: number };
  /** The themes that have a sum, the largest first. One with more money back than spending is last, with its minus. */
  themes: ThemeSum[];
  /** What the themes took in the window: with `large.cents` it is `spendingCents`. */
  totalCents: number;
  /** The sum of the themes' `monthlyCents`, so the column of a page adds up. */
  totalMonthlyCents: number;
  /** `totalCents` when the window is twelve months, null of a shorter one. */
  totalYearCents: number | null;
  /**
   * The large purchases of the window, which no theme holds: their sum less what came back for a large purchase in
   * the window and less money in on Auton osto (the old car sold), how many purchases there are, and every row the
   * sum is made of, the largest first.
   */
  large: { cents: number; count: number; rows: LargeRow[] };
  /** The spending of the window (consumption and debt), as the reports have it. */
  spendingCents: number;
}

const at = (accountId: string, month: number) => `${accountId}|${month}`;
const sum = (cents: Iterable<number>) => [...cents].reduce((a, b) => a + b, 0);

/** The rows of consecutive months, the first to the last. */
function rowsOf(ctx: AnalysisContext, months: readonly number[]): AnalysisTx[] {
  return inDays(ctx, toDayRange({ from: dateIn(fromMonthIndex(months[0]!), 1), to: monthEnd(fromMonthIndex(months[months.length - 1]!)) }));
}

/** The accounts whose rows the sums count: one with spending or money back among `rows`. */
function counted(rows: readonly AnalysisTx[]): string[] {
  return [...new Set(rows.filter((t) => t.spend).map((t) => t.accountId))];
}

/** What a bank gives one length of history to: its cards, or its deposit accounts. A loan is neither. */
const kindOf = (a: Account) => (a.type === "credit_card" ? "card" : a.type === "loan" ? null : "deposit");

interface Coverage {
  /** Was the account in the data for the whole of the month? */
  covers: (accountId: string, month: number) => boolean;
  /** The month of the account's first row. In a month before it the account has no row to miss. */
  began: (accountId: string) => number;
}

/**
 * From when each account was in the data. The context does not know from which day an account's history was asked,
 * so its first row decides, with the days of slack the oldest row of all has (`isCompleteMonth`): a card opened
 * later than its history reaches is read as one connected later, the safe side.
 *
 * One thing says more than the first row. When another account of the same bank and of the same kind has a row a
 * whole month or more before it, the bank gave older history for an account of that kind and would have given this
 * one's too: the account was in the data from that older row on, with nothing to show. A card vouches for a card and
 * a deposit account for a deposit account, never one for the other, since banks give cards a shorter history. An
 * account without a bank is vouched for by none and vouches for none.
 */
function coverage(ctx: AnalysisContext): Coverage {
  const first = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (!first.has(t.accountId)) first.set(t.accountId, t.bookingDate);
  const from = new Map(first);
  for (const a of ctx.accounts) {
    const own = first.get(a.id);
    const kind = kindOf(a);
    if (!own || !a.bank || !kind) continue;
    const monthBefore = addMonthsToDate(own, -1);
    for (const b of ctx.accounts) {
      const theirs = first.get(b.id);
      if (b.id !== a.id && b.bank === a.bank && kindOf(b) === kind && theirs && theirs <= monthBefore && theirs < from.get(a.id)!) from.set(a.id, theirs);
    }
  }
  return {
    covers: (accountId, month) => isCompleteMonth({ dataFrom: from.get(accountId) ?? null, today: ctx.today }, fromMonthIndex(month)),
    began: (accountId) => {
      const day = first.get(accountId);
      return day ? monthIndex(monthOf(day)) : Number.POSITIVE_INFINITY;
    },
  };
}

/**
 * The accounts whose month without a row is missing data: one with spending in half of `months` or more. A card used
 * now and then is none, and neither is an account with nothing in `months`, however much it paid before them.
 */
function payers(rows: readonly AnalysisTx[], months: readonly number[]): string[] {
  const paid = new Set(rows.filter((t) => t.spend > 0).map((t) => at(t.accountId, t.month)));
  return [...new Set(rows.map((t) => t.accountId))].filter((a) => months.filter((m) => paid.has(at(a, m))).length * 2 >= months.length);
}

/** The newest three or more consecutive months that pass `covered`; none when no run is that long. */
function newestRun(months: readonly number[], covered: (month: number) => boolean): readonly number[] {
  let end = months.length;
  while (end > 0) {
    while (end > 0 && !covered(months[end - 1]!)) end--;
    let start = end;
    while (start > 0 && covered(months[start - 1]!)) start--;
    if (end - start >= MIN_COMPARE_MONTHS) return months.slice(start, end);
    end = start;
  }
  return [];
}

/** `cents` each divided by `n`, in whole cents that add up to `total` (the sum of `cents` divided by `n`, rounded). */
function sharedOut(cents: readonly number[], n: number, total: number): number[] {
  const over = cents.map((c) => ((c % n) + n) % n);
  const out = cents.map((c, i) => (c - over[i]!) / n);
  let left = total - sum(out);
  // the cents the rounding down left go to the lines that lost most of one
  for (const i of over.map((_, i) => i).sort((a, b) => over[b]! - over[a]! || a - b)) if (left-- > 0) out[i]! += 1;
  return out;
}

/**
 * How a sum of the window moved against the twelve months before. The gate is 2 % of the level a month before and at
 * least 10 € a month, so the answer is never 0.
 */
function changeOf(cents: number, before: number | null): number | null {
  if (before === null || before <= 0) return null;
  const change = cents - before;
  return Math.abs(change) / YEAR >= gateFor(before / YEAR) ? Math.round((change / before) * 100) : null;
}

interface Sums {
  /** Cents by theme id and then by line id. */
  themes: Map<string, Map<string, number>>;
  /** The large purchases and the money that came back for one. */
  large: AnalysisTx[];
}

function sumsOf(ctx: AnalysisContext, rows: readonly AnalysisTx[], cars: Parameters<typeof themeOf>[2], large: ReadonlySet<string>): Sums {
  const themes = new Map<string, Map<string, number>>();
  const apart: AnalysisTx[] = [];
  for (const t of rows) {
    if (!t.spend) continue;
    // Money back counts where its payment counts, also when that is a large purchase. Money in on Auton osto that
    // takes back no payment (the old car sold) stands with the cars bought: a row of that category is no upkeep.
    if (large.has(ctx.returns.get(t.id) ?? t.id) || (t.spend < 0 && t.category === CAR_PURCHASE && !ctx.returns.has(t.id))) {
      apart.push(t);
      continue;
    }
    const placed = themeOf(ctx, t, cars);
    const lines = themes.get(placed.theme) ?? new Map<string, number>();
    themes.set(placed.theme, lines.set(placed.line, (lines.get(placed.line) ?? 0) + t.spend));
  }
  return { themes, large: apart };
}

/**
 * The themes of the last twelve complete months before today; null under three months that every account with
 * spending in them covers from their first day and every paying account has rows in.
 */
export function themesReport(ctx: AnalysisContext): ThemesReport | null {
  const complete = completeMonthsBefore(ctx, monthOf(ctx.today), 2 * YEAR).map(monthIndex);
  const latest = complete.slice(-YEAR);
  if (latest.length < MIN_COMPARE_MONTHS) return null;
  const latestRows = rowsOf(ctx, latest);
  const { covers, began } = coverage(ctx);
  // an account with spending in these months narrows them to the ones it was in the data for from the 1st
  const spending = counted(latestRows);
  const whole = latest.filter((m) => spending.every((a) => covers(a, m)));
  if (whole.length < MIN_COMPARE_MONTHS) return null;
  const paying = payers(latestRows.filter((t) => t.month >= whole[0]!), whole);
  const seen = new Set(latestRows.map((t) => at(t.accountId, t.month)));
  // A month a paying account has no row of any kind in is missing data, not a month without spending. A month before
  // its first row is none: `covers` has said whether the account was in the data then.
  const months = newestRun(whole, (m) => paying.every((a) => m < began(a) || seen.has(at(a, m))));
  const n = months.length;
  if (!n) return null;
  const rows = latestRows.filter((t) => t.month >= months[0]! && t.month <= months[n - 1]!);

  const large = largePurchases(ctx);
  // The household is not asked how many cars it has, so the fuel it bought in the window stands in for the answer.
  // The year before is placed by the same answer: a theme is compared with itself.
  const cars = { answer: null, purchases: fuelPurchases(rows) };
  const now = sumsOf(ctx, rows, cars, large);

  let before: Sums["themes"] | null = null;
  if (n === YEAR && complete.length === 2 * YEAR) {
    const earlier = complete.slice(0, YEAR);
    const earlierRows = rowsOf(ctx, earlier);
    const seenEarlier = new Set(earlierRows.map((t) => at(t.accountId, t.month)));
    const inBoth = [...new Set([...paying, ...payers(earlierRows, earlier)])];
    // a year an account is in for a part only is no year to compare with: every account the two sums count was in
    // the data from the first day of the year before
    const fromTheStart = [...spending, ...counted(earlierRows)].every((a) => covers(a, earlier[0]!));
    const rowsIn = (a: string) => earlier.every((m) => m < began(a) || seenEarlier.has(at(a, m))) && months.every((m) => m < began(a) || seen.has(at(a, m)));
    if (fromTheStart && inBoth.every(rowsIn)) before = sumsOf(ctx, earlierRows, cars, large).themes;
  }

  const figures = (cents: number, monthlyCents: number, was: number | null): ThemeFigures => ({ monthlyCents, yearCents: n === YEAR ? cents : null, changePct: changeOf(cents, was) });
  const themes = THEMES.flatMap((theme) => {
    const lines = now.themes.get(theme.id);
    const cents = sum(lines?.values() ?? []);
    if (!lines || !cents) return [];
    const was = before && (before.get(theme.id) ?? new Map<string, number>());
    const listed = theme.lines.filter((l) => lines.get(l.id));
    // a few cents of money back alone round to -0, which is 0
    const monthlyCents = Math.round(cents / n) || 0;
    const shares = sharedOut(listed.map((l) => lines.get(l.id)!), n, monthlyCents);
    const row: ThemeSum = {
      id: theme.id,
      heading: theme.heading,
      ...figures(cents, monthlyCents, was && sum(was.values())),
      lines: listed.map((l, i) => ({ id: l.id, heading: l.heading, ...figures(lines.get(l.id)!, shares[i]!, was && (was.get(l.id) ?? 0)) })),
    };
    return [{ cents, row }];
  });
  // the sort is stable: themes of one sum keep the order of the table
  themes.sort((a, b) => b.cents - a.cents);
  const totalCents = sum(themes.map((t) => t.cents));
  const apart = now.large.sort((a, b) => b.spend - a.spend || a.day - b.day || (a.id < b.id ? -1 : 1));

  return {
    window: { first: fromMonthIndex(months[0]!), last: fromMonthIndex(months[n - 1]!), months: n },
    themes: themes.map((t) => t.row),
    totalCents,
    totalMonthlyCents: sum(themes.map((t) => t.row.monthlyCents)),
    totalYearCents: n === YEAR ? totalCents : null,
    large: {
      cents: sum(apart.map((t) => t.spend)),
      count: apart.filter((t) => large.has(t.id)).length,
      rows: apart.map((t) => ({ id: t.id, date: t.bookingDate, payee: t.merchant, cents: t.spend })),
    },
    spendingCents: totalsOf(rows.map((t) => t.flows)).expenseCents,
  };
}
