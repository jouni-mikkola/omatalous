/**
 * Decision: which row to open, which to take up first, and what they come to (the server's total).
 *
 * The one table of the app: a caption that always names it, scoped heads (one or two rows), the sort of sort.ts for the
 * columns that ask for it, the server's total, a detail row, sub-rows, grouped bodies, a cut of long lists and month
 * columns that fold into a list under the row when the table is too narrow for them. Under 600 px of room each row is a
 * block: its name and main figure on the first line, the other cells as name and value pairs below it. The look is
 * table.css; a page writes cells and never a `<table>`. It adds nothing up: a total is the node the page passes, and
 * `cents` is only formatted.
 */
import { type ComponentProps, type CSSProperties, Fragment, type ReactNode, useState } from "react";
import { money } from "../../format.ts";
import { useMore } from "../More.tsx";
import { BarFigure, SortHead } from "./Cells.tsx";
import "../../styles/table.css";
import { sortBy, sortMessage, sortRows, useSort } from "./sort.ts";
import { SLIM, useBlock } from "./use-block.ts";

/** What a column holds: it sets the alignment, the tabular figures and the first direction of its sort. */
export type ColumnKind = "text" | "money" | "count" | "date" | "share";

export type Column<R> = {
  key: string;
  /** A node when the head carries more than text (a note under the name); then `text` names it for the sort and the pairs of a phone row. */
  label: ReactNode;
  text?: string;
  kind: ColumnKind;
  /** The cell. A money column with `cents` may leave it out. */
  cell?: (row: R) => ReactNode;
  /** The amount of a money column in cents; it is printed to its `precision`, so one column never mixes 29,90 € and 30 €. */
  cents?: (row: R) => number | null;
  precision?: "cents" | "euros";
  /**
   * The column sorts: `true` by its `cents`, or by this value. Only a column of a complete set the household reads by
   * size sorts; a series in time and a cut of the rows do not.
   */
  sort?: true | ((row: R) => number | string | null);
  /** One of the months (or other steps) of a row: a column while there is room, else the list the row's button opens. */
  series?: boolean;
  /** This cell is the row's `th scope="row"`, and the title of its block on a phone. */
  rowHead?: boolean;
  /** The figure on the block's first line on a phone. */
  main?: boolean;
  /** A class of the cell by its row (the tone of a figure that got worse). */
  className?: (row: R) => string | undefined;
  /** The `title` of the cell by its row (the full name of a cut one). */
  title?: (row: R) => string | undefined;
  /** An inline style of the cell by its row (a custom property the stylesheet reads). */
  style?: (row: R) => CSSProperties | undefined;
  /** The head's label is read, not drawn (a column of row heads or of buttons has no visible name). */
  headHidden?: boolean;
  /** A class of the column's head cell (the cells have `className`). */
  headClass?: string;
  /** Left out on a phone. */
  phone?: "hide";
  /** A bar: the row's own figure against the column's scale, drawn before `cell` (or alone). It computes no money. */
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
};

export type Total = { label: string; cells: Record<string, ReactNode> };

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
};

const spanOf = (h: HeadCell) => ({
  key: h.key,
  colSpan: h.colSpan,
  rowSpan: h.rowSpan,
  className: h.className,
});

const FIGURE: ColumnKind[] = ["money", "count", "share"];

const textOf = <R,>(c: Column<R>): string =>
  c.text ?? (typeof c.label === "string" ? c.label : c.key);

const cellOf = <R,>(c: Column<R>, row: R): ReactNode => {
  const plain = (): ReactNode => {
    if (c.cell) return c.cell(row);
    const v = c.cents?.(row) ?? null;
    return v === null ? "–" : money(v, c.precision === "cents");
  };
  if (!c.bar) return plain();
  // the bar stands before the figure it draws, on the column's scale, and is left out where there is no room for it
  return (
    <BarFigure value={c.bar.value(row)} max={c.bar.max} color={c.bar.color?.(row)}>
      {c.cell || c.cents ? plain() : null}
    </BarFigure>
  );
};

