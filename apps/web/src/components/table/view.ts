/**
 * The view of a table the reader chose: the search, the chip, the grouping and the sort. A table keeps it in its own
 * state until a page hands it over (`view` and `onView` of Table), for instance as the search parameters of the
 * address. The two functions here are that handover: the view becomes parameters and parameters become a view.
 * Pure, so the tests run them without a page. A parameter name has the table's `prefix` in front, so two tables of a
 * page keep apart (`menot.q`, `menot.sort`).
 */
import { nextSort, type Sort } from "./sort.ts";

export type TableView = {
  /** The words in the search box. */
  query: string;
  /** The key of the chosen chip; null is "Kaikki". */
  chip: string | null;
  /** The key of the column the rows are grouped by; null is no grouping. */
  group: string | null;
  sort: Sort<string>;
};

export const EMPTY_VIEW: TableView = { query: "", chip: null, group: null, sort: null };

const NAMES = { query: "q", chip: "chip", group: "group", sort: "sort" } as const;

/** The parameters of a view: only what differs from the empty view, `sort` as `key` or `key:asc` / `key:desc`. */
export function viewToParams(view: TableView, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  const name = (n: keyof typeof NAMES) => (prefix ? `${prefix}.${NAMES[n]}` : NAMES[n]);
  if (view.query) out[name("query")] = view.query;
  if (view.chip) out[name("chip")] = view.chip;
  if (view.group) out[name("group")] = view.group;
  if (view.sort) out[name("sort")] = `${view.sort.key}:${view.sort.dir === "ascending" ? "asc" : "desc"}`;
  return out;
}

/**
 * The view the parameters name. A key the table does not have (a link that outlived a column, a hand-written address)
 * is dropped: `columns`, `chips` and `groups` list the keys that exist, so a view never points at nothing.
 */
export function viewFromParams(
  params: Readonly<Record<string, string | undefined>>,
  known: { sort: readonly string[]; chips: readonly string[]; groups: readonly string[] },
  prefix = "",
): TableView {
  const get = (n: keyof typeof NAMES) => params[prefix ? `${prefix}.${NAMES[n]}` : NAMES[n]];
  const [key, dir] = (get("sort") ?? "").split(":");
  const chip = get("chip");
  const group = get("group");
  return {
    query: (get("query") ?? "").slice(0, 100),
    chip: chip && known.chips.includes(chip) ? chip : null,
    group: group && known.groups.includes(group) ? group : null,
    sort: key && known.sort.includes(key) ? { key, dir: dir === "asc" ? "ascending" : "descending" } : null,
  };
}

/** A press on a head: the next step of that column's cycle, in the view. */
export const pressSort = (view: TableView, key: string, textKeys: readonly string[]): TableView => ({ ...view, sort: nextSort(view.sort, key, textKeys) });

/**
 * The length from which a list is worth searching and saving as a file. The one place for it. Ten rows fit a desktop screen
 * and nearly a phone's, so the eye finds a row faster than a search box does; above ten it starts to lose. A short table
 * (the security log, the members, the accounts) has no search box and no CSV link: both only add controls to look past.
 */
export const LONG_LIST_ROWS = 10;
