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
import { Fragment, type KeyboardEvent, type ReactNode, useState } from "react";
import { money } from "../../format.ts";
import { t } from "../../text.ts";
import { useMore } from "../More.tsx";
import { Button } from "../ui/Button.tsx";
import { BarFigure, SortHead } from "./Cells.tsx";
import { RowFilterNotice, useRowPick } from "./selection.tsx";
import "../../styles/table.css";
import { type Column, FIGURE, searchFns, textOf, valueOf } from "./columns.ts";
import { saveCsv, tableCsv } from "./csv.ts";
import { type Section, useShown } from "./model.ts";
import { sortMessage, sortPhrase, sortRows } from "./sort.ts";
import { useOpenRow } from "./use-drill.ts";
import { useMarkup } from "./use-markup.ts";
import { Toolbar } from "./LazyToolbar.ts";
import { useOwnView } from "./use-view.ts";
import { useWindow, WINDOW_MIN_ROWS } from "./use-window.ts";
import { SLIM, useBlock } from "./use-block.ts";
import type { HeadCell, RowGroup, TableProps } from "./types.ts";
import { LONG_LIST_ROWS, pressSort, type TableView } from "./view.ts";
import { css } from "../../css.ts";

export type { Column } from "./columns.ts";
export type { TableView } from "./view.ts";

export type { HeadCell, RowGroup, TableProps } from "./types.ts";

