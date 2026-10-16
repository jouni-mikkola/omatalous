const eur = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** 123456 → "1 234,56 €" (or "1 235 €" without decimals). Used in insight texts. */
export function formatEur(cents: number, decimals = true): string {
  return (decimals ? eur : eur0).format(cents / 100);
}

/** "2026-08-01" → "1.8.2026". A string split, so the runtime time zone cannot shift the day. */
export function formatFiDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
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

/** "2026-03" → "maaliskuussa". */
export function monthInessive(month: string): string {
  return MONTHS_INESSIVE[Number(month.slice(5, 7)) - 1] ?? month;
}

/** ["A", "B", "C"] → "A, B ja C". */
export function finnishList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ja ${items[items.length - 1]}`;
}
