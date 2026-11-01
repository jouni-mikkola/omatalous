import { LOCALE } from "@banking/core";
import { t } from "../../text.ts";
/**
 * The one sort of every table: the order a press gives, the rows in that order and the sentence a screen reader hears.
 * Pure, so the tests run it without a page. The web adds up nothing here; it only orders what the server sent.
 */
export type SortDir = "ascending" | "descending";
export type Sort<K extends string> = { key: K; dir: SortDir } | null;

/**
 * A press sorts a column largest first, a second press smallest first, a third gives back the order the server sent.
 * A column of names (`textKeys`) starts from A, as a reader looks for a name.
 */
export function nextSort<K extends string>(s: Sort<K>, key: K, textKeys: readonly K[] = []): Sort<K> {
  const first: SortDir = textKeys.includes(key) ? "ascending" : "descending";
  if (s?.key !== key) return { key, dir: first };
  return s.dir === first ? { key, dir: first === "ascending" ? "descending" : "ascending" } : null;
}

/**
 * Rows in the order of one column, stable (equal rows keep the server's order), an empty value last in either
 * direction. Text sorts the Finnish way (å, ä, ö after z).
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => number | string | null, dir: SortDir): T[] {
  const sign = dir === "ascending" ? 1 : -1;
  const collator = new Intl.Collator(LOCALE);
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      return c * sign || a.i - b.i;
    })
    .map((x) => x.row);
}

/** The rows in the order of `sort`, the server's order (the same array) without one. */
export function sortBy<R, K extends string>(rows: readonly R[], sort: Sort<K>, value: (row: R, key: K) => number | string | null): readonly R[] {
  return sort ? sortRows(rows, (r) => value(r, sort.key), sort.dir) : rows;
}

/** The order a column gives, in words: "Lokakuu, suurin ensin". A column of names goes by the alphabet, figures by size. */
export function sortPhrase(label: string, dir: SortDir, text: boolean): string {
  if (text) return `${label}, ${dir === "ascending" ? t("table.sort_az") : t("table.sort_za")}`;
  return `${label}, ${dir === "descending" ? t("table.sort_desc") : t("table.sort_asc")}`;
}

/** What the table's live region says after a press. */
export function sortMessage(label: string, dir: SortDir | null, text: boolean): string {
  return dir ? t("table.sorted", { phrase: sortPhrase(label, dir, text) }) : t("table.original");
}
