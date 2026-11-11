import { DEFAULT_LANGUAGE, LANGUAGES, formatEur, roundForecast, formatFiDate, formatFiRange, type Language, localeOf, type MessageCode, messageIn, MONTH_STEMS, monthName, roundedShares as coreRoundedShares, parseSeriesId, productCents, LOCALE } from "@banking/core";

// The member's language, set from the signed-in user (App.tsx) like the time zone below. Sums and dates follow it;
// the sentences around them follow the catalogue as it grows (docs/UI_STYLE.md). The language is also kept on the device
// (the key below), so the screens before a sign-in (sign-in, first set-up) read in the language last used here.
const DEVICE_KEY = "omatalous.language";

/** The language this device last used, or null (nothing kept, or storage that refuses). */
export function rememberedLanguage(): Language | null {
  try {
    const kept = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage?.getItem(DEVICE_KEY);
    return LANGUAGES.includes(kept as Language) ? (kept as Language) : null;
  } catch {
    return null;
  }
}

/** Keeps the language on this device for the screens before a sign-in. */
export function rememberLanguage(next: Language): void {
  try {
    (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage?.setItem(DEVICE_KEY, next);
  } catch {
    // storage is refused: the screens before a sign-in read Finnish
  }
}

let lang: Language = rememberedLanguage() ?? DEFAULT_LANGUAGE;

/** The signed-in member's language, kept on the device. No member (signed out, first set-up): the device's. */
export function setLanguage(next: Language | null | undefined): void {
  if (next) rememberLanguage(next);
  lang = next ?? rememberedLanguage() ?? DEFAULT_LANGUAGE;
  // read through globalThis so that core's type check, which has no DOM, can compile the web modules its probes import
  const doc = (globalThis as { document?: { documentElement: { lang: string } } }).document;
  if (doc) doc.documentElement.lang = lang;
}

/** The catalogue of the language could not be fetched (offline before the first visit): read Finnish this time, and keep the device's choice. */
export function fallBackToFinnish(): void {
  lang = DEFAULT_LANGUAGE;
  const doc = (globalThis as { document?: { documentElement: { lang: string } } }).document;
  if (doc) doc.documentElement.lang = lang;
}

export const language = (): Language => lang;

const num0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** The month stems of core, "tammi" to "joulu". */
export const MONTHS_SHORT = MONTH_STEMS;

/** Short month name for a chart axis, 1 to 12, in the member's language. */
export const monthTick = (n: number): string => (lang === "en" ? MONTHS_EN[n - 1]?.slice(0, 3) : MONTHS_SHORT[n - 1]) ?? "";

/** 123456 → "1 234,56 €" (in English "€1,234.56"): core's `formatEur`, the one euro formatter. */
export const money = (cents: number, decimals = true): string => formatEur(cents, decimals, lang);

/** A sum in an answer, in whole euros: 442413 → "4 424 €". An answer in cents is fake precision. */
export const answerMoney = (cents: number): string => money(cents, false);

/** A sum in a row, to the cent: 442413 → "4 424,13 €". A row is exact. */
export const rowMoney = (cents: number): string => money(cents);

/** A forecast figure, rounded by core's `roundForecast`. */
export const roundedMoney = (cents: number): string => money(roundForecast(cents), false);

const plain = (cents: number): string => (cents / 100).toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An amount in the account's own currency: 54000 USD → "540,00 USD". The euro keeps its sign (`money`). */
export function moneyIn(cents: number, currency: string): string {
  return currency.toUpperCase() === "EUR" ? money(cents) : `${plain(cents)} ${currency.toUpperCase()}`;
}

/** A series' name on every page that lists series: a product among several of its merchant says its price (Apple 12,99 €). */
export function seriesName(id: string): string | null {
  const merchant = parseSeriesId(id)?.merchant;
  if (merchant === undefined) return null;
  const price = productCents(id);
  return price === null ? merchant : `${merchant} ${money(price)}`;
}

/** Axis ticks: 150000 → "1 500 €" */
export function moneyTick(cents: number): string {
  return lang === "en" ? money(cents, false) : `${num0.format(cents / 100)} €`;
}

/** +12 € / −12 € / ±0 € for differences. */
export function signedMoney(cents: number): string {
  if (Math.abs(cents) < 100) return lang === "en" ? "±€0" : "±0 €";
  return `${cents > 0 ? "+" : "−"}${money(Math.abs(cents), false)}`;
}

/**
 * Euros typed the Finnish way ("1 234,56", "-50", "1234.5 €") → cents, or
 * null when the text is not an amount. Parsed as text so 0.1 + 0.2 never shows up.
 */
export function parseEuros(text: string): number | null {
  const s = text.replace(/[\s\u00a0\u202f€]/g, "").replace("−", "-").replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

/** 12345678 as "123 456,78": the text of an amount input, with plain spaces. */
export const eurosText = (cents: number): string => formatEur(cents).replace(/[\s\u00a0\u202f]*€$/, "").replace(/[\u00a0\u202f]/g, " ");

/** 325 as "3,25": the text of a rate input. */
export const rateText = (bp: number): string => `${Math.floor(bp / 100)},${String(bp % 100).padStart(2, "0")}`;

/** "3,25", "3.255 %" as hundredths of a percent, a half up; null when the text is no rate. Read as text, so no float decides a half. */
export function parseRate(text: string): number | null {
  const m = /^(\d{1,4})(?:[.,](\d+))?$/.exec(text.replace(/[\s\u00a0\u202f%]/g, ""));
  if (!m) return null;
  const decimals = (m[2] ?? "").padEnd(3, "0");
  return Number(m[1]) * 100 + Number(decimals.slice(0, 2)) + (decimals[2]! >= "5" ? 1 : 0);
}

/** A count with the grouping of the language: "1 234" in Finnish, "1,234" in English. */
export const count = (n: number): string => new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 0 }).format(n);

