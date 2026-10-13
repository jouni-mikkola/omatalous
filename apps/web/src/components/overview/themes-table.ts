// Decision: what the money goes to over the last complete months, told once
import { CATEGORIES, monthEnd } from "@banking/core";
import { query } from "../../api.ts";
import { date, money } from "../../format.ts";
import { addsUp } from "../../marks.ts";
import type { DashboardData } from "../../types.ts";
import { type Ruler, rulerOf } from "./ruler.ts";

/** The report of core on the themes: the table draws it as it comes and computes none of its figures but the rest row's. */
type Themes = NonNullable<DashboardData["themes"]>;

/** The themes named in a row of their own; the ones after them are one row. */
const NAMED = 7;

/** The row that is open when the page opens: Ruoka, what most of a household's spending goes to. */
export const OPEN_AT_FIRST: ReadonlySet<string> = new Set(["food"]);

/** The open rows after a click on the row `id`: it closes when it was open and opens when it was not. */
export function toggled(open: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(open);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The ids of the categories: a line of a theme with such an id opens the rows of that category. */
const CATEGORY_IDS: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.id));

/** The figures of a row as the columns print them. `year` and `change` are empty where the table has no figure. */
interface Figures {
  monthly: string;
  year: string;
  change: string;
}

/** A line under a theme (or a theme under the rest row). */
interface Line extends Figures {
  key: string;
  label: string;
  /** The rows of the line's category in Tapahtumat over the window; null for a line that is not a category. */
  href: string | null;
}

/** A row of the table: a theme, or the rest of them in one row. */
interface Row extends Figures {
  key: string;
  label: string;
  /** The label opens and closes `lines`; false for a theme with the one line that carries its name. */
  toggle: boolean;
  /** A theme of one line that carries its name has no button: the label opens the rows of that line instead. */
  href: string | null;
  /** The bar's length against the largest theme's, from 0 to 100; 0 draws none (the rest row, a theme below zero). */
  share: number;
  lines: Line[];
}

interface LargeRow {
  key: string;
  date: string;
  payee: string;
  sum: string;
}

/** The large purchases under the table: one sum of the whole window, which opens to the rows it is made of. */
interface Large {
  label: string;
  sum: string;
  rows: LargeRow[];
}

interface ThemesTableView {
  /** The window as the heading's right side: "10/2025–9/2026". */
  period: string;
  /** Vuodessa is a column only for a window of twelve months. */
  year: boolean;
  /** Muutos is a column only when some row has a change to tell. */
  change: boolean;
  /** The ruler over the bars, for the longest row; null where there is none. */
  ruler: Ruler | null;
  /** The rows add up, to the cent, to Yhteensä in every column of sums: the table has the bracket. */
  adds: boolean;
  rows: Row[];
  total: Figures;
  large: Large | null;
}

/** "2025-10" gives "10/2025". */
const monthYear = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/** A change in whole percent with its sign; a row with none (or one of nothing) tells nothing. */
function changeText(pct: number | null): string {
  if (pct === null || pct === 0) return "";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}

export function themesTableView(report: Themes): ThemesTableView {
  const { window, themes, large } = report;
  const first = `${window.first}-01`;
  const last = monthEnd(window.last);
  const hasYear = window.months === 12;
  const year = (cents: number | null) => (hasYear && cents !== null ? money(cents) : "");
  const figures = (f: { monthlyCents: number; yearCents: number | null; changePct: number | null }): Figures => ({ monthly: money(f.monthlyCents), year: year(f.yearCents), change: changeText(f.changePct) });
  const top = Math.max(0, ...themes.map((t) => t.monthlyCents));
  const largest = Math.max(top, 1);
  // the bar is the row's sum against the longest as a percent to two decimals, the ruler's own precision
  const share = (cents: number) => (cents > 0 ? Math.round((cents / largest) * 10000) / 100 : 0);
  const yearsKnown = themes.every((t) => t.yearCents !== null);
  const adds =
    addsUp(themes.map((t) => t.monthlyCents), report.totalMonthlyCents) &&
    (!hasYear || (yearsKnown && report.totalYearCents !== null && addsUp(themes.map((t) => t.yearCents), report.totalYearCents)));

  const rows: Row[] = themes.slice(0, NAMED).map((t) => {
    // the lines of Auto say what a car row was for: their ids are not categories even where a word is the same
    const category = (id: string) => (t.id !== "car" && CATEGORY_IDS.has(id) ? `#/transactions${query({ category: id, from: first, to: last })}` : null);
    const only = t.lines.length === 1 && t.lines[0]!.heading === t.heading ? t.lines[0]! : null;
    return {
      key: t.id,
      label: t.heading,
      toggle: only === null,
      href: only ? category(only.id) : null,
      share: share(t.monthlyCents),
      ...figures(t),
      lines: only ? [] : t.lines.map((l) => ({ key: l.id, label: l.heading, href: category(l.id), ...figures(l) })),
    };
  });

  // the themes after the named ones: one row whose sums are theirs, so the columns add up to the total; no change, for
  // percent does not add
  const rest = themes.slice(NAMED);
  if (rest.length > 0) {
    const yearly = rest.reduce<number | null>((s, t) => (s === null || t.yearCents === null ? null : s + t.yearCents), 0);
    rows.push({
      key: "rest",
      label: `Muut (${rest.length})`,
      toggle: true,
      href: null,
      share: 0,
      monthly: money(rest.reduce((s, t) => s + t.monthlyCents, 0)),
      year: year(yearly),
      change: "",
      lines: rest.map((t) => ({ key: t.id, label: t.heading, href: null, ...figures(t) })),
    });
  }

  return {
    period: `${monthYear(window.first)}–${monthYear(window.last)}`,
    year: hasYear,
    ruler: rulerOf(top),
    adds,
    change: themes.some((t) => changeText(t.changePct) !== "" || t.lines.some((l) => changeText(l.changePct) !== "")),
    rows,
    total: { monthly: money(report.totalMonthlyCents), year: year(report.totalYearCents), change: "" },
    large:
      large.rows.length > 0
        ? {
            label: large.count > 0 ? `Suuret hankinnat (${large.count})` : "Suuret hankinnat",
            sum: money(large.cents),
            rows: large.rows.map((r) => ({ key: r.id, date: date(r.date), payee: r.payee, sum: money(r.cents) })),
          }
        : null,
  };
}
