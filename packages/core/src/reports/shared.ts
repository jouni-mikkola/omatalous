import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { themeWindow } from "../analysis/themes-report.ts";
import { isCompleteMonth } from "../analysis/usual.ts";
import { fromMonthIndex, monthEnd, monthIndex } from "../dates.ts";
import { BY_CATEGORY, fuelPurchases, themeOf, THEMES } from "../themes.ts";

/**
 * Month indexes covered by a range, capped to the latest `max` months. With a context, the months before the history
 * starts are left out (Viime vuosi of a history from September has four months, not eight empty ones before them); the
 * last month stays, so a range wholly before the history still has one.
 */
export function rangeMonthIndexes(range: DateRange, max = 24, ctx?: Pick<AnalysisContext, "dataFrom">): number[] {
  const end = monthIndex(range.to);
  const first = ctx?.dataFrom ? monthIndex(ctx.dataFrom) : -Infinity;
  const start = Math.min(end, Math.max(monthIndex(range.from), end - max + 1, first));
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export const monthLabels = (indexes: readonly number[]) => indexes.map(fromMonthIndex);

type MonthContext = AnalysisContext;

/**
 * The months a monthly average should divide by: those the range covers
 * from the 1st to the last day and that are complete (`isCompleteMonth`).
 * Early in a month, the current month would otherwise pull every average
 * down, and so would months before the first transaction. With none, there is
 * no average: a running month's spending so far is not a monthly figure.
 * With `accounts`, the months those accounts cover: a category's average runs
 * from the first month its own accounts were in the data, so a card linked
 * late gives its categories fewer months and leaves the others whole.
 */
export function fullMonths(ctx: MonthContext, range: DateRange, months: readonly number[], accounts?: ReadonlySet<string>): number[] {
  return months.filter((m) => {
    const label = fromMonthIndex(m);
    const start = `${label}-01`;
    const end = monthEnd(label);
    return start >= range.from && end <= range.to && isCompleteMonth(ctx, label, accounts);
  });
}

type Cars = Parameters<typeof themeOf>[2];

/** The categories Auto holds whole when the household has a car; it takes rows of no other category on a page. */
const CAR_CATEGORIES: ReadonlySet<string> = new Set(["car", "leasing", "vehicle_purchase"]);
const HEADINGS: ReadonlyMap<string, string> = new Map(THEMES.map((theme) => [theme.id, theme.heading]));

/** The cars that place a range's rows: the theme window's, else the fuel of the range's spending `rows`, as the themes report does. */
export function carsOf(ctx: AnalysisContext, rows: readonly AnalysisTx[]): Cars {
  return themeWindow(ctx)?.cars ?? { answer: null, purchases: fuelPurchases(rows) };
}

/** A row's group and its category row in a group. */
interface Place {
  theme: string;
  /** `theme/category`: a category the car takes some rows of is a row in Auto and a row in its own group. */
  key: string;
}

/**
 * The group of a row in Kategoriat and in the category rows of Menot kuukausittain: the theme `themeOf` gives it, the
 * one placement the themes of Menot kuukausittain and the themes report read too, so a group and its theme are one sum
 * (ADR 0004). With a car, Auto holds the car's insurance, tax and finance, and those categories have a row in Auto
 * beside their row in their own group.
 */
export function placeOf(ctx: AnalysisContext, t: AnalysisTx, cars: Cars): Place {
  const { theme } = themeOf(ctx, t, cars);
  return { theme, key: `${theme}/${t.category}` };
}

/** The name of a category row: a category outside its own group (the car's insurance in Auto) names the group it is in. */
export function placeLabel(theme: string, category: string, label: string): string {
  const home = BY_CATEGORY.get(category)?.theme ?? "other";
  return theme === home || CAR_CATEGORIES.has(category) ? label : `${label} (${themeHeading(theme)})`;
}

/** A theme's heading: the group a page shows. */
export const themeHeading = (theme: string): string => HEADINGS.get(theme) ?? theme;
