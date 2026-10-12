const eur = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num0 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });

export const MONTHS_SHORT = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];
const MONTHS_LONG = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];

/** 123456 → "1 234,56 €" */
export function money(cents: number, decimals = true): string {
  return (decimals ? eur : eur0).format(cents / 100);
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

export function count(n: number): string {
  return num1.format(n);
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

/** "2026-10-09" → "9.10.2026" */
export function date(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
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
  const name = MONTHS_SHORT[Number(m) - 1] ?? month;
  return withYear ? `${name} ${y}` : name;
}

/** ["2026-03", …, "2026-08"] → "maalis–elokuu 2026": the months a figure is the median of; across a year change both years show. */
export function monthSpan(months: readonly string[]): string {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return "";
  if (first === last) return monthLong(first);
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${monthLong(first)}–${monthLong(last)}`;
  return `${MONTHS_SHORT[Number(first.slice(5)) - 1]}–${monthLong(last)}`;
}

export function monthLong(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_LONG[Number(m) - 1]} ${y}`;
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
