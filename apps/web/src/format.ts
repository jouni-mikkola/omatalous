import { formatEur, formatFiDate, MONTH_STEMS, monthName, roundedShares as coreRoundedShares } from "@banking/core";

const num0 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 0 });

/** The month stems of core, "tammi" to "joulu". */
export const MONTHS_SHORT = MONTH_STEMS;

/** 123456 → "1 234,56 €": core's `formatEur`, the one euro formatter. */
export const money = formatEur;

const plain = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An amount in the account's own currency: 54000 USD → "540,00 USD". The euro keeps its sign (`money`). */
export function moneyIn(cents: number, currency: string): string {
  return currency.toUpperCase() === "EUR" ? money(cents) : `${plain.format(cents / 100)} ${currency.toUpperCase()}`;
}

/** Axis ticks: 150000 → "1 500 €" */
export function moneyTick(cents: number): string {
  return `${num0.format(cents / 100)} €`;
}

/** +12 € / −12 € / ±0 € for differences. */
export function signedMoney(cents: number): string {
  if (Math.abs(cents) < 100) return "±0 €";
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
export const eurosText = (cents: number): string => money(cents).replace(/[\s\u00a0\u202f]*€$/, "").replace(/[\u00a0\u202f]/g, " ");

/** 325 as "3,25": the text of a rate input. */
export const rateText = (bp: number): string => `${Math.floor(bp / 100)},${String(bp % 100).padStart(2, "0")}`;

/** "3,25", "3.255 %" as hundredths of a percent, a half up; null when the text is no rate. Read as text, so no float decides a half. */
export function parseRate(text: string): number | null {
  const m = /^(\d{1,4})(?:[.,](\d+))?$/.exec(text.replace(/[\s\u00a0\u202f%]/g, ""));
  if (!m) return null;
  const decimals = (m[2] ?? "").padEnd(3, "0");
  return Number(m[1]) * 100 + Number(decimals.slice(0, 2)) + (decimals[2]! >= "5" ? 1 : 0);
}

/** "1 tapahtuma", "3 tapahtumaa" */
export function plural(n: number, one: string, many: string): string {
  return `${num0.format(n)} ${n === 1 ? one : many}`;
}

const NUMBER_WORDS = ["nolla", "yksi", "kaksi", "kolme", "neljä", "viisi", "kuusi", "seitsemän", "kahdeksan", "yhdeksän", "kymmenen"];
const NUMBER_WORDS_GENITIVE = ["nollan", "yhden", "kahden", "kolmen", "neljän", "viiden", "kuuden", "seitsemän", "kahdeksan", "yhdeksän", "kymmenen"];

/**
 * The history a figure waits for, with the number from core: "kolme valmista kuukautta", or in the genitive "kolmen
 * valmiin kuukauden". Up to ten in words, more in digits.
 */
export function completeMonths(n: number, genitive = false): string {
  const word = (genitive ? NUMBER_WORDS_GENITIVE : NUMBER_WORDS)[n] ?? num0.format(n);
  if (genitive) return `${word} valmiin kuukauden`;
  return `${word} ${n === 1 ? "valmis kuukausi" : "valmista kuukautta"}`;
}

/** A share as a percent: 0.25 → "25 %". With decimals the fraction has that many digits: percent(0.0325, 2) → "3,25 %". */
export function percent(x: number, decimals = 0): string {
  if (decimals > 0) {
    const digits = Math.abs(x * 100).toLocaleString("fi-FI", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${x < 0 ? "−" : ""}${digits} %`;
  }
  const p = Math.round(x * 100);
  return `${p < 0 ? "−" : ""}${Math.abs(p)} %`;
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
    new Intl.DateTimeFormat("fi-FI", { timeZone: timezone });
    zone = timezone;
  } catch {
    // a name this browser does not know keeps the zone that was set
  }
}

export const timeZone = (): string => zone;

function formatter(kind: "day" | "clock"): Intl.DateTimeFormat {
  const key = `${kind}:${zone}`;
  let f = parts.get(key);
  if (!f) {
    f =
      kind === "day"
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
        : new Intl.DateTimeFormat("fi-FI", { timeZone: zone, hour: "numeric", minute: "2-digit" });
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
  return iso ? formatFiDate(localDay(iso)) : "–";
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
  return `${Number(d)}.${Number(m)}.`;
}

const WEEKDAY = ["su", "ma", "ti", "ke", "to", "pe", "la"];
/** "2026-10-12" gives "ma 12.10."; a day of another year than today's has the year too. */
export function dayHeading(iso: string, today: string): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${iso.slice(0, 4) === today.slice(0, 4) ? dayMonth(iso) : date(iso)}`;
}

/** "2026-10-23T22:30:00Z" → "24.10.2026 klo 1.30": the day and the time of a timestamp, in the instance's time zone. */
export function dateTime(iso: string | null | undefined): string {
  return iso ? `${date(iso)} klo ${clockTime(iso)}` : "–";
}

/** "12.10. klo 15.30": a timestamp without the year. */
export function dayTime(iso: string): string {
  return `${dayMonth(localDay(iso))} klo ${clockTime(iso)}`;
}

/** "2026-10" → "loka" (with year when asked) */
export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split("-");
  const name = MONTH_STEMS[Number(m) - 1] ?? month;
  return withYear ? `${name} ${y}` : name;
}

export function monthLong(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

export const CADENCE_LABEL: Record<string, string> = {
  weekly: "viikoittain",
  biweekly: "joka toinen viikko",
  semimonthly: "kahdesti kuussa",
  monthly: "kuukausittain",
  bimonthly: "joka toinen kuukausi",
  quarterly: "neljännesvuosittain",
  semiannual: "puolivuosittain",
  yearly: "vuosittain",
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  checking: "Käyttötili",
  savings: "Säästötili",
  credit_card: "Luottokortti",
  loan: "Laina",
  other: "Muu",
};

/** An IBAN in groups of four, "FI21 1234 5600 0007 85". A missing one gives "". */
export function formatIban(iban: string | null | undefined): string {
  return (iban ?? "").replace(/\s+/g, "").toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
}

/** What tells accounts of one holder apart: the IBAN in groups of four, else a card's masked number, else "". */
export function accountNumber(a: { iban: string | null; cardMask?: string | null }): string {
  return a.iban ? formatIban(a.iban) : (a.cardMask ?? "");
}
