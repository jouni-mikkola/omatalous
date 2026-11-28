/**
 * Decision: which rows of the table under a chart the household looks at, chosen by pointing at a mark.
 *
 * A chart and the table under it share one selection. The chart sends the key of the mark that was clicked or opened
 * with Enter (`useSelect`); the table of the same scope keeps only the rows whose `rowKey` is that key and says so above
 * itself with a way back (`useRowFilter`). A chart outside a scope sends nothing, a key no row has filters nothing.
 * The table is folded under the chart; a pick opens it on the picked row (ADR 0023).
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { plural } from "../../format.ts";
import { t } from "../../text.ts";
import { IconButton } from "../ui/IconButton.tsx";

export interface Pick {
  selected: string | null;
  /** The key of the picked mark; the same key again, or null, lets go. */
  select: (key: string | null) => void;
  /** The span of marks picked by dragging or with Shift and the arrows, from the first key to the last; it and `selected` are never both set. */
  range: { from: string; to: string } | null;
  /** Picks the marks from key `from` to key `to`; their keys sort in the order of the marks (months as `YYYY-MM`). */
  selectRange: (from: string, to: string) => void;
}

const PickContext = createContext<Pick | null>(null);
/** Only the table of the scope reads this one, so a table drawn as the chart is not cut by its own pick. */
const FilterContext = createContext<Pick | null>(null);

/**
 * The chart above and its table folded under it, one selection between them. `title` names the fold (default "Taulukkona"),
 * `rows` adds the row count. A pick opens the fold; Escape lets go of the pick and leaves it as it is.
 */
export function ChartWithTable({ chart, table, title, rows }: { chart: ReactNode | ((pick: Pick) => ReactNode); table?: ReactNode; title?: string; rows?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<Pick["range"]>(null);
  const [open, setOpen] = useState(false);
  const select = useCallback((key: string | null) => {
    setSelected((now) => (key === null || key === now ? null : key));
    setRange(null);
    if (key !== null) setOpen(true);
  }, []);
  const selectRange = useCallback((from: string, to: string) => {
    setSelected(null);
    setRange({ from, to });
    setOpen(true);
  }, []);
  const pick = useMemo(() => ({ selected, select, range, selectRange }), [selected, select, range, selectRange]);
  return (
    <PickContext.Provider value={pick}>
      {typeof chart === "function" ? chart(pick) : chart}
      {table && (
        <details className="chart-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            <span className="chart-fold-title">{title ?? t("table.folded")}</span>
            {rows !== undefined && <span className="chart-fold-count">{plural(rows, t("table.rows_one"), t("table.rows_many"))}</span>}
          </summary>
          <FilterContext.Provider value={pick}>{table}</FilterContext.Provider>
        </details>
      )}
    </PickContext.Provider>
  );
}

/** Tables inside are not cut by the pick of the scope around them: the opened detail of a row has rows of its own kind. */
export function OutsideFilter({ children }: { children: ReactNode }) {
  return <FilterContext.Provider value={null}>{children}</FilterContext.Provider>;
}

/** What a chart sends its pick to; null outside a `ChartWithTable`. */
export function useSelect(): Pick | null {
  return useContext(PickContext);
}

/** The pick the table of this scope is cut by; null when it has no scope. */
function useRowFilter(): Pick | null {
  return useContext(FilterContext);
}

/**
 * The rows of a table cut by the pick of its scope: `kept` is the picked key (for a span, its first and last key) when the
 * table has such a row, else null. `keptRow` is the picked row, the first of a span, and `lastRow` the last of a span.
 */
export function useRowPick<R>(rows: readonly R[], rowKey: (row: R) => string) {
  const pick = useRowFilter();
  const range = pick?.range ?? null;
  const inRange = (r: R) => range !== null && rowKey(r) >= range.from && rowKey(r) <= range.to;
  const spanRows = range ? rows.filter(inRange) : [];
  const single = pick?.selected != null && rows.some((r) => rowKey(r) === pick.selected) ? pick.selected : null;
  const kept = single ?? (range && spanRows.length > 0 ? `${range.from}–${range.to}` : null);
  const only = <T extends R>(list: readonly T[]): readonly T[] => (single !== null ? list.filter((r) => rowKey(r) === single) : kept === null ? list : list.filter(inRange));
  const keptRow = single !== null ? rows.find((r) => rowKey(r) === single) : spanRows[0];
  const lastRow = single === null && spanRows.length > 1 ? spanRows[spanRows.length - 1] : undefined;
  return { pick, kept, keptRow, lastRow, only };
}

/** The row that is shown, as a chip above the table; its × gives the way back to all of them. */
export function RowFilterNotice({ pick, name }: { pick: Pick; name: ReactNode }) {
  return (
    <div className="rt-filter">
      <span className="chip">
        <span role="status">{name || t("table.only_row")}</span>
        <IconButton label={t("table.show_all")} onClick={() => pick.select(null)}>
          ×
        </IconButton>
      </span>
    </div>
  );
}
