import { formatEur, formatFiDate, MONTH_STEMS, monthName } from "@banking/core";

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

/** `n / d` rounded down, for integers: no float quotient decides it. */
const quotient = (n: number, d: number): number => (n - (n % d)) / d;

/**
 * Shares of one whole that are printed side by side, as whole units of the last printed digit (`decimals` digits after
 * the comma): each is its true value rounded down or up, and the ones with the largest lost fractions go up until the
 * units add up to `target`. The target is the whole's own printed share, by default the nearest unit to the parts' true
 * sum (100 when they are the whole). A tie goes to the earlier row, so the same data prints the same way. A part of
 * exactly 0 stays 0; a part that is null or below zero comes back null and stands outside the rounding. The sums are
 * integers (cents against cents), so no float decides a digit.
 */
export function roundedShares(parts: readonly (number | null)[], whole: number, decimals = 0, target?: number): (number | null)[] {
  const scale = 100 * 10 ** decimals;
  const valid = parts.map((p) => (p != null && p >= 0 ? p : null));
  if (!(whole > 0)) return valid.map((p) => (p === null ? null : 0));
  const down = valid.map((p) => (p === null ? null : { units: quotient(p * scale, whole), lost: (p * scale) % whole }));
  const sum = valid.reduce<number>((s, p) => s + (p ?? 0), 0);
  const nearest = quotient(2 * sum * scale + whole, 2 * whole);
  const floors = down.reduce((s, d) => s + (d?.units ?? 0), 0);
  const order = down
    .flatMap((d, i) => (d && d.lost > 0 ? [{ i, lost: d.lost }] : []))
    .sort((a, b) => b.lost - a.lost || a.i - b.i);
  const up = new Set(order.slice(0, Math.max(0, (target ?? nearest) - floors)).map((o) => o.i));
  return down.map((d, i) => (d ? d.units + (up.has(i) ? 1 : 0) : null));
}

/** 48 → "48 %"; with decimals the units are of the last digit: 476 with one decimal → "47,6 %". */
export function shareText(units: number, decimals = 0): string {
  if (decimals <= 0) return `${units} %`;
  const unit = 10 ** decimals;
  return `${Math.floor(units / unit)},${String(units % unit).padStart(decimals, "0")} %`;
}

/** "2026-10-09" → "9.10.2026" */
export function date(iso: string | null | undefined): string {
  return iso ? formatFiDate(iso) : "–";
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

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("fi-FI", { dateStyle: "short", timeStyle: "short" });
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
