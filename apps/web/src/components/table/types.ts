/** Decision: none of its own. The props of `Table`, apart from it so that the component's file stays about the component. */
import type { ComponentProps, ReactNode } from "react";
import type { Column } from "./columns.ts";
import type { TableView } from "./view.ts";

/** Attributes and handlers of a `<tr>` (hover, focus, a data attribute); `className` is the table's own. */
type RowProps = Omit<ComponentProps<"tr">, "className" | "children"> &
  Record<`data-${string}`, string | undefined>;

/** A cell of the upper head row of a two-row head. */
export type HeadCell = {
  key: string;
  label: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  className?: string;
  /** The head of a column with no visible name (a link, a button): its label is read, not drawn. */
  hidden?: boolean;
};

/** A body of its own under a head row, with the group's figure above its rows. */
export type RowGroup<R> = {
  key: string;
  /** The group's head row; a group with none runs on from the one above it. */
  title?: ReactNode;
  /** The group's figure, in the last column of its head row. It is the server's or the page's, never added here. */
  figure?: ReactNode;
  /** How many of the last columns the figure takes (a pair of sums needs two). */
  figureSpan?: number;
  /** The group's figures by column, when its head row has one for more than the last column; the first column holds `title`. */
  cells?: Record<string, ReactNode>;
  /** What the sort orders the groups by, per column, when the groups are ranked by the same figures as their rows. */
  values?: Record<string, number | string | null>;
  rows: readonly R[];
  adds?: boolean;
  /** What the CSV's group column holds when `title` is not text (a node with a count in it). */
  csv?: string;
};

type Total = { label: string; cells: Record<string, ReactNode> };

export type TableProps<R> = {
  caption: string;
  captionVisible?: boolean;
  /** A class of a visible caption. */
  captionClass?: string;
  rows: readonly R[];
  rowKey: (row: R) => string;
  columns: Column<R>[];
  /** The server's figures for the foot rows. */
  total?: Total | Total[];
  /** The detail under a row; the chevron stands in its first cell. A row whose detail is null has neither. */
  drill?: (row: R) => ReactNode;
  drillLabel?: (row: R) => string;
  /** Rows the page writes under a row: its own `<tr>`s, as wide as the shown columns (a form, a row that draws itself or nothing). */
  rowsAfter?: (row: R) => ReactNode;
  /** The detail under a row that is always open (no chevron). */
  subRow?: (row: R) => ReactNode;
  /** The row whose detail is open, when the page holds it (its own button toggles it); `drill` still makes the detail. */
  open?: string | null;
  onOpen?: (key: string | null) => void;
  /** False when the page has the button: no chevron in the first cell. */
  drillButton?: boolean;
  /** An upper head row; the row of the columns follows it, without the `covered` columns. */
  headTop?: { cells: HeadCell[]; covered?: string[] };
  /** The rows in bodies of their own, in this order (`rows` still holds them all, flat); the sort orders each group. */
  groups?: RowGroup<R>[];
  /** The columns that add up to the total: drawn as the sum bracket. */
  sums?: string[];
  /** A class of the `<table>`. */
  className?: string;
  /** A class of a row (a muted or marked row). */
  rowClassName?: (row: R) => string | undefined;
  /** More attributes of a row (a data attribute for an e2e or a title). */
  rowProps?: (row: R) => RowProps;
  /** Rows shown at first, then "Näytä lisää" (More.tsx): the sort orders every row, groups are never cut. */
  page?: number;
  /** The name of the button that opens a row's `series` columns on a narrow screen. */
  seriesLabel?: string;
  /** `false` leaves the toolbar out (a table inside a row's detail); `true` shows it on a short list. By default only a table with chips, grouping or a long list to search has it. */
  toolbar?: boolean;
  /** Offers "Lataa CSV" under the table also when it is short; a list of more than `LONG_LIST_ROWS` rows has it anyway. `false` leaves the link out (a table the household reads, not saves). */
  csv?: boolean;
  /** `false` leaves the search box out of a long list that no column names for the search (a list the household reads whole). */
  search?: boolean;
  /** The words of the search box; a table with a searched column has the box, named so. */
  searchLabel?: string;
  /** The page has already searched the rows for `view.query` (the server did): the box is shown and the table does not filter by it again. */
  rowsSearched?: boolean;
  /** The rows are one page of a longer list of this many (the server's count): "Kaikki" counts the list, and a chip, whose rows can be on another page, shows no count. */
  listTotal?: number;
  /** The page's own controls in the toolbar, after the chips (filters the server applies). */
  toolbarExtra?: ReactNode;
  /**
   * The reader's view (search, chip, grouping, sort), when the page keeps it (in the address, so a link returns to it).
   * Without it the table keeps the view in its own state and a reload starts again.
   */
  view?: TableView;
  onView?: (next: TableView) => void;
};
