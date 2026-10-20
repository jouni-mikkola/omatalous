/**
 * Decision: which row to open, which to take up first, and what they come to (the server's total).
 *
 * The column-driven table on top of the frame (RichTable.tsx): a caption that always names it, scoped heads (one or two
 * rows), the sort of sort.ts, density and column choice, the server's total, a phone layout, a detail row, sub-rows and
 * grouped bodies. A page with bespoke rows (Tapahtumat, Kategoriat) writes its own `<tr>` inside the frame.
 * It adds nothing up: a total is the node the page passes, and `cents` is only formatted.
 */
import {
  type ComponentProps,
  type CSSProperties,
  Fragment,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { money } from "../../format.ts";
import { BarCell, SortHead } from "./Cells.tsx";
import {
  DensitySwitch,
  DrillButton,
  RichTable,
  useColumns,
  useDensity,
} from "./RichTable.tsx";
import { sortBy, sortMessage, useSort } from "./sort.ts";

/** What a column holds: it sets the alignment, the tabular figures and the first direction of its sort. */
export type ColumnKind = "text" | "money" | "count" | "date" | "share";

export type Column<R> = {
  key: string;
  /** A node when the head carries more than text (a note under the name); then `text` names it for the sort and the cards. */
  label: ReactNode;
  text?: string;
  kind: ColumnKind;
  /** The cell. A money column with `cents` may leave it out. */
  cell?: (row: R) => ReactNode;
  /** The amount of a money column in cents; it is printed to its `precision`, so one column never mixes 29,90 € and 30 €. */
  cents?: (row: R) => number | null;
  precision?: "cents" | "euros";
  /** A column with a value to sort by is sortable (a money column with `cents` sorts by it). */
  sortValue?: (row: R) => number | string | null;
  /** This cell is the row's `th scope="row"`, and the title of its card on a phone. */
  rowHead?: boolean;
  /** The figure on the card's first line on a phone. */
  main?: boolean;
  /** The column the household may switch off (Sarakkeet). */
  optional?: boolean;
  /** A class of the cell by its row (the tone of a figure that got worse). */
  className?: (row: R) => string | undefined;
  /** The `title` of the cell by its row (the full name of a cut one). */
  title?: (row: R) => string | undefined;
  /** An inline style of the cell by its row (a custom property the stylesheet reads). */
  style?: (row: R) => CSSProperties | undefined;
  /** The head is an empty `td` (a column of row heads has no name; `label` still names it for the cards). */
  emptyHead?: boolean;
  /** A class of the column's head cell (the cells have `className`). */
  headClass?: string;
  /** Left out on a phone. */
  phone?: "hide";
  /** A bar cell: the row's own figure against the column's scale, drawn beside `cell` (or alone). It computes no money. */
  bar?: {
    value: (row: R) => number;
    max: number;
    color?: (row: R) => string | undefined;
  };
};

/** Attributes and handlers of a `<tr>` (hover, focus, a data attribute); `className` is the table's own. */
export type RowProps = Omit<ComponentProps<"tr">, "className" | "children"> &
  Record<`data-${string}`, string | undefined>;

/** A cell of the upper head row of a two-row head. */
export type HeadCell = {
  key: string;
  label: ReactNode;
  colSpan?: number;
  rowSpan?: number;
  className?: string;
  /** An empty `td` (the column of a link has no head). */
  empty?: boolean;
};

/** A body of its own under a head row, with the group's figure above its rows. */
export type RowGroup<R> = {
  key: string;
  title: ReactNode;
  /** The group's figure, in the last column of its head row. It is the server's or the page's, never added here. */
  figure?: ReactNode;
  rows: R[];
  adds?: boolean;
};

export type Total = { label: string; cells: Record<string, ReactNode> };

export type DataTableProps<R> = {
  /** The storage key of the density and the column choice. */
  id: string;
  caption: string;
  captionVisible?: boolean;
  /** A class of a visible caption. */
  captionClass?: string;
  rows: R[];
  rowKey: (row: R) => string;
  columns: Column<R>[];
  /** The server's figures for the foot rows. */
  total?: Total | Total[];
  /** Cards for lists, a scroll with the first column kept for matrices. */
  phone?: "cards" | "scroll" | "none";
  /** A class for each column of a `<colgroup>` (an empty string is a plain `<col>`). */
  colgroup?: string[];
  /** Shown as the one row of a table with no rows. */
  empty?: string;
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
  /** The rows in bodies of their own, in this order (`rows` still holds them all, flat). */
  groups?: RowGroup<R>[];
  /** The columns that add up to the total: drawn as the sum bracket. */
  sums?: string[];
  /** More in the tool bar (the CSV link of a report). */
  tools?: ReactNode;
  /** A class of the `<table>`. */
  className?: string;
  /** A class of a row (a muted or marked row). */
  rowClassName?: (row: R) => string | undefined;
  /** More attributes of a row (a data attribute for an e2e or a title). */
  rowProps?: (row: R) => RowProps;
  /** No tool bar however long (a table inside a panel). */
  plain?: boolean;
  /** No head row: a key/value list, the first column the row head. The caption still names it. */
  headless?: boolean;
};

const spanOf = (h: HeadCell) => ({
  key: h.key,
  colSpan: h.colSpan,
  rowSpan: h.rowSpan,
  className: h.className,
});

const FIGURE: ColumnKind[] = ["money", "count", "share"];
/** A table longer than this offers the density. */
const LONG = 8;

const textOf = <R,>(c: Column<R>): string =>
  c.text ?? (typeof c.label === "string" ? c.label : c.key);

const cellOf = <R,>(c: Column<R>, row: R): ReactNode => {
  if (c.bar) {
    const bar = (
      <BarCell
        value={c.bar.value(row)}
        max={c.bar.max}
        color={c.bar.color?.(row)}
      />
    );
    return c.cell ? (
      <>
        {c.cell(row)}
        {bar}
      </>
    ) : (
      bar
    );
  }
  if (c.cell) return c.cell(row);
  const v = c.cents?.(row) ?? null;
  return v === null ? "–" : money(v, c.precision === "cents");
};

const valueOf = <R,>(
  c: Column<R>,
): ((row: R) => number | string | null) | undefined =>
  c.sortValue ?? (c.cents ? (r) => c.cents!(r) : undefined);

export function DataTable<R>({
  id,
  caption,
  captionVisible,
  captionClass,
  rows,
  rowKey,
  columns,
  total,
  phone = "cards",
  colgroup,
  empty,
  drill,
  drillLabel,
  subRow,
  rowsAfter,
  open: openProp,
  onOpen,
  drillButton = true,
  headTop,
  groups,
  sums,
  tools,
  className,
  rowClassName,
  rowProps,
  headless,
  plain,
}: DataTableProps<R>) {
  const [density, setDensity] = useDensity(id);
  const [hidden, toggleColumn] = useColumns(id);
  const [openOwn, setOpenOwn] = useState<string | null>(null);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openOwn;
  const setOpen = (k: string | null) =>
    controlled ? onOpen?.(k) : setOpenOwn(k);
  const textKeys = columns.filter((c) => c.kind === "text").map((c) => c.key);
  const [sort, onSort, touched] = useSort<string>(textKeys);
  const menu = useRef<HTMLDetailsElement>(null);

  const shown = columns.filter((c) => !(c.optional && hidden.has(c.key)));
  const optional = columns.filter((c) => c.optional);
  const sorted = sortBy(rows, sort, (r, k) => {
    const c = columns.find((x) => x.key === k);
    return c ? (valueOf(c)?.(r) ?? null) : null;
  });
  const sortedColumn = sort
    ? columns.find((c) => c.key === sort.key)
    : undefined;
  const live = touched
    ? sortMessage(
        sortedColumn ? textOf(sortedColumn) : "",
        sort?.dir ?? null,
        sortedColumn?.kind === "text",
      )
    : "";
  const summed = new Set(sums ?? []);
  const totals =
    total === undefined ? [] : Array.isArray(total) ? total : [total];
  const cls = (c: Column<R>, extra?: string) =>
    [
      FIGURE.includes(c.kind) ? "num" : "",
      c.phone === "hide" ? "hide-phone" : "",
      extra ?? "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const showBar = !plain && (rows.length > LONG || optional.length > 0 || tools);
  const last = sorted.length - 1;

  const renderRow = (row: R, at: number, last: number, bracket: boolean) => {
    const key = rowKey(row);
    const detail = drill?.(row) ?? null;
    const sub = subRow?.(row) ?? null;
    const isOpen = detail !== null && open === key;
    return (
      <Fragment key={key}>
        <tr
          {...rowProps?.(row)}
          className={
            [
              ...(bracket
                ? [at === 0 ? "part-first" : "", at === last ? "part-last" : ""]
                : []),
              rowClassName?.(row) ?? "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {shown.map((c, i) => {
            const lead =
              i === 0 && drill && drillButton ? (
                <DrillButton
                  open={isOpen}
                  onToggle={() => setOpen(isOpen ? null : key)}
                  label={drillLabel?.(row) ?? "Avaa rivi"}
                />
              ) : null;
            if (c.rowHead) {
              return (
                <th
                  key={c.key}
                  scope="row"
                  className={cls(
                    c,
                    ["rt-rowhead", c.className?.(row) ?? ""]
                      .filter(Boolean)
                      .join(" "),
                  )}
                  title={c.title?.(row)}
                  style={c.style?.(row)}
                >
                  {lead}
                  {cellOf(c, row)}
                </th>
              );
            }
            return (
              <td
                key={c.key}
                className={cls(
                  c,
                  [summed.has(c.key) ? "sum" : "", c.className?.(row) ?? ""]
                    .filter(Boolean)
                    .join(" "),
                )}
                title={c.title?.(row)}
                style={c.style?.(row)}
                data-label={c.main ? undefined : textOf(c)}
                data-rt={c.main ? "main" : undefined}
              >
                {lead}
                {cellOf(c, row)}
              </td>
            );
          })}
        </tr>
        {isOpen && (
          <tr className="rt-detail">
            <td colSpan={shown.length}>{detail}</td>
          </tr>
        )}
        {rowsAfter?.(row)}
        {sub !== null && (
          <tr className="rt-subrow">
            <td colSpan={shown.length}>{sub}</td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <>
      {showBar && (
        <div className="rt-tools">
          {tools}
          {optional.length > 0 && (
            <details
              className="rt-columns"
              ref={menu}
              onKeyDown={(e) => {
                if (e.key !== "Escape" || !menu.current?.open) return;
                menu.current.open = false;
                menu.current.querySelector("summary")?.focus();
              }}
            >
              <summary>Sarakkeet</summary>
              <div className="rt-columns-list">
                {optional.map((c) => (
                  <label key={c.key}>
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() => toggleColumn(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </details>
          )}
          {rows.length > LONG && (
            <DensitySwitch density={density} onChange={setDensity} />
          )}
        </div>
      )}
      <RichTable
        density={density}
        cards={phone === "cards"}
        scroll={phone === "scroll"}
        live={live}
        className={["ruled", className ?? ""].filter(Boolean).join(" ")}
      >
        <caption className={captionVisible ? captionClass : "sr-only"}>
          {caption}
        </caption>
        {colgroup && (
          <colgroup>
            {colgroup.map((k, i) => (
              <col key={i} className={k || undefined} />
            ))}
          </colgroup>
        )}
        {!headless && (
          <thead>
            {headTop && (
              <tr>
                {headTop.cells.map((h) =>
                  h.empty ? (
                    <td {...spanOf(h)} />
                  ) : (
                    <th
                      {...spanOf(h)}
                      scope={h.colSpan && h.colSpan > 1 ? "colgroup" : "col"}
                    >
                      {h.label}
                    </th>
                  ),
                )}
              </tr>
            )}
            <tr>
              {shown
                .filter((c) => !headTop?.covered?.includes(c.key))
                .map((c) => {
                  if (c.emptyHead)
                  return <td key={c.key} className={cls(c, c.headClass)} />;
                const value = valueOf(c);
                  if (!value) {
                    return (
                      <th key={c.key} scope="col" className={cls(c, c.headClass)}>
                        {c.label}
                      </th>
                    );
                  }
                  const dir = sort?.key === c.key ? sort.dir : null;
                  return (
                    <SortHead
                      key={c.key}
                      label={c.label}
                      dir={dir}
                      numeric={FIGURE.includes(c.kind)}
                      className={cls(c, c.headClass)}
                      onSort={() => onSort(c.key)}
                    />
                  );
                })}
            </tr>
          </thead>
        )}
        {groups ? (
          groups.map((g) => (
            <tbody key={g.key} className={g.adds ? "adds-up" : undefined}>
              <tr className="group-head">
                <th
                  colSpan={shown.length - (g.figure === undefined ? 0 : 1)}
                  scope="rowgroup"
                >
                  {g.title}
                </th>
                {g.figure !== undefined && (
                  <td className={cls(shown[shown.length - 1]!)}>{g.figure}</td>
                )}
              </tr>
              {g.rows.map((row, at) =>
                renderRow(row, at, g.rows.length - 1, g.adds === true),
              )}
            </tbody>
          ))
        ) : (
          <tbody className={summed.size ? "adds-up" : undefined}>
            {sorted.map((row, at) => renderRow(row, at, last, summed.size > 0))}
            {empty && sorted.length === 0 && (
              <tr>
                <td colSpan={shown.length}>{empty}</td>
              </tr>
            )}
          </tbody>
        )}
        {totals.length > 0 && (
          <tfoot>
            {totals.map((t) => (
              <tr key={t.label} className="rt-total">
                {shown.map((c, i) =>
                  i === 0 ? (
                    <th key={c.key} scope="row">
                      {t.label}
                    </th>
                  ) : (
                    <td
                      key={c.key}
                      className={cls(
                        c,
                        summed.has(c.key) ? "sum-pad" : undefined,
                      )}
                      data-label={c.main ? undefined : textOf(c)}
                      data-rt={c.main ? "main" : undefined}
                    >
                      {t.cells[c.key] ?? null}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tfoot>
        )}
      </RichTable>
    </>
  );
}
