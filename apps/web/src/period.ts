import { addMonths, monthEnd } from "@banking/core";
import { monthLong } from "./format.ts";
import { t } from "./text.ts";

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
  { id: "3m", get label() { return t("period.m3"); } },
  { id: "6m", get label() { return t("period.m6"); } },
  { id: "12m", get label() { return t("period.m12"); } },
  { id: "year", get label() { return t("period.year"); } },
  { id: "last-year", get label() { return t("period.last_year"); } },
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

/** The one question of Raportit that is about the running month, whatever period is chosen. */
const MONTH_QUESTION = "kuukausi";

/** The questions of Raportit whose reports answer the same for every period (`report-period.test.ts` asks each page for two), so their page draws no switch. */
export const PERIOD_FREE_QUESTIONS: readonly string[] = [MONTH_QUESTION, "velat"];

/**
 * The question an address asks for before any answer is there: the month question when it anchors the one section of
 * that page (#kuukausi, as Yhteenveto links it), else its `q`. Kept here so the shell need not load the report pages.
 */
export function askedQuestion(q: string | null, anchor: string | undefined): string | null {
  return anchor === MONTH_QUESTION ? MONTH_QUESTION : q;
}

/** The presets the shell draws above a page: those of `periodsOf`, none for a page that draws its own switch or a question the period does not change. */
export function shellPeriodsOf(page: string, today: string, question: string | null = null): readonly PeriodPreset[] {
  if (page === "reports" && question !== null && PERIOD_FREE_QUESTIONS.includes(question)) return [];
  return OWN_SWITCH.includes(page) ? [] : periodsOf(page, today);
}

/** The page a preset belongs to; null for an id no page offers. */
export function pageOfPeriod(id: string): PeriodPage | null {
  return (Object.keys(PAGES) as PeriodPage[]).find((page) => PAGES[page].ids.includes(id)) ?? null;
}

/**
 * The preset a page shows for the address's `period`: that one when the page offers it, else the page's own default.
 * Yhteenveto's default is the server's (`Meta.opening`): the last month until the running month's pay has come.
 */
export function periodFor(page: string, param: string | null, opening: "month" | "last-month" = "month"): string {
  if (!hasSwitch(page)) return "month";
  return PAGES[page].ids.find((id) => id === param) ?? (page === "overview" ? opening : PAGES[page].fallback);
}

/**
 * Preset id → inclusive date range, relative to the server's "today". 3, 6 and
 * 12 kk are the last whole months: a running month holds this month's bills
 * but not yet its salary, which would make a year look like a loss. Once the
 * salary has come (`opening` is "month", the month Yhteenveto opens on) the
 * running month is in them, so both pages read the same month. Any other
 * id is the running month, and "Tämä vuosi" runs to today.
 */
export function periodRange(period: string, today: string, opening: "month" | "last-month" = "last-month"): { from: string; to: string } {
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const prev = addMonths(month, -1);
  const lastMonths = (n: number) => (opening === "month" && period !== "last-month" ? { from: `${addMonths(month, 1 - n)}-01`, to: today } : { from: `${addMonths(month, -n)}-01`, to: monthEnd(prev) });
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

