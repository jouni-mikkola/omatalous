/**
 * The rows a table shows: TanStack Table's sorting, filtering and grouping run here and nowhere else. The table keeps its
 * own markup; this module takes the page's rows and columns and the reader's view (search, chip, grouping, sort) and
 * gives back the rows in the order to draw them, the groups when the rows are grouped, and the count of every chip.
 * It adds up nothing: a count is a number of rows.
 *
 * The pages build their `columns` and `rows` anew on every render, which TanStack's row models must not see (a new array
 * each time rebuilds them and some of its hooks then loop). So the table gets definitions that stay the same while the
 * columns keep their keys and flags, and reads the page's current closures through a ref.
 */
import { LOCALE } from "@banking/core";
import {
  columnFilteringFeature,
  columnGroupingFeature,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  type ColumnDef,
  type FilterFn,
  globalFilteringFeature,
  rowSortingFeature,
  type SortFn,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo, useRef } from "react";
import { type ChipDef, type Column, chipsOf, searchFns, valueOf } from "./columns.ts";
import type { TableView } from "./view.ts";

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  columnGroupingFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  groupedRowModel: createGroupedRowModel(),
  sortedRowModel: createSortedRowModel(),
});

/** A row as TanStack holds it: the table's rows are of any type, TanStack's must be objects. */
type Item<R> = { row: R };

/** The key the chip filter and the grouping use for the one column that holds chips; chips of any column share one filter. */
const CHIP_FILTER = "rt-chip";

const collator = new Intl.Collator(LOCALE);

/** Numbers by size, text the Finnish way (å, ä, ö after z). TanStack reverses it for a descending sort and keeps the order of equal rows. */
const compare: SortFn<typeof features, Item<unknown>> = (a, b, id) => {
  const x = a.getValue<number | string>(id);
  const y = b.getValue<number | string>(id);
  return typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
};

/** The words of a search: the same letters in any case, each word anywhere in the row's searched texts. */
export function searchWords(query: string): string[] {
  return query.toLocaleLowerCase(LOCALE).split(/\s+/).filter(Boolean);
}

/** Whether a row's searched texts hold every word of the query; an empty query holds everything. */
export function matchesQuery(texts: readonly string[], words: readonly string[]): boolean {
  if (!words.length) return true;
  const hay = texts.join(" ").toLocaleLowerCase(LOCALE);
  return words.every((w) => hay.includes(w));
}

export type ChipCount = { key: string; label: string; count: number };

/** One group of a grouped table: the value that names it and its rows in the sort's order. */
export type Section<R> = { key: string; title: string; rows: R[] };

export type Shown<R> = {
  /** The rows to draw, filtered and in the sort's order (flat). */
  rows: R[];
  /** Set when the table is grouped by the reader: the same rows in groups. */
  sections: Section<R>[] | null;
  /** Rank of each shown row's key in `rows`, for the page's own groups that order their rows by it. */
  rank: ReadonlyMap<string, number>;
  /** The number of rows before the search and the chip. */
  all: number;
  /** The number of rows the table was given. */
  total: number;
  /** The rows each chip would show with the search as it is. */
  chips: ChipCount[];
};

/** The definitions of the columns for TanStack, rebuilt only when a column's key, kind or flags change. */
function definitions<R>(live: { current: Column<R>[] }, columns: readonly Column<R>[]): ColumnDef<typeof features, Item<R>>[] {
  const find = (key: string) => live.current.find((c) => c.key === key)!;
  const defs: ColumnDef<typeof features, Item<R>>[] = columns.map((c) => ({
    id: c.key,
    // a null sorts last in either direction: TanStack takes undefined for "no value"
    accessorFn: ({ row }: Item<R>) => valueOf(find(c.key))?.(row) ?? undefined,
    sortFn: compare as SortFn<typeof features, Item<R>>,
    sortUndefined: "last",
    enableSorting: valueOf(c) !== undefined,
    getGroupingValue: ({ row }: Item<R>) => find(c.key).group?.(row),
    enableGrouping: c.group !== undefined,
    enableColumnFilter: false,
  }));
  const hasChips = columns.some((c) => c.chips?.length);
  if (hasChips) {
    const chip: FilterFn<typeof features, Item<R>> = (row, _id, key: string) => chipsOf(live.current).find((x) => x.chip.key === key)?.chip.test(row.original.row) ?? true;
    defs.push({ id: CHIP_FILTER, accessorFn: () => "", enableSorting: false, enableGrouping: false, filterFn: chip, enableGlobalFilter: false });
  }
  return defs;
}

/** An array that keeps its identity while its items are the same ones: a page's `flatMap` gives a new array of the same rows each render. */
function useStable<T>(list: readonly T[]): readonly T[] {
  const last = useRef(list);
  if (last.current !== list && (last.current.length !== list.length || list.some((x, i) => x !== last.current[i]))) last.current = list;
  return last.current;
}

export function useShown<R>(rowsIn: readonly R[], columns: Column<R>[], rowKey: (row: R) => string, view: TableView, markup = true): Shown<R> {
  const live = useRef(columns);
  live.current = columns;
  const keyOf = useRef(rowKey);
  keyOf.current = rowKey;
  const rows = useStable(rowsIn);
  const items = useMemo(() => rows.map((row): Item<R> => ({ row })), [rows]);
  const signature = String(markup) + columns.map((c) => [c.key, valueOf(c) ? "s" : "", c.group ? "g" : "", (c.chips ?? []).map((x) => x.key).join(",")].join("|")).join("/");
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the definitions read the columns through `live`; the signature is what changes them
  const defs = useMemo(() => definitions(live, columns), [signature]);
  const searchers = searchFns(columns);
  const words = searchWords(view.query);
  const first = columns[0]?.key;
  const table = useTable(
    {
      features,
      columns: defs,
      data: items,
      getRowId: (item) => keyOf.current(item.row),
      state: {
        sorting: view.sort ? [{ id: view.sort.key, desc: view.sort.dir === "descending" }] : [],
        columnFilters: view.chip ? [{ id: CHIP_FILTER, value: view.chip }] : [],
        globalFilter: view.query,
        grouping: view.group ? [view.group] : [],
      },
      onSortingChange: () => {},
      onColumnFiltersChange: () => {},
      onGlobalFilterChange: () => {},
      onGroupingChange: () => {},
      enableSortingRemoval: true,
      // one eligible column makes the filter run once per row; the function looks in every searched text itself
      getColumnCanGlobalFilter: (column) => column.id === first,
      globalFilterFn: (row) => matchesQuery(searchFns(live.current).map((f) => f(row.original.row)), searchWords(view.query)),
      groupedColumnMode: false,
    },
    () => ({}),
  );
  const model = table.getRowModel().rows;
  const grouped = view.group !== null;
  const sections: Section<R>[] | null = grouped ? model.map((g) => ({ key: g.id, title: String(g.groupingValue ?? ""), rows: g.subRows.map((r) => r.original.row) })) : null;
  const flat = grouped ? model.flatMap((g) => g.subRows.map((r) => r.original.row)) : model.map((r) => r.original.row);
  const rank = new Map(flat.map((r, i) => [keyOf.current(r), i]));
  const chips = chipsOf(columns);
  const searched = words.length ? rows.filter((r) => matchesQuery(searchers.map((f) => f(r)), words)) : rows;
  return {
    rows: flat,
    sections,
    rank,
    all: searched.length,
    total: rows.length,
    chips: chips.map(({ chip }: { chip: ChipDef<R> }) => ({ key: chip.key, label: chip.label, count: searched.filter(chip.test).length })),
  };
}
