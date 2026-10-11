const eur = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num0 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });

export const MONTHS_SHORT = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];
export const MONTHS_LONG = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];

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

/** "1 tapahtuma", "3 tapahtumaa" */
export function plural(n: number, one: string, many: string): string {
  return `${num0.format(n)} ${n === 1 ? one : many}`;
}

export function count(n: number): string {
  return num1.format(n);
}

export function percent(x: number): string {
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
