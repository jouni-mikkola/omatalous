// Decision: find the month a category jumped
import { CATEGORIES, getCategory } from "../categories.ts";
import { type AnalysisContext, type AnalysisTx, inDays } from "../analysis/context.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { themeWindow } from "../analysis/themes-report.ts";
import { largePurchases } from "../analysis/large.ts";
import { completeMonthsBefore, gateFor, usualCents, usualSpending } from "../analysis/usual.ts";
import { fromMonthIndex, monthEnd, monthIndex } from "../dates.ts";
import { fuelPurchases, themeOf, THEMES } from "../themes.ts";
import { fullMonths, monthLabels, rangeMonthIndexes } from "./shared.ts";

/** The rows of the view that have a row of their own at most, and the payees a line names. */
const THEME_ROWS = 8;
const PAYEES = 5;
/** The months the strip draws at most, and the fewest it is worth drawing for. */
const STRIP_MONTHS = 12;
const STRIP_MIN = 4;
/** The rows named under the highest month. */
const PEAK_ROWS = 3;
/** Auton osto: money in on it that takes back no payment (the old car sold) stands with the large purchases. */
const CAR_PURCHASE = "vehicle_purchase";

/** Figures of a row in every month shown, over the range, against the months before. */
interface PivotFigures {
  /** One per month of `months`; a month before the first shown counts in `totalCents` only. */
  values: number[];
  totalCents: number;
  /** The median of the complete months before the newest complete month, also those before the range; null under three. */
  usualCents: number | null;
  /** The newest complete month less the usual one: set only when that month is outside the lowest-to-highest of the months before and over the household's gate. */
  diffCents: number | null;
}

/** A payee of a line, or the rest of them: its sums by month. */
interface PivotPayee {
  name: string;
  values: number[];
  totalCents: number;
}

interface PivotLine extends PivotFigures {
  id: string;
  label: string;
  /** The category whose rows are the line (the link of a row to Tapahtumat); null for a line of Auto, which is no category. */
  category: string | null;
  /** The largest payees of the line by `spend` over the range, at most five. */
  payees: PivotPayee[];
  /** The line less its payees in every month; null when the payees are all of it. */
  other: PivotPayee | null;
}

interface PivotTheme extends PivotFigures {
  id: string;
  label: string;
  lines: PivotLine[];
}

/** One of the largest rows of a month: a line of a theme, or the large purchases. */
interface PivotPeakRow {
  key: string;
  label: string;
  cents: number;
  /** The category to filter Tapahtumat by; null where the row is no category. */
  category: string | null;
}

export interface PivotRow {
  category: string;
  label: string;
  group: string;
  values: number[];
  totalCents: number;
  /** Over the complete months of the range; null without one (a running month is not a monthly figure). */
  averageCents: number | null;
}

export interface PivotReport {
  months: string[];
  /** Per month: it has ended, the range covers it from the 1st and the history does too. An incomplete month is "vajaa". */
  complete: boolean[];
  rows: PivotRow[];
  monthTotals: number[];
  totalCents: number;
  /** Total per month over complete months (the average of the total row); null without a complete month. */
  averageCents: number | null;
  /**
   * The same spending by theme, placed as the themes report places it (`themeOf`, the cars of `themeWindow`): the rows
   * with a sum of 2 % of the spending or more, the eight largest at most, the largest first. With `rest`, `large` the
   * rows add up to `monthTotals` in every month. `rows` stays by category.
   */
  themes: PivotTheme[];
  /** Everything else, under one row that opens to its themes; null when every theme has a row. */
  rest: (PivotFigures & { themes: PivotTheme[] }) | null;
  /** The large purchases, which no theme holds (`largePurchases`), and how many rows of them there are. */
  large: (PivotFigures & { count: number }) | null;
  /** Index in `months` of the newest complete month; null without one. */
  last: number | null;
  /** The months of the strip: the newest twelve complete ones, oldest first; empty under four. */
  strip: number[];
  /** Index in `months` of the highest month of the strip, the newest on a tie; null without a strip. */
  peak: number | null;
  /** The three largest rows of the peak month, largest first. */
  peakRows: PivotPeakRow[];
  /** The cents of the card bills by month, drawn first when a server fills it. */
  cardBills?: number[];
}

/** The sum of arrays of one length, elementwise. */
const addUp = (arrays: readonly (readonly number[])[], n: number) => Array.from({ length: n }, (_, i) => arrays.reduce((s, a) => s + a[i]!, 0));

/** The sums of a row while the rows are read: by month shown, over the range, and in the months before. */
interface Acc {
  values: number[];
  total: number;
  before: number[];
}

