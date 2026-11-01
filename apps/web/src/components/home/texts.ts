/**
 * The sentences of the first page, from the fields of `DashboardData["home"]`. Pure, so a test reads them without a
 * page. Nothing is added up here: every euro figure is a field the server gives, and a sentence that sets one against
 * another names the comparison (Odotettu, the month's expected level, ADR 0021).
 */
import { joinRange, localeOf, MIN_COMPARE_MONTHS } from "@banking/core";
import { clockTime, completeMonths, dayMonth, language, localDay, monthLong, money } from "../../format.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";

export type HomeData = DashboardData["home"];
export type RunwayData = NonNullable<HomeData["runway"]>;
export type PaceData = NonNullable<HomeData["pace"]>;

/** "3 600–3 900 €": the unit once. */
export const euroRange = (low: number, high: number): string => joinRange(money(low, false), money(high, false));

/** The middle of a range, rounded to a sum a person would say: 4 313–4 655 € is "noin 4 500 €". */
export const aboutSum = (low: number, high: number): string => {
  const mid = Math.abs(low + high) / 2;
  const step = mid >= 100_000 ? 10_000 : mid >= 10_000 ? 5_000 : 1_000;
  return money(Math.round(mid / step) * step, false);
};

/** The heading question; the payday names the day the money has to last to. */
export function questionText(runway: RunwayData | null): string {
  return runway?.payday ? t("home.question_payday", { date: dayMonth(runway.payday.date) }) : t("home.question_next");
}

export interface AnswerText {
  /** The sentence before the figure. */
  lead: string;
  /** The figure the sentence ends on, as money; null when the sentence has none. */
  cents: number | null;
  /** The sentences under it. */
  detail: string[];
}

/** The reason there is no everyday spending, and so no range for the payday. */
function gapText(reason: Extract<RunwayData["leftOnPayday"], { known: false }>["reason"]): string | null {
  switch (reason) {
    case "history":
      return t("home.gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) });
    case "cards":
      return t("home.gap_cards");
    case "late":
      return t("home.gap_late");
    case "no-payday":
      return t("home.gap_no_payday");
    default:
      return null;
  }
}

/** The answer in a sentence ending on the sum left after the payments, and what follows from it. */
export function answerText(runway: RunwayData): AnswerText {
  const { sum, verdict, allowancePerDayCents, days, takenOffPerDayCents, leftOnPayday: left } = runway;
  if (!sum || verdict === "unknown") return { lead: t("home.no_balance"), cents: null, detail: [] };
  const perDay = allowancePerDayCents !== null && days ? [tn(days, "home.per_day_one", "home.per_day_many", { sum: money(allowancePerDayCents, false) })] : [];
  const sumText = left.known ? aboutSum(left.lowCents, left.highCents) : "";
  const based = left.known ? t("home.based", { sum: money(takenOffPerDayCents, false) }) : "";
  const gap = left.known ? null : gapText(left.reason);
  if (sum.freeCents < 0) return { lead: t("home.lead_short_of"), cents: -sum.freeCents, detail: [] };
  if (verdict === "short" && left.known) {
    return { lead: t("home.lead_short"), cents: sum.freeCents, detail: [...perDay, t("home.detail_short", { based, sum: sumText })] };
  }
  if (verdict === "tight" && left.known) {
    return { lead: t("home.lead_tight"), cents: sum.freeCents, detail: [...perDay, t("home.detail_tight", { based, sum: sumText })] };
  }
  if (!left.known) return { lead: t("home.lead_covered"), cents: sum.freeCents, detail: [...perDay, ...(gap ? [gap] : [])] };
  return { lead: t("home.lead_enough"), cents: sum.freeCents, detail: [...perDay, t("home.detail_enough", { based, sum: sumText })] };
}

/** "Lokakuu": a month's name as a label starts it. */
export const monthTitle = (month: string): string => {
  const name = monthLong(month).split(" ")[0]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** When the accounts were last fetched, as the line says it: "tänään 6.02" or "24.10. 18.15". null without a fetch. */
export function updatedText(iso: string | null, today: string): string | null {
  if (!iso) return null;
  const day = localDay(iso);
  return `${day === today ? t("home.today") : dayMonth(day)} ${clockTime(iso)}`;
}

/** "Lokakuu 2026 · päivä 25/31 · päivitetty tänään 6.02": the line under the heading. */
export function monthLine(month: string, pace: PaceData | null, updated: string | null): string {
  const parts = [`${monthTitle(month)} ${month.slice(0, 4)}`];
  if (pace) parts.push(t("home.line_day", { day: pace.day, days: pace.daysInMonth }));
  if (updated) parts.push(t("home.line_updated", { updated }));
  return parts.join(" · ");
}

/** What the missing card purchases do to the figures, in one sentence; null when none are missing. */
export function reliabilityText(reliability: HomeData["reliability"]): string | null {
  const gap = reliability.cardGap;
  return gap ? t("home.cards_missing", { cause: gap.cause }) : null;
}

/** The headline of the pace block: the difference, and what it is set against. */
export function paceHeadline(pace: PaceData): string {
  const { diffCents } = pace;
  if (Math.abs(diffCents) < 100) return t("home.pace_same");
  return t(diffCents > 0 ? "home.pace_more" : "home.pace_less", { sum: money(Math.abs(diffCents), false) });
}

/** Where the spending stands against the range the base months spread over. */
export function paceRangeText(pace: PaceData): string {
  const range = euroRange(pace.lowCents, pace.highCents);
  const where = t(pace.position === "within" ? "home.where_within" : pace.position === "below" ? "home.where_below" : "home.where_above");
  return t("home.pace_range", { spent: money(pace.spentCents, false), range, where });
}

/** Why there is no expected month to set the pace against. */
export function paceGapText(gap: HomeData["paceGap"]): string | null {
  if (gap === "cards") return t("home.pace_gap_cards");
  if (gap === "history") return t("home.pace_gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) });
  return null;
}

/** The buffer in months: "4,5 kuukautta". */
export function bufferText(months: number): string {
  const text = months.toLocaleString(localeOf(language()), { maximumFractionDigits: 1 });
  return t(text === "1" ? "home.buffer_one" : "home.buffer_many", { count: text });
}

/** What the buffer months are the quotient of, so the monthly sum beside them is the one they divide by. */
export function bufferBasisText(direction: HomeData["direction"]): string | null {
  if (direction.bufferNetCents === null || direction.bufferSpendCents === null) return null;
  return t("home.buffer_basis", { net: money(direction.bufferNetCents, false), spend: money(direction.bufferSpendCents, false) });
}

/** The direction of the last three months in a word. */
export function directionText(direction: HomeData["direction"]): string | null {
  if (direction.direction === null) return null;
  const word = t(direction.direction === "up" ? "home.dir_up" : direction.direction === "down" ? "home.dir_down" : "home.dir_same");
  return t("home.direction", { word });
}
