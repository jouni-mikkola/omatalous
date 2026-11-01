import { useState } from "react";
import { usePageAddress } from "../../page-address.ts";
import { readTableState, SORT_PARAM, sortOf, sortValue, tableId, writeTableState } from "../../table-state.ts";
import { EMPTY_VIEW, type TableView } from "./view.ts";

/**
 * The view a table holds itself, when its page does not hand one over. The search, the chip and the grouping are state of
 * the table. The order is kept in the address when the page has one (page-address.ts), so a reload or a shared link shows
 * the same order; without an address it is state of the table. `known` lists the columns that exist, so an address that
 * outlived a column does not sort by nothing.
 */
export function useOwnView(caption: string, known: readonly string[]): [TableView, (next: TableView) => void] {
  const [own, setOwn] = useState<TableView>(EMPTY_VIEW);
  const address = usePageAddress();
  if (!address) return [own, setOwn];
  const table = tableId(caption);
  const fromAddress = sortOf(readTableState(address.search[SORT_PARAM]).get(table));
  const sort = fromAddress && known.includes(fromAddress.key) ? fromAddress : null;
  const set = (next: TableView) => {
    setOwn(next);
    if (next.sort?.key === sort?.key && next.sort?.dir === sort?.dir) return;
    address.change({ [SORT_PARAM]: writeTableState(address.search[SORT_PARAM], table, next.sort ? sortValue(next.sort) : null) });
  };
  return [{ ...own, sort }, set];
}
