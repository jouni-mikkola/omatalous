// Decision: where the month's money went, told once
import { date, money, monthLong, percent } from "../../format.ts";
import type { DashboardData } from "@banking/core";
import type { Before } from "./waterfall.ts";

/** "2026-10" gives "lokakuu": the month's name alone, as it stands after a label. */
const monthWord = (month: string) => monthLong(month).replace(/ \d+$/, "");

/** "2026-10" gives "Lokakuu": the month's name alone, as a head. */
export const monthName = (month: string) => {
  const word = monthWord(month);
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/** A purchase of the large ones: its day, its payee and its sum. */
interface LargeRow {
  key: string;
  date: string;
  payee: string;
  sum: string;
}

/** The large purchases of the window that core gives its themes over: one sum, which opens to the rows it is made of. */
interface Large {
  label: string;
  sum: string;
  rows: LargeRow[];
}

/** Said under the waterfall when the comparison leaves an account out, whether it is still told or hidden. */
const LEFT_OUT_NOTE = "Vertailu on laskettu vain samoista tileistä molemmilta jaksoilta.";

export interface IncomeSpendingView {
  /** The savings rate of a whole month, with the label that names the month; null when core tells none of one. */
  savings: { label: string; text: string } | null;
  /** The fixed costs of a month, when there are any. */
  fixed: string | null;
  /** The chart "Menojen kertymä": the running month's, once something is spent. */
  chart: boolean;
  /** What the month before had, told in the open rows; null when the months do not compare. */
  before: Before | null;
  /** Said under the waterfall when the comparison leaves an account out: null when none is left out. */
  note: string | null;
  /** The large purchases, when core has them; null when it has none. */
  large: Large | null;
  /** The month has spending: the links to the merchants and to the months are drawn. */
  spending: boolean;
}

/**
 * The savings rate the block tells is a whole month's: the chosen month once it has ended, the last complete one while
 * a month runs. A month the history covers in part, or one still running, has none.
 */
function savingsOf({ basis, month, totals }: DashboardData["bridge"]): IncomeSpendingView["savings"] {
  if ((basis !== "range" && basis !== "last") || !month || totals.savingsRate === null) return null;
  return { label: `Säästöaste, ${monthWord(month)}`, text: percent(totals.savingsRate) };
}

/** The large purchases as the page prints them: the label names how many there are. */
function largeOf(themes: DashboardData["themes"]): Large | null {
  if (!themes || themes.large.rows.length === 0) return null;
  const { count, cents, rows } = themes.large;
  return { label: count > 0 ? `Suuret hankinnat (${count})` : "Suuret hankinnat", sum: money(cents), rows: rows.map((r) => ({ key: r.id, date: date(r.date), payee: r.payee, sum: money(r.cents) })) };
}

/** What the block "Tulot ja menot" draws beside the waterfall for a month, from the answer of the server alone. */
export function incomeSpendingView(data: DashboardData): IncomeSpendingView {
  return {
    savings: savingsOf(data.bridge),
    fixed: data.fixedMonthlyCents > 0 ? money(data.fixedMonthlyCents) : null,
    chart: data.running && data.totals.expenseCents > 0,
    before: data.comparable
      ? { name: monthName(data.range.previousFrom.slice(0, 7)), incomeCents: data.previousTotals.incomeCents, categories: new Map(data.categories.map((c) => [c.category, c.previousCents])) }
      : null,
    note: data.leftOutAccounts ? LEFT_OUT_NOTE : null,
    large: largeOf(data.themes),
    spending: data.categories.length > 0,
  };
}
