/**
 * The search parameters of the routes (router.tsx): how an address is read and written, and the typed fields each page
 * knows. The addresses keep the plain form they always had (`?period=12m&view=merchants`, every value a string), so
 * old links and the pages that read `URLSearchParams` go on working. A field a page names is checked; any other
 * parameter that is a plain value passes through untouched (a link from a bank, a module's own parameters).
 */
import { QUESTIONS } from "@banking/core";
import { DRILL_PARAM, readTableState, SORT_PARAM } from "./table-state.ts";

/** A parameter's reader: the value if it is one the field takes, else undefined and the parameter is dropped. */
type Field<T extends string = string> = (value: string) => T | undefined;

const text: Field = (v) => (v === "" ? undefined : v);
const flag: Field<"1"> = (v) => (v === "1" ? "1" : undefined);
const oneOf =
  <const L extends readonly string[]>(list: L): Field<L[number]> =>
  (v) =>
    list.includes(v) ? (v as L[number]) : undefined;
/** The entries of a table parameter that read as entries; the rest is dropped. */
const perTable: Field = (v) => {
  const kept = [...readTableState(v)].map(([t, s]) => `${encodeURIComponent(t)}:${encodeURIComponent(s)}`).join(",");
  return kept || undefined;
};

/** On every page: the period, a comparison (`compare`, a period or a month to set beside), and the state of the tables. */
const COMMON = {
  period: text,
  compare: text,
  [SORT_PARAM]: perTable,
  [DRILL_PARAM]: perTable,
} satisfies Record<string, Field>;

const TRANSACTION_VIEWS = ["merchants"] as const;
const TRANSACTION_KINDS = ["income"] as const;

/** The filters of Tapahtumat and the merchant list under it. */
const TRANSACTIONS = {
  view: oneOf(TRANSACTION_VIEWS),
  q: text,
  category: text,
  kind: oneOf(TRANSACTION_KINDS),
  accountId: text,
  merchant: text,
  from: text,
  to: text,
  habit: flag,
} satisfies Record<string, Field>;

/** Raportit: the question page (`q`); the comparison and the period are on every page. */
const REPORTS = { q: oneOf(QUESTIONS) } satisfies Record<string, Field>;

const SETTINGS = { add: flag, connected: text, error: text } satisfies Record<string, Field>;

/** The fields of each page, besides the ones on every page. */
const PAGE_FIELDS = {
  overview: {},
  bills: {},
  transactions: TRANSACTIONS,
  reports: REPORTS,
  /** `item`: the id of the item a link opened, asked first. */
  review: { item: text },
  more: {},
  settings: SETTINGS,
  /** A module's own page: its parameters are its own. */
  extension: {},
} as const satisfies Record<string, Record<string, Field>>;

export type PageId = keyof typeof PAGE_FIELDS;

type Fields = Record<string, Field>;
type Typed<F> = { [K in keyof F]?: F[K] extends (...args: never[]) => infer T ? NonNullable<T> : never };
/** What a page's `validateSearch` returns: its typed fields, and any other plain parameter as a string. */
export type SearchOf<P extends PageId> = Typed<typeof COMMON & (typeof PAGE_FIELDS)[P]> & { [other: string]: string | undefined };

/** The raw search of an address as the router hands it over: `?a=b&c=d` to `{ a: "b", c: "d" }`, every value a string. */
export function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

/** The other way: values that are empty or not plain are left out. The order of the keys is kept. */
export function stringifySearch(search: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (String(value) !== "") q.set(key, String(value));
    }
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** The `validateSearch` of a page. */
export function searchOf<P extends PageId>(page: P): (raw: Record<string, unknown>) => SearchOf<P> {
  const fields: Fields = { ...COMMON, ...PAGE_FIELDS[page] };
  return (raw) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
      // own keys only: `__proto__` or `constructor` in an address is a plain parameter, not a field
      const read = Object.hasOwn(fields, key) ? fields[key] : undefined;
      const checked = read ? read(String(value)) : text(String(value));
      if (checked !== undefined) out[key] = checked;
    }
    return out as SearchOf<P>;
  };
}

/** A route's search as the `URLSearchParams` the pages are written against. */
export function paramsOf(search: Readonly<Record<string, unknown>>): URLSearchParams {
  return new URLSearchParams(stringifySearch({ ...search }).slice(1));
}
