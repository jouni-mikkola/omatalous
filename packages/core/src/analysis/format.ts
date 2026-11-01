import { DEFAULT_LANGUAGE, LANGUAGES, type Language, localeOf } from "../locale.ts";

const EUR = Object.fromEntries(
  LANGUAGES.map((l) => [l, [new Intl.NumberFormat(localeOf(l), { style: "currency", currency: "EUR" }), new Intl.NumberFormat(localeOf(l), { style: "currency", currency: "EUR", maximumFractionDigits: 0 })] as const]),
) as Record<Language, readonly [Intl.NumberFormat, Intl.NumberFormat]>;

/** 123456 → "1 234,56 €" (or "1 235 €" without decimals); in English "€1,234.56". Used in insight texts. */
export function formatEur(cents: number, decimals = true, lang: Language = DEFAULT_LANGUAGE): string {
  // Intl prints "−0 €" for -0 and for a negative that rounds to zero; zero has no sign.
  const euros = cents / 100;
  const shown = Math.abs(euros) < (decimals ? 0.005 : 0.5) ? 0 : euros;
  return EUR[lang][decimals ? 0 : 1].format(shown);
}

/**
 * Two formatted figures as one range, the unit once: "2 100–3 600 €", "9–13 %", "€2,100–3,600". An en dash and no spaces.
 * Finnish puts the unit after the figure, English the euro sign before it, so the one that repeats is the first's suffix
 * or the second's prefix.
 */
export function joinRange(low: string, high: string): string {
  if (low === high) return low;
  const prefixed = low.startsWith("€") && high.startsWith("€");
  return `${prefixed ? low : low.replace(/\s[€%]$/, "")}–${prefixed ? high.slice(1) : high}`;
}

/**
 * A forecast has no cents to its name: to the nearest 10 € under 1 000 €, 100 € under 10 000 €, else 1 000 €. The step
 * follows the size so a small monthly figure keeps its meaning and a five-year one does not claim a precision it lacks.
 */
export function roundForecast(cents: number): number {
  const euros = Math.abs(cents) / 100;
  const step = euros < 1000 ? 10 : euros < 10000 ? 100 : 1000;
  return Math.sign(cents) * Math.round(euros / step) * step * 100;
}

/** "2026-08-01" → "1.8.2026", in English "1/8/2026". A string split, so the runtime time zone cannot shift the day. */
export function formatFiDate(iso: string, lang: Language = DEFAULT_LANGUAGE): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return lang === "en" ? `${Number(d)}/${Number(m)}/${y}` : `${Number(d)}.${Number(m)}.${y}`;
}

/**
 * A period of days, the year and the month written once: "10.–30.9.2026", "1.9.–23.10.2026", "1.10.2025–30.9.2026";
 * one day is that day. An en dash and no spaces (docs/UI_STYLE.md).
 */
export function formatFiRange(from: string, to: string, lang: Language = DEFAULT_LANGUAGE): string {
  if (lang === "en") return from === to ? formatFiDate(from, lang) : `${formatFiDate(from, lang)}–${formatFiDate(to, lang)}`; // language-allow: dash the en dash is the period sign of UI_STYLE.md
  if (from === to) return formatFiDate(from);
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  if (y1 !== y2) return `${formatFiDate(from)}–${formatFiDate(to)}`;
  return m1 === m2 ? `${d1}.–${d2}.${m2}.${y2}` : `${d1}.${m1}.–${d2}.${m2}.${y2}`; // language-allow: dash the en dash is the period sign of UI_STYLE.md
}

/** The Finnish month stems, "tammi" to "joulu": the one table of month names ("kuu" after a stem is the name, `monthName`). */
export const MONTH_STEMS = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];

/** "joulu" for "2025-12": the first half of "joulu- ja heinäkuu". */
export const monthStem = (month: string): string => MONTH_STEMS[Number(month.slice(5, 7)) - 1]!;

/** "joulukuu" for "2025-12". */
export const monthName = (month: string): string => `${monthStem(month)}kuu`;

const MONTHS_INESSIVE = [
  "tammikuussa",
  "helmikuussa",
  "maaliskuussa",
  "huhtikuussa",
  "toukokuussa",
  "kesäkuussa",
  "heinäkuussa",
  "elokuussa",
  "syyskuussa",
  "lokakuussa",
  "marraskuussa",
  "joulukuussa",
];

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "joulukuu" for "2025-12", in English "December". */
export const monthNameIn = (month: string, lang: Language = DEFAULT_LANGUAGE): string => (lang === "en" ? MONTHS_EN[Number(month.slice(5, 7)) - 1]! : monthName(month));

/** "2026-03" → "maaliskuussa". */
export function monthInessive(month: string): string {
  return MONTHS_INESSIVE[Number(month.slice(5, 7)) - 1] ?? month;
}

/** ["A", "B", "C"] → "A, B ja C". */
export function finnishList(items: readonly string[], lang: Language = DEFAULT_LANGUAGE): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${lang === "en" ? "and" : "ja"} ${items[items.length - 1]}`;
}
