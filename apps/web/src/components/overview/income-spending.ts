// Decision: where the month's money went, told once
import { dayMonth, money, monthLong, percent, signedMoney } from "../../format.ts";
import type { DashboardData } from "@banking/core";
import { type Ruler, rulerOf } from "./ruler.ts";

/** "2026-10" gives "lokakuu": the month's name alone, as it stands after a label. */
const monthWord = (month: string) => monthLong(month).replace(/ \d+$/, "");

/** "2026-10" gives "Lokakuu": the month's name alone, as a head. */
export const monthName = (month: string) => {
  const word = monthWord(month);
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/** A row of the months' table: the sum of the month, and of the month before when the history reaches it. */
interface Figure {
  label: "Tulot" | "Menot";
  text: string;
  previous: string | null;
}

/** A row of "Menot kategorioittain". */
interface Category {
  key: string;
  label: string;
  /** The category whose rows the name opens in Tapahtumat; null for the rest in one row, which has nowhere to go. */
  category: string | null;
  /** The bar's length against the longest row's, from 0 to 100. */
  share: number;
  text: string;
  /** The change from the month before; empty when there is none to tell. */
  change: string;
}

export interface IncomeSpendingView {
  /** The head of the month's column: "Lokakuu". */
  month: string;
  /**
   * The head of the column of the month before: its name, and while the month runs the day both months are counted to
   * ("12.9. mennessä"). null when the history does not reach it: the column is not drawn, and no row tells a change.
   */
  previous: { month: string; by: string | null } | null;
  figures: Figure[];
  /** The savings rate of a whole month, with the label that names the month; null when core tells none of one. */
  savings: { label: string; text: string } | null;
  /** The fixed costs of a month, when there are any. */
  fixed: string | null;
  /** The chart "Menojen kertymä": the running month's, once something is spent. */
  chart: boolean;
  /** The nine largest categories and the rest as one; none when the month has no spending. */
  categories: Category[];
  /** The ruler over the category bars, for the longest; null where there is none. */
  ruler: Ruler | null;
  /** What the table of categories says as its one row when it has no category. */
  empty: string | null;
}

const NO_ROWS = { running: "Ei vielä tapahtumia tässä kuussa.", ended: "Ei tapahtumia tässä kuussa." };
const NO_SPENDING = { running: "Ei vielä menoja tässä kuussa.", ended: "Ei menoja tässä kuussa." };

/** The categories told by name; the ones after them are one row. */
const NAMED = 9;

const NO_CHANGE = signedMoney(0);
/** "+17 €" or "−5 €"; a change that rounds to no euro is not told. */
function changeOf(cents: number): string {
  const text = signedMoney(cents);
  return text === NO_CHANGE ? "" : text;
}

/**
 * The nine largest categories, then the rest in one row; the change from the month before beside a row when there is one
 * to compare with. The rest is a row whenever it is not zero, also below zero (a refund larger than the small
 * categories), so the rows add up to "Menot"; a row below zero has its sum and no bar.
 */
function categoriesOf(data: DashboardData): { rows: Category[]; longest: number } {
  const named = data.categories.slice(0, NAMED);
  const rest = data.categories.slice(NAMED).reduce((s, c) => s + c.cents, 0);
  const longest = Math.max(rest, ...named.map((c) => c.cents), 0);
  // the bar is the row's sum against the longest as a percent to two decimals, the ruler's own precision
  const share = (cents: number) => (cents > 0 && longest > 0 ? Math.round((cents / longest) * 10000) / 100 : 0);
  const rows = [
    ...named.map((c) => ({
      key: c.category,
      label: c.label,
      category: c.category,
      share: share(c.cents),
      text: money(c.cents),
      change: data.comparable && c.previousCents ? changeOf(c.cents - c.previousCents) : "",
    })),
    ...(rest !== 0 ? [{ key: "rest", label: `Muut (${data.categories.length - NAMED})`, category: null, share: share(rest), text: money(rest), change: "" }] : []),
  ];
  return { rows, longest };
}

/**
 * The savings rate the block tells is a whole month's: the chosen month once it has ended, the last complete one while
 * a month runs. A month the history covers in part, or one still running, has none.
 */
function savingsOf({ basis, month, totals }: DashboardData["bridge"]): IncomeSpendingView["savings"] {
  if ((basis !== "range" && basis !== "last") || !month || totals.savingsRate === null) return null;
  return { label: `Säästöaste, ${monthWord(month)}`, text: percent(totals.savingsRate) };
}

/**
 * What the block "Tulot ja menot" draws for a month, from the answer of the server alone. The figures are the answer's:
 * "Menot" is `totals.expenseCents`, which is also the last point of the chart (core's test of the month's totals holds
 * that), so nothing here adds two sums together.
 */
export function incomeSpendingView(data: DashboardData): IncomeSpendingView {
  const { totals, previousTotals, range, running } = data;
  const state = running ? "running" : "ended";
  const noRows = totals.incomeCents === 0 && totals.expenseCents === 0 && totals.savedCents === 0 && totals.borrowedCents === 0;
  const { rows: categories, longest } = noRows ? { rows: [], longest: 0 } : categoriesOf(data);
  const before = (cents: number) => (data.comparable ? money(cents) : null);
  return {
    month: monthName(range.from.slice(0, 7)),
    previous: data.comparable ? { month: monthName(range.previousFrom.slice(0, 7)), by: running ? `${dayMonth(range.previousTo)} mennessä` : null } : null,
    figures: [
      { label: "Tulot", text: money(totals.incomeCents), previous: before(previousTotals.incomeCents) },
      { label: "Menot", text: money(totals.expenseCents), previous: before(previousTotals.expenseCents) },
    ],
    savings: savingsOf(data.bridge),
    fixed: data.fixedMonthlyCents > 0 ? money(data.fixedMonthlyCents) : null,
    chart: running && totals.expenseCents > 0,
    categories,
    ruler: rulerOf(longest),
    empty: categories.length > 0 ? null : (noRows ? NO_ROWS : NO_SPENDING)[state],
  };
}
