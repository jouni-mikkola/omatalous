/**
 * Decision: which rows of the table under a chart the household looks at, chosen by pointing at a mark.
 *
 * A chart and the table under it share one selection. The chart sends the key of the mark that was clicked or opened
 * with Enter (`useSelect`); the table of the same scope keeps only the rows whose `rowKey` is that key and says so above
 * itself with a way back (`useRowFilter`). A chart outside a scope sends nothing, a key no row has filters nothing.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { t } from "../../text.ts";
import { Button } from "../ui/Button.tsx";

export interface Pick {
  selected: string | null;
  /** The key of the picked mark; the same key again, or null, lets go. */
  select: (key: string | null) => void;
}

const PickContext = createContext<Pick | null>(null);
/** Only the table of the scope reads this one, so a table drawn as the chart is not cut by its own pick. */
const FilterContext = createContext<Pick | null>(null);

/** The chart and its table side by side in the page: the chart above, the table below, one selection between them. */
export function ChartWithTable({ chart, table }: { chart: ReactNode | ((pick: Pick) => ReactNode); table?: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback((key: string | null) => setSelected((now) => (key === null || key === now ? null : key)), []);
  const pick = useMemo(() => ({ selected, select }), [selected, select]);
  return (
    <PickContext.Provider value={pick}>
      {typeof chart === "function" ? chart(pick) : chart}
      {table && <FilterContext.Provider value={pick}>{table}</FilterContext.Provider>}
    </PickContext.Provider>
  );
}

/** What a chart sends its pick to; null outside a `ChartWithTable`. */
export function useSelect(): Pick | null {
  return useContext(PickContext);
}

/** The pick the table of this scope is cut by; null when it has no scope. */
function useRowFilter(): Pick | null {
  return useContext(FilterContext);
}

/** The rows of a table cut by the pick of its scope: `kept` is the picked key when the table has such a row, else null. */
export function useRowPick<R>(rows: readonly R[], rowKey: (row: R) => string) {
  const pick = useRowFilter();
  const kept = pick?.selected != null && rows.some((r) => rowKey(r) === pick.selected) ? pick.selected : null;
  const only = <T extends R>(list: readonly T[]): readonly T[] => (kept === null ? list : list.filter((r) => rowKey(r) === kept));
  const keptRow = kept === null ? undefined : rows.find((r) => rowKey(r) === kept);
  return { pick, kept, keptRow, only };
}

/** Says above the table that one row is shown, and gives the way back to all of them. */
export function RowFilterNotice({ pick, name }: { pick: Pick; name: ReactNode }) {
  return (
    <p className="rt-filter" role="status">
      <span>
        {t("table.only_row")}{name ? <>: <strong>{name}</strong></> : ""}.
      </span>
      <Button variant="link" onClick={() => pick.select(null)}>
        {t("table.show_all")}
      </Button>
    </p>
  );
}