/** Category × month spending matrix (at most 24 months), largest categories first. */
export function pivotReport(ctx: AnalysisContext, range: DateRange): PivotReport {
  const months = rangeMonthIndexes(range, 24, ctx);
  const first = months[0]!;
  const rows = new Map<string, { values: number[]; total: number }>();
  for (const t of inDays(ctx, toDayRange(range))) {
    if (!t.spend) continue;
    const e = rows.get(t.category) ?? { values: months.map(() => 0), total: 0 };
    // months older than the 24 shown count in the total only, so it equals the dashboard's for a long range
    if (t.month >= first) e.values[t.month - first]! += t.spend;
    e.total += t.spend;
    rows.set(t.category, e);
  }
  const full = fullMonths(ctx, range, months);
  const averaged = full.map((m) => m - first);
  const out = [...rows.entries()]
    .map(([category, { values, total }]) => {
      const c = getCategory(category);
      const averageCents = averaged.length ? Math.round(averaged.reduce((s, i) => s + values[i]!, 0) / averaged.length) : null;
      return { category, label: c.label, group: c.group, values, totalCents: total, averageCents };
    })
    // a category with more refunds than spending stays, below the others with its minus: the totals are then the
    // expense of the cashflow report, and the rows add up to them
    .filter((r) => r.totalCents !== 0 || r.values.some((v) => v !== 0))
    .sort((a, b) => b.totalCents - a.totalCents);
  const monthTotals = months.map((_, i) => out.reduce((s, r) => s + r.values[i]!, 0));
  const totalCents = out.reduce((s, r) => s + r.totalCents, 0);
  const last = averaged.length ? averaged[averaged.length - 1]! : null;
  const stripped = averaged.slice(-STRIP_MONTHS);
  const strip = stripped.length >= STRIP_MIN ? stripped : [];
  // the newest month wins a tie
  const peak = strip.length ? strip.reduce((best, i) => (monthTotals[i]! >= monthTotals[best]! ? i : best)) : null;
  return {
    months: monthLabels(months),
    complete: months.map((m) => full.includes(m)),
    rows: out,
    monthTotals,
    totalCents,
    averageCents: averaged.length ? Math.round(averaged.reduce((s, i) => s + monthTotals[i]!, 0) / averaged.length) : null,
    ...byTheme(ctx, range, months, last, totalCents, peak),
    last,
    strip,
    peak,
  };
}

/** Is a sum nothing at all: no total and no month with money in it or out? */
const nothing = (a: Pick<Acc, "values" | "total">) => a.total === 0 && a.values.every((v) => v === 0);

/** The ids of the categories: a line with such an id has the category's rows behind it, except in Auto, whose lines are what a row was for. */
const CATEGORY_IDS: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.id));

/**
 * The spending of the range by theme, line and payee, and the large purchases apart. Every row of the range is in
 * exactly one place, so the rows add up to `monthTotals` to the cent. `last` is the newest complete month: its usual
 * level is the median of the complete months before it, also those before the range.
 */
