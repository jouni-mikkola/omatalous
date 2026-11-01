/**
 * What the tables of a page keep in the address, so a view can be restored and shared: the order of a table (`sort`)
 * and the row it has open (`drill`). One parameter holds a value per table, `name:value` entries joined by commas;
 * a table is named by its caption. Pure, so the tests run it without a page.
 */
import { LOCALE } from "@banking/core";
import type { Sort } from "./components/table/sort.ts";

/** The parameters of the address that hold the order of the tables of a page and the row each has open. */
export const SORT_PARAM = "sort";
export const DRILL_PARAM = "drill";

const ENTRY = /^([^:,]+):([^:,]+)$/;

/** The values by table in a parameter. Anything that is not an entry is left out, so a hand-made address cannot break a page. */
export function readTableState(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (raw ?? "").split(",")) {
    const m = ENTRY.exec(entry);
    if (!m) continue;
    try {
      out.set(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
    } catch {
      // a broken escape: the entry is not ours
    }
  }
  return out;
}

/** The parameter with the value of one table replaced, or taken away when `value` is null. Undefined when nothing is left. */
export function writeTableState(raw: string | undefined, table: string, value: string | null): string | undefined {
  const state = readTableState(raw);
  if (value === null) state.delete(table);
  else state.set(table, value);
  const text = [...state].map(([t, v]) => `${encodeURIComponent(t)}:${encodeURIComponent(v)}`).join(",");
  return text || undefined;
}

/** A table is named by its caption, lower case, with anything but letters and digits turned to a dash. */
export function tableId(caption: string): string {
  return caption.toLocaleLowerCase(LOCALE).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** `desc.total` for a sort: the direction, then the column key. */
export function sortValue(sort: NonNullable<Sort<string>>): string {
  return `${sort.dir === "ascending" ? "asc" : "desc"}.${sort.key}`;
}

/** The sort a value names, or null for one that is not a sort. */
export function sortOf(value: string | undefined): Sort<string> {
  const m = /^(asc|desc)\.(.+)$/.exec(value ?? "");
  return m ? { key: m[2]!, dir: m[1] === "asc" ? "ascending" : "descending" } : null;
}
