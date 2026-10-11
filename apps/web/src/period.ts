import { addMonths, monthEnd } from "@banking/core";

/** The month page offers the running month and the one before it. */
export const MONTH_PERIODS = [
  { id: "month", label: "Tämä kuu" },
  { id: "last-month", label: "Viime kuu" },
] as const;

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

/** The pages that have a period switch, with the presets each offers and the one it opens on. */
const PAGES = {
  overview: { presets: MONTH_PERIODS as readonly PeriodPreset[], fallback: "month" },
  reports: { presets: REPORT_PERIODS as readonly PeriodPreset[], fallback: "12m" },
} as const;
type PeriodPage = keyof typeof PAGES;
const hasSwitch = (page: string): page is PeriodPage => Object.hasOwn(PAGES, page);

/** The presets a page shows; none for a page without a period switch. */
export function periodsOf(page: string): readonly PeriodPreset[] {
  return hasSwitch(page) ? PAGES[page].presets : [];
}

/** The page a preset belongs to; null for an id no page offers. */
export function pageOfPeriod(id: string): PeriodPage | null {
  return (Object.keys(PAGES) as PeriodPage[]).find((page) => PAGES[page].presets.some((p) => p.id === id)) ?? null;
}

/** The preset a page shows for the address's `period`: that one when the page offers it, else the page's own default. */
export function periodFor(page: string, param: string | null): string {
  return periodsOf(page).find((p) => p.id === param)?.id ?? (hasSwitch(page) ? PAGES[page].fallback : "month");
}

/**
 * Preset id → inclusive date range, relative to the server's "today". 3, 6 and
 * 12 kk are the last whole months: a running month holds this month's bills
 * but not yet its salary, which would make a year look like a loss. The
 * running month is "Tämä kuu", and "Tämä vuosi" runs to today.
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