function byTheme(ctx: AnalysisContext, range: DateRange, months: readonly number[], last: number | null, grandTotal: number, peak: number | null) {
  const n = months.length;
  const first = months[0]!;
  const before = last === null ? [] : completeMonthsBefore(ctx, fromMonthIndex(months[last]!));
  const beforeFirst = before.length ? monthIndex(before[0]!) : 0;
  const fresh = (): Acc => ({ values: new Array<number>(n).fill(0), total: 0, before: new Array<number>(before.length).fill(0) });
  const rows = inDays(ctx, toDayRange(range)).filter((t) => t.spend);
  // the window's cars place the rows as the themes report does; with no window the range's own fuel stands in
  const cars = themeWindow(ctx)?.cars ?? { answer: null, purchases: fuelPurchases(rows) };
  const bigOnes = largePurchases(ctx);
  // a large purchase, the money back for one, and money in on Auton osto that takes back no payment
  const apart = (t: AnalysisTx) => bigOnes.has(ctx.returns.get(t.id) ?? t.id) || (t.spend < 0 && t.category === CAR_PURCHASE && !ctx.returns.has(t.id));

  const themeAcc = new Map<string, Acc>();
  const lineAcc = new Map<string, Acc>();
  const payeeAcc = new Map<string, Map<string, Pick<Acc, "values" | "total">>>();
  const big = fresh();
  let bigCount = 0;
  const add = (a: Pick<Acc, "values" | "total">, t: AnalysisTx) => {
    // months older than the shown ones count in the total only
    if (t.month >= first) a.values[t.month - first]! += t.spend;
    a.total += t.spend;
  };
  const of = <K>(m: Map<string, K>, key: string, make: () => K): K => m.get(key) ?? (m.set(key, make()), m.get(key)!);
  for (const t of rows) {
    if (apart(t)) {
      add(big, t);
      if (bigOnes.has(t.id)) bigCount++;
      continue;
    }
    const p = themeOf(ctx, t, cars);
    const key = `${p.theme}/${p.line}`;
    add(of(themeAcc, p.theme, fresh), t);
    add(of(lineAcc, key, fresh), t);
    add(of(of(payeeAcc, key, () => new Map()), t.merchant, () => ({ values: new Array<number>(n).fill(0), total: 0 })), t);
  }
  if (before.length) {
    const earlier = inDays(ctx, toDayRange({ from: `${before[0]}-01`, to: monthEnd(before[before.length - 1]!) }));
    for (const t of earlier) {
      if (!t.spend || apart(t)) continue;
      const p = themeOf(ctx, t, cars);
      // only a theme or a line the range has: the months before add nothing to the rows of the range
      for (const a of [themeAcc.get(p.theme), lineAcc.get(`${p.theme}/${p.line}`)]) if (a) a.before[t.month - beforeFirst]! += t.spend;
    }
  }

  const gate = last === null ? 0 : gateFor(usualSpending(ctx, fromMonthIndex(months[last]!)) ?? 0);
  const figures = (a: Acc): PivotFigures => {
    const now = last === null ? null : a.values[last]!;
    const usual = usualCents(a.before);
    const outside = now !== null && (now < Math.min(...a.before) || now > Math.max(...a.before));
    return { values: a.values, totalCents: a.total, usualCents: usual, diffCents: usual !== null && now !== null && outside && Math.abs(now - usual) >= gate ? now - usual : null };
  };

  const all: PivotTheme[] = THEMES.flatMap((def) => {
    const acc = themeAcc.get(def.id);
    if (!acc || nothing(acc)) return [];
    const lines = def.lines.flatMap((l): PivotLine[] => {
      const key = `${def.id}/${l.id}`;
      const a = lineAcc.get(key);
      if (!a || nothing(a)) return [];
      const named = [...(payeeAcc.get(key) ?? [])]
        .map(([name, p]): PivotPayee => ({ name, values: p.values, totalCents: p.total }))
        .sort((x, y) => y.totalCents - x.totalCents || (x.name < y.name ? -1 : 1));
      const rest = named.slice(PAYEES);
      return [
        {
          id: l.id,
          label: l.heading,
          category: def.id !== "car" && CATEGORY_IDS.has(l.id) ? l.id : null,
          ...figures(a),
          payees: named.slice(0, PAYEES),
          other: rest.length ? { name: "Muut", values: addUp(rest.map((p) => p.values), n), totalCents: rest.reduce((s, p) => s + p.totalCents, 0) } : null,
        },
      ];
    });
    return [{ id: def.id, label: def.heading, ...figures(acc), lines }];
  });
  // the sort is stable: themes of one sum keep the order of the table
  all.sort((a, b) => b.totalCents - a.totalCents);
  const listed = all.filter((t) => t.totalCents > 0 && t.totalCents * 50 >= grandTotal).slice(0, THEME_ROWS);
  const themes = all.filter((t) => listed.includes(t));
  const others = all.filter((t) => !listed.includes(t));
  const restAcc: Acc = {
    values: addUp(others.map((t) => t.values), n),
    total: others.reduce((s, t) => s + t.totalCents, 0),
    before: addUp(others.map((t) => themeAcc.get(t.id)!.before), before.length),
  };

  const peakRows: PivotPeakRow[] = [];
  if (peak !== null) {
    for (const t of all) for (const l of t.lines) peakRows.push({ key: `${t.id}/${l.id}`, label: l.label === "Muut" ? t.label : l.label, cents: l.values[peak]!, category: l.category });
    peakRows.push({ key: "large", label: "Suuret hankinnat", cents: big.values[peak]!, category: null });
    peakRows.sort((a, b) => b.cents - a.cents);
    peakRows.splice(PEAK_ROWS);
  }
  return {
    themes,
    rest: others.length ? { ...figures(restAcc), themes: others } : null,
    // a large purchase is no usual level and no change: it is the month's one-off
    large: nothing(big) ? null : { values: big.values, totalCents: big.total, usualCents: null, diffCents: null, count: bigCount },
    peakRows: peakRows.filter((r) => r.cents > 0),
  };
}
