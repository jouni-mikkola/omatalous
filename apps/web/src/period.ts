import { addMonths, monthEnd } from "@banking/core";
import { monthLong } from "./format.ts";

/** Yhteenveto offers the running month and the one before it. The ids stay in a bookmark; the label is the month's name. */
const MONTH_IDS = ["month", "last-month"] as const;

/** "Lokakuu 2026" for `month` and "Syyskuu 2026" for `last-month`, by the server's today: a label alone has a capital. */
function monthPeriodLabel(id: (typeof MONTH_IDS)[number], today: string): string {
  const month = today.slice(0, 7);
  const name = monthLong(id === "month" ? month : addMonths(month, -1));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Raportit compares months and years, so none of its presets is a single month. */
export const REPORT_PERIODS = [
  { id: "3m", label: "3 kk" },
  { id: "6m", label: "6 kk" },
  { id: "12m", label: "12 kk" },
  { id: "year", label: "Tämä vuosi" },
  { id: "last-year", label: "Viime vuosi" },
] as const;

export interface PeriodPreset {
  id: string;
  label: string;
}

/** The pages that have a period switch, with the preset ids each offers and the one it opens on. */
const PAGES = {
  overview: { ids: MONTH_IDS as readonly string[], fallback: "month" },
  reports: { ids: REPORT_PERIODS.map((p) => p.id) as readonly string[], fallback: "12m" },
};
type PeriodPage = keyof typeof PAGES;
const hasSwitch = (page: string): page is PeriodPage => Object.hasOwn(PAGES, page);

/** The presets a page shows, labelled by the server's today; none for a page without a period switch. */
export function periodsOf(page: string, today: string): readonly PeriodPreset[] {
  if (page === "overview") return MONTH_IDS.map((id) => ({ id, label: monthPeriodLabel(id, today) }));
  return page === "reports" ? REPORT_PERIODS : [];
}

/** The pages that draw their own switch, in the block it changes: the shell draws none above them. */
const OWN_SWITCH: readonly string[] = ["overview"];

/** The presets the shell draws above a page: those of `periodsOf`, none for a page that draws its own switch. */
export function shellPeriodsOf(page: string, today: string): readonly PeriodPreset[] {
  return OWN_SWITCH.includes(page) ? [] : periodsOf(page, today);
}

/** The page a preset belongs to; null for an id no page offers. */
export function pageOfPeriod(id: string): PeriodPage | null {
  return (Object.keys(PAGES) as PeriodPage[]).find((page) => PAGES[page].ids.includes(id)) ?? null;
}

/** The preset a page shows for the address's `period`: that one when the page offers it, else the page's own default. */
export function periodFor(page: string, param: string | null): string {
  if (!hasSwitch(page)) return "month";
  return PAGES[page].ids.find((id) => id === param) ?? PAGES[page].fallback;
}

/**
 * Preset id → inclusive date range, relative to the server's "today". 3, 6 and
 * 12 kk are the last whole months: a running month holds this month's bills
 * but not yet its salary, which would make a year look like a loss. Any other
 * id is the running month, and "Tämä vuosi" runs to today.
 */
export function periodRange(period: string, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const prev = addMonths(month, -1);
  const lastMonths = (n: number) => ({ from: `${addMonths(month, -n)}-01`, to: monthEnd(prev) });
  switch (period) {
    case "last-month":
      return lastMonths(1);
    case "3m":
      return lastMonths(3);
    case "6m":
      return lastMonths(6);
    case "12m":
      return lastMonths(12);
    case "year":
      return { from: `${year}-01-01`, to: today };
    case "last-year":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    default:
      return { from: `${month}-01`, to: today };
  }
}
