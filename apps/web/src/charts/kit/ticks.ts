import { monthLabel, moneyTick, percent } from "../../format.ts";
import { labelsWithRoom } from "../draw.ts";

/** A money tick with the minus the app prints (U+2212): −1 500 €. */
export function moneyAxis(cents: number): string {
  return cents < 0 ? `−${moneyTick(-cents)}` : moneyTick(cents);
}

/** A share tick: 0.25 → "25 %". */
export function shareAxis(share: number): string {
  return percent(share);
}

/** Monday first, as the Finnish calendar is. */
export const WEEKDAYS_SHORT = ["ma", "ti", "ke", "to", "pe", "la", "su"] as const;

/** 0 for Monday to 6 for Sunday, by the calendar alone. */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

/**
 * The labels of a month axis and which of them print: by room in pixels, the units in `keep` first (a last value, an
 * event), and the year under the first printed January only when every month prints (as `hasYearLine` in `Axes.tsx`).
 */
export function monthTicks(months: readonly string[], pitch: number, keep: ReadonlySet<number> = new Set()): { text: string; year: string | null; printed: boolean }[] {
  const texts = months.map((m) => monthLabel(m));
  const room = labelsWithRoom(texts, pitch, keep);
  const every = room.size === months.length;
  return months.map((m, i) => ({ text: texts[i]!, year: every && m.endsWith("-01") ? m.slice(0, 4) : null, printed: room.has(i) }));
}

/** The days of a month axis that carry a label: 1, 5, 10, 15, 20, 25 and the last, the 25th leaving out when the last is close. */
export function dayTicks(days: number): number[] {
  return [1, 5, 10, 15, 20, 25, days].filter((d, i, a) => d <= days && a.indexOf(d) === i && !(d === 25 && days - 25 < 3));
}