/** A number as `toLocaleString` writes it (up to three decimals) in the member's language. */
export const plainNumber = (n: number): string => n.toLocaleString(localeOf(lang));

/** A number with at most one decimal: "2,5" in Finnish, "2.5" in English. */
export const decimalMax1 = (n: number): string => n.toLocaleString(localeOf(lang), { maximumFractionDigits: 1 });

/** A number with a fixed count of decimals in the language's separator: "3,5" in Finnish, "3.5" in English. */
export const decimal = (n: number, digits = 1): string => n.toLocaleString(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "1 tapahtuma", "3 tapahtumaa" */
export function plural(n: number, one: string, many: string): string {
  return `${num0.format(n)} ${n === 1 ? one : many}`;
}

const NUMBER_WORDS = ["nolla", "yksi", "kaksi", "kolme", "neljä", "viisi", "kuusi", "seitsemän", "kahdeksan", "yhdeksän", "kymmenen"];
const NUMBER_WORDS_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** The history a figure waits for, with the number from core: "kolme päättynyttä kuukautta". Up to ten in words, more in digits. */
export function completeMonths(n: number): string {
  if (lang === "en") return `${NUMBER_WORDS_EN[n] ?? count(n)} complete ${n === 1 ? "month" : "months"}`;
  const word = NUMBER_WORDS[n] ?? num0.format(n);
  return `${word} ${n === 1 ? "päättynyt kuukausi" : "päättynyttä kuukautta"}`;
}

/** A share as a percent: 0.25 → "25 %". With decimals the fraction has that many digits: percent(0.0325, 2) → "3,25 %". */
export function percent(x: number, decimals = 0): string {
  if (decimals > 0) {
    const digits = Math.abs(x * 100).toLocaleString(localeOf(lang), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${x < 0 ? "−" : ""}${digits}${lang === "en" ? "%" : " %"}`;
  }
  const p = Math.round(x * 100);
  return `${p < 0 ? "−" : ""}${Math.abs(p)}${lang === "en" ? "%" : " %"}`;
}

/** Shares of one whole rounded together so they add up: core's `roundedShares`, the one rounding of printed shares. */
export const roundedShares = coreRoundedShares;

/** 48 → "48 %"; with decimals the units are of the last digit: 476 with one decimal → "47,6 %". */
export function shareText(units: number, decimals = 0): string {
  if (decimals <= 0) return `${units} %`;
  const unit = 10 ** decimals;
  return `${Math.floor(units / unit)},${String(units % unit).padStart(decimals, "0")} %`;
}

// Timestamps are read in the instance's time zone (Asetukset > Palvelin), whoever's browser shows them. App.tsx sets it
// from the server; Europe/Helsinki until then and when the server cannot be reached.
let zone = "Europe/Helsinki";
const parts = new Map<string, Intl.DateTimeFormat>();

export function setTimeZone(timezone: string | null | undefined): void {
  if (!timezone) return;
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: timezone });
    zone = timezone;
  } catch {
    // a name this browser does not know keeps the zone that was set
  }
}

export const timeZone = (): string => zone;

function formatter(kind: "day" | "clock"): Intl.DateTimeFormat {
  const key = `${kind}:${zone}:${lang}`;
  let f = parts.get(key);
  if (!f) {
    f =
      kind === "day"
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
        : new Intl.DateTimeFormat(localeOf(lang), { timeZone: zone, hour: "numeric", minute: "2-digit" });
    parts.set(key, f);
  }
  return f;
}

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The household's day of a date or a timestamp, "YYYY-MM-DD". A bare date is the day already and is returned as it is; a
 * timestamp (any ISO time with a Z or an offset) is read in the instance's time zone, so 22:30 UTC in October is the next day.
 */
export function localDay(iso: string): string {
  if (BARE_DAY.test(iso)) return iso;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso.slice(0, 10) : formatter("day").format(at);
}

/** "2026-10-09" → "9.10.2026"; a timestamp gives its day in the instance's time zone: "2026-10-23T22:30:00Z" → "24.10.2026". */
export function date(iso: string | null | undefined): string {
  return iso ? formatFiDate(localDay(iso), lang) : "–";
}

/** Two days as a period: "1.10.2025–30.9.2026", "10.–30.9.2026" inside one month (core's `formatFiRange`; timestamps give their day here). */
export function dateRange(from: string, to: string): string {
  return formatFiRange(localDay(from), localDay(to), lang);
}

/** "2026-10-12T11:35:00Z" → "13.35" in the instance's time zone. */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "–" : formatter("clock").format(at);
}

/** "2026-10-09" → "10/2026" */
export function monthYear(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-10-09" → "9.10." */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return lang === "en" ? `${Number(d)}/${Number(m)}` : `${Number(d)}.${Number(m)}.`;
}

const WEEKDAYS = { fi: ["su", "ma", "ti", "ke", "to", "pe", "la"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
/** The short weekday names for a calendar that starts on Monday. */
export const mondayFirstWeekdays = (): string[] => [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAYS[lang][i]!);

/** "2026-10-12" gives "ma 12.10."; a day of another year than today's has the year too. */
export function dayHeading(iso: string, today: string): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${iso.slice(0, 4) === today.slice(0, 4) ? dayMonth(iso) : date(iso)}`;
}

/**
 * The day and the time of a timestamp, in the instance's time zone, with the year only when it is not this year:
 * "2026-10-23T22:30:00Z" → "24.10. klo 1.30" in 2026 and "24.10.2026 klo 1.30" in 2027. `today` is the household's day.
 */
export function dateTime(iso: string | null | undefined, today: string = localDay(new Date().toISOString())): string {
  if (!iso) return "–";
  const day = localDay(iso);
  return `${day.slice(0, 4) === today.slice(0, 4) ? dayMonth(day) : date(iso)} ${lang === "en" ? "at" : "klo"} ${clockTime(iso)}`;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" → "loka" (with year when asked); in English "Oct" */
export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split("-");
  const name = lang === "en" ? MONTHS_EN[Number(m) - 1]?.slice(0, 3) ?? month : MONTH_STEMS[Number(m) - 1] ?? month;
  return withYear ? `${name} ${y}` : name;
}

export function monthLong(month: string): string {
  if (lang === "en") return `${MONTHS_EN[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** "marraskuu 2026" as "marraskuussa 2026" (in English "November 2026"): for a sentence that says what happened in the month. */
export const monthLongIn = (month: string): string => (lang === "en" ? monthLong(month) : monthLong(month).replace(/^(\S+)/, "$1ssa"));

/** Labels by key whose text follows the member's language: each read asks the catalogue, so a table built once stays right. */
function labelsOf<C extends MessageCode>(entries: Record<string, C>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(entries)) Object.defineProperty(out, key, { enumerable: true, get: () => messageIn(lang, code, ...([] as never)) });
  return out;
}

export const CADENCE_LABEL = labelsOf({
  weekly: "cadence.weekly",
  biweekly: "cadence.biweekly",
  semimonthly: "cadence.semimonthly",
  monthly: "cadence.monthly",
  bimonthly: "cadence.bimonthly",
  quarterly: "cadence.quarterly",
  semiannual: "cadence.semiannual",
  yearly: "cadence.yearly",
});

export const ACCOUNT_TYPE_LABEL = labelsOf({
  checking: "account_type.checking",
  savings: "account_type.savings",
  credit_card: "account_type.credit_card",
  loan: "account_type.loan",
  other: "account_type.other",
});

/** An IBAN in groups of four, "FI21 1234 5600 0007 85". A missing one gives "". */
export function formatIban(iban: string | null | undefined): string {
  return (iban ?? "").replace(/\s+/g, "").toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
}

/** What tells accounts of one holder apart: the IBAN in groups of four, else a card's masked number, else "". */
export function accountNumber(a: { iban: string | null; cardMask?: string | null }): string {
  return a.iban ? formatIban(a.iban) : (a.cardMask ?? "");
}