const spanOf = (h: HeadCell) => ({
  key: h.key,
  colSpan: h.colSpan,
  rowSpan: h.rowSpan,
  className: h.className,
});

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
  seriesLabel = t("table.months"),
  csv: csvWanted,
  toolbar,
  search: searchWanted = true,
  searchLabel,
  rowsSearched = false,
  toolbarExtra,
  listTotal,
  allUncounted = false,
  view: viewProp,
  onView,
}: TableProps<R>) {
  const slim = columns.filter((c) => !c.series && c.phone !== "hide").length <= SLIM;
  const [wrap, block] = useBlock(slim);
  const [openOwn, setOpenOwn] = useOpenRow(caption);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openOwn;
  const setOpen = (k: string | null) => (controlled ? onOpen?.(k) : setOpenOwn(k));
  const textKeys = columns.filter((c) => c.kind === "text").map((c) => c.key);
  const [viewOwn, setViewOwn] = useOwnView(caption, columns.map((c) => c.key));
  const view = viewProp ?? viewOwn;
  const setView = (next: TableView) => (viewProp !== undefined ? onView?.(next) : setViewOwn(next));
  // the live region stays silent until the reader has done something
  const [touched, setTouched] = useState(false);
  const change = (next: TableView) => {
    setTouched(true);
    setView(next);
  };
  const sort = view.sort;
  const markup = useMarkup(toolbar !== false && (csvWanted === true || rows.length > LONG_LIST_ROWS));
  const shown = useShown(rows, columns, rowKey, rowsSearched ? { ...view, query: "" } : view, markup);
  const hasSeries = columns.some((c) => c.series);
  // a chart above this table may have picked a mark: only that mark's row stays, when the table has such a row
  const { pick, kept, keptRow, only } = useRowPick(rows, rowKey);
  const keptHead = columns.find((c) => c.rowHead);
  // a group of the page keeps its own order of rows without a sort; with one, the rows follow the rank the model gave them
  const order = (list: readonly R[]): readonly R[] => {
    const kept = list.filter((r) => shown.rank.has(rowKey(r)));
    return sort ? [...kept].sort((a, b) => shown.rank.get(rowKey(a))! - shown.rank.get(rowKey(b))!) : kept;
  };
  const filtered = (!rowsSearched && view.query.trim() !== "") || view.chip !== null;
  const orderGroups = (list: RowGroup<R>[]) => {
    const ordered = sort && list.some((g) => g.values) ? sortRows(list, (g) => g.values?.[sort.key] ?? null, sort.dir) : list;
    // a group none of whose rows match, or none that the picked mark keeps, is left out with its head and its figures
    return filtered || kept !== null ? ordered.filter((g) => only(g.rows).some((r) => shown.rank.has(rowKey(r)))) : ordered;
  };
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
  const { shown: visible, more } = useMore(only(shown.rows), groups ? Infinity : (page ?? Infinity));
  const last = visible.length - 1;
  const ordered = !shown.sections && groups ? orderGroups(groups) : [];
  // a long table of groups draws the groups near the screen only (use-window.ts)
  const win = useWindow(wrap, ordered.map((g) => g.key), ordered.map((g) => g.rows.length + 1), ordered.length > 0 && rows.length > WINDOW_MIN_ROWS);

  // a page that has the server search its rows always has the box; otherwise only a long list does
  const searchable = rowsSearched || (searchWanted && searchFns(columns).length > 0 && rows.length > LONG_LIST_ROWS);
  const groupable = columns.filter((c) => c.group).map((c) => ({ key: c.key, label: textOf(c) }));
  const sortable = columns.filter((c) => valueOf(c));
  // the toolbar holds what narrows the rows: a search box, chips, grouping. A table with none of them has no bar
  const tools = toolbar ?? (searchable || shown.chips.length > 0 || groupable.length > 0);
  // the file is a seldom need: one link under the table, for a long list or where the page asks, never a button above it
  const csvLink = toolbar !== false && csvWanted !== false && (csvWanted || rows.length > LONG_LIST_ROWS) && shown.rows.length > 0;
  // a phone shows no head to press, so the toolbar carries the choice of order
  const phoneSort = block && sortable.length > 0;
  const sortChoices = sortable.flatMap((c) => {
    const first = c.kind === "text" ? "ascending" : "descending";
    const other = first === "ascending" ? "descending" : "ascending";
    return [first, other].map((dir) => ({ key: c.key, text: textOf(c), dir: dir as "ascending" | "descending", phrase: sortPhrase(textOf(c), dir as "ascending" | "descending", c.kind === "text") }));
  });
  const count = shown.rows.length;
  const note = !filtered ? undefined : count === 0 ? t("table.no_match") : `${t("table.shown", { count, total: shown.total })}${totals.length > 0 ? t("table.total_all") : ""}`;
  // the file keeps the order the table draws: the reader's groups, else the page's groups with their rows ranked by the sort
  const pickedSections = shown.sections && (kept === null ? shown.sections : shown.sections.map((g) => ({ ...g, rows: [...only(g.rows)] })).filter((g) => g.rows.length > 0));
  const drawn: Section<R>[] | null = pickedSections ?? (groups ? ordered.map((g) => ({ key: g.key, title: typeof g.title === "string" ? g.title : (g.csv ?? ""), rows: [...order(g.rows)] })) : null);
  const download = () => saveCsv(caption, tableCsv(columns, drawn ? drawn.flatMap((g) => g.rows) : only(shown.rows), drawn && drawn.some((g) => g.title !== "") ? drawn : null));

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

  /** Escape closes the open detail and the focus goes back to the button of its row, where the reader was. */
  const closeOnEscape = (e: KeyboardEvent, key: string) => {
    if (e.key !== "Escape" || open !== key) return;
    e.stopPropagation();
    setOpen(null);
    const back = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-drill]") ?? [])].find((b) => b.dataset.drill === key);
    back?.focus();
  };

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
                  label={drillLabel?.(row) ?? t("table.open_row")}
                  rowKey={key}
                  onKeyDown={(e) => closeOnEscape(e, key)}
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
                  ref={c.style ? css(c.style(row) ?? {}) : undefined}
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
                ref={c.style ? css(c.style(row) ?? {}) : undefined}
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
          <tr className="rt-detail" onKeyDown={(e) => closeOnEscape(e, key)}>
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
      {pick && keptRow !== undefined && <RowFilterNotice pick={pick} name={keptHead ? cellOf(keptHead, keptRow) : null} />}
      {(tools || phoneSort) && (
        <Toolbar
          label={t("table.filter_of", { caption })}
          searchLabel={searchLabel ?? t("table.search_of", { caption })}
          searchable={searchable}
          query={view.query}
          onQuery={(q) => change({ ...view, query: q })}
          chips={listTotal === undefined ? shown.chips : shown.chips.map((c) => ({ ...c, count: null }))}
          all={allUncounted ? null : (listTotal ?? shown.all)}
          chip={view.chip}
          onChip={(chip) => change({ ...view, chip })}
          groups={groupable}
          group={view.group}
          onGroup={(group) => change({ ...view, group })}
          sort={phoneSort ? { choices: sortChoices, value: sort, onChange: (next) => change({ ...view, sort: next }) } : undefined}
          note={note}
          extra={toolbarExtra}
        />
      )}
      <div className="rt-wrap" ref={wrap} data-block={block ? "" : undefined} data-plain={!searchWanted && csvWanted === false ? "" : undefined} onFocusCapture={win?.onFocus}>
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
                      onSort={() => change(pressSort(view, c.key, textKeys))}
                    />
                  );
                })}
            </tr>
          </thead>
          {pickedSections ? (
            pickedSections.map((sec) => (
              <tbody key={sec.key}>
                <tr className="rt-group">
                  <th colSpan={columns.length} scope="rowgroup">
                    {sec.title || t("table.no_value")}
                    <span className="rt-group-count">{sec.rows.length}</span>
                  </th>
                </tr>
                {sec.rows.map((row, at) => renderRow(row, at, sec.rows.length - 1, false))}
              </tbody>
            ))
          ) : groups ? (
            <>
              {win && <Spacer px={win.before} span={columns.length} />}
              {ordered.slice(win?.from ?? 0, win?.to ?? ordered.length).map((g, at) => {
                const gi = (win?.from ?? 0) + at;
                return (
              <tbody key={g.key} className={g.adds ? "adds-up" : undefined} data-vkey={win ? g.key : undefined}>
                {g.title !== undefined && (
                  <tr className={["rt-group", g.adds && g.cells ? (gi === 0 ? "part-first" : "") : "", g.adds && g.cells && gi === ordered.length - 1 ? "part-last" : ""].filter(Boolean).join(" ")}>
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
                {order(only(g.rows)).map((row, at) =>
                  renderRow(row, at, only(g.rows).length - 1, g.adds === true && !g.cells),
                )}
              </tbody>
                );
              })}
              {win && <Spacer px={win.after} span={columns.length} />}
            </>
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
      {csvLink && (
        <p className="rt-csv">
          <Button variant="link" onClick={download}>
            {t("table.csv")}
          </Button>
        </p>
      )}
    </>
  );
}

/** The button that opens a row's detail under it. Its name says what opens, not "Näytä tapahtumat", which Miksi? uses. */
function DrillButton({ open, onToggle, label, rowKey, onKeyDown }: { open: boolean; onToggle: () => void; label: string; rowKey?: string; onKeyDown?: (e: KeyboardEvent) => void }) {
  return (
    <button type="button" className="rt-drill" aria-expanded={open} aria-label={label} data-drill={rowKey} onClick={onToggle} onKeyDown={onKeyDown}>
      <span aria-hidden="true">›</span>
    </button>
  );
}

/** Stands for the groups a windowed table leaves out: an empty body as high as they would be. */
function Spacer({ px, span }: { px: number; span: number }) {
  if (px <= 0) return null;
  return (
    <tbody className="rt-spacer" aria-hidden="true" ref={css({ "--rt-gap": `${Math.round(px)}px` })}>
      <tr className="rt-spacer">
        <td colSpan={span} />
      </tr>
    </tbody>
  );
}