const valueOf = <R,>(
  c: Column<R>,
): ((row: R) => number | string | null) | undefined =>
  c.sort === true ? (c.cents ? (r) => c.cents!(r) : undefined) : c.sort;

export function Table<R>({
  caption,
  captionVisible,
  captionClass,
  rows,
  rowKey,
  columns,
  total,
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
  className,
  rowClassName,
  rowProps,
  page,
  seriesLabel = "Kuukaudet",
}: TableProps<R>) {
  const slim = columns.filter((c) => !c.series && c.phone !== "hide").length <= SLIM;
  const [wrap, block] = useBlock(slim);
  const [openOwn, setOpenOwn] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openOwn;
  const setOpen = (k: string | null) => (controlled ? onOpen?.(k) : setOpenOwn(k));
  const textKeys = columns.filter((c) => c.kind === "text").map((c) => c.key);
  const [sort, onSort, touched] = useSort<string>(textKeys);

  const hasSeries = columns.some((c) => c.series);
  const order = (list: readonly R[]) =>
    sortBy(list, sort, (r, k) => {
      const c = columns.find((x) => x.key === k);
      return c ? (valueOf(c)?.(r) ?? null) : null;
    });
  const sorted = order(rows);
  const orderGroups = (list: RowGroup<R>[]) =>
    sort && list.some((g) => g.values) ? sortRows(list, (g) => g.values?.[sort.key] ?? null, sort.dir) : list;
  const sortedColumn = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const live = touched ? sortMessage(sortedColumn ? textOf(sortedColumn) : "", sort?.dir ?? null, sortedColumn?.kind === "text") : "";
  const summed = new Set(sums ?? []);
  const totals = total === undefined ? [] : Array.isArray(total) ? total : [total];
  const cls = (c: Column<R>, extra?: string) =>
    [
      FIGURE.includes(c.kind) ? "num" : "",
      c.phone === "hide" ? "hide-phone" : "",
      c.series ? "rt-series" : "",
      extra ?? "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const { shown: visible, more } = useMore(sorted, groups ? Infinity : (page ?? Infinity));
  const last = visible.length - 1;

  /** The button of a row (or a total) that opens its `series` cells; only a block shows it. */
  const foldButton = (key: string) => (
    <button
      type="button"
      className="rt-fold"
      aria-expanded={folded.has(key)}
      onClick={() =>
        setFolded((f) => {
          const next = new Set(f);
          if (!next.delete(key)) next.add(key);
          return next;
        })
      }
    >
      {seriesLabel}
    </button>
  );

  const renderRow = (row: R, at: number, last: number, bracket: boolean) => {
    const key = rowKey(row);
    const detail = drill?.(row) ?? null;
    const sub = subRow?.(row) ?? null;
    const isOpen = detail !== null && open === key;
    const seriesOpen = folded.has(key);
    return (
      <Fragment key={key}>
        <tr
          {...rowProps?.(row)}
          data-series-open={hasSeries && seriesOpen ? "" : undefined}
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
          {columns.map((c, i) => {
            const lead =
              i === 0 && drill && drillButton ? (
                <DrillButton
                  open={isOpen}
                  onToggle={() => setOpen(isOpen ? null : key)}
                  label={drillLabel?.(row) ?? "Avaa rivi"}
                />
              ) : null;
            const fold = i === 0 && hasSeries ? foldButton(key) : null;
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
                  {lead ? (
                    <span className="rt-lead">
                      {lead}
                      <span className="rt-lead-body">
                        {cellOf(c, row)}
                        {fold}
                      </span>
                    </span>
                  ) : (
                    <>
                      {cellOf(c, row)}
                      {fold}
                    </>
                  )}
                </th>
              );
            }
            return (
              <td
                key={c.key}
                className={cls(
                  c,
                  [summed.has(c.key) ? (groups?.some((g) => g.cells) ? "sum-pad" : "sum") : "", c.className?.(row) ?? ""]
                    .filter(Boolean)
                    .join(" "),
                )}
                title={c.title?.(row)}
                style={c.style?.(row)}
                data-label={c.main || c.headHidden ? undefined : textOf(c)}
                data-rt={c.main ? "main" : undefined}
              >
                {lead ? (
                  <span className="rt-lead">
                    {lead}
                    <span className="rt-lead-body">{cellOf(c, row)}</span>
                  </span>
                ) : (
                  cellOf(c, row)
                )}
              </td>
            );
          })}
        </tr>
        {isOpen && (
          <tr className="rt-detail">
            <td colSpan={columns.length}>{detail}</td>
          </tr>
        )}
        {rowsAfter?.(row)}
        {sub !== null && (
          <tr className="rt-subrow">
            <td colSpan={columns.length}>{sub}</td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <>
      <div className="rt-wrap" ref={wrap} data-block={block ? "" : undefined}>
        <table className={["rt", className ?? ""].filter(Boolean).join(" ")}>
          <caption className={captionVisible ? captionClass : "sr-only"}>
            {caption}
          </caption>
          <thead>
            {headTop && (
              <tr>
                {headTop.cells.map((h) => (
                  <th
                    {...spanOf(h)}
                    scope={h.colSpan && h.colSpan > 1 ? "colgroup" : "col"}
                  >
                    {h.hidden ? <span className="sr-only">{h.label}</span> : h.label}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {columns
                .filter((c) => !headTop?.covered?.includes(c.key))
                .map((c) => {
                  const value = valueOf(c);
                  if (!value || c.headHidden) {
                    return (
                      <th key={c.key} scope="col" className={cls(c, c.headClass)}>
                        {c.headHidden ? <span className="sr-only">{textOf(c)}</span> : c.label}
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
          {groups ? (
            orderGroups(groups).map((g, gi, shown) => (
              <tbody key={g.key} className={g.adds ? "adds-up" : undefined}>
                {g.title !== undefined && (
                  <tr className={["rt-group", g.adds && g.cells ? (gi === 0 ? "part-first" : "") : "", g.adds && g.cells && gi === shown.length - 1 ? "part-last" : ""].filter(Boolean).join(" ")}>
                    {g.cells ? (
                      <>
                        <th scope="rowgroup" className={cls(columns[0]!)}>
                          {g.title}
                        </th>
                        {columns.slice(1).map((c) => (
                          <td
                            key={c.key}
                            className={cls(c, summed.has(c.key) ? "sum" : undefined)}
                            data-label={c.main || c.headHidden ? undefined : textOf(c)}
                            data-rt={c.main ? "main" : undefined}
                          >
                            {g.cells![c.key] ?? null}
                          </td>
                        ))}
                      </>
                    ) : (
                      <>
                        <th
                          colSpan={columns.length - (g.figure === undefined ? 0 : (g.figureSpan ?? 1))}
                          scope="rowgroup"
                        >
                          {g.title}
                        </th>
                        {g.figure !== undefined && (
                          <td colSpan={g.figureSpan} className={cls(columns[columns.length - 1]!)}>
                            {g.figure}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                )}
                {order(g.rows).map((row, at) =>
                  renderRow(row, at, g.rows.length - 1, g.adds === true && !g.cells),
                )}
              </tbody>
            ))
          ) : (
            <tbody className={summed.size ? "adds-up" : undefined}>
              {visible.map((row, at) => renderRow(row, at, last, summed.size > 0))}
            </tbody>
          )}
          {totals.length > 0 && (
            <tfoot>
              {totals.map((t) => (
                <tr key={t.label} className="rt-total" data-series-open={hasSeries && folded.has(`total:${t.label}`) ? "" : undefined}>
                  {columns.map((c, i) =>
                    i === 0 ? (
                      <th key={c.key} scope="row">
                        {t.label}
                        {hasSeries ? foldButton(`total:${t.label}`) : null}
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
        </table>
        <div className="sr-only" role="status" aria-live="polite">
          {live}
        </div>
      </div>
      {more}
    </>
  );
}

/** The button that opens a row's detail under it. Its name says what opens, not "Näytä tapahtumat", which Miksi? uses. */
export function DrillButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="rt-drill" aria-expanded={open} aria-label={label} onClick={onToggle}>
      <span aria-hidden="true">›</span>
    </button>
  );
}
