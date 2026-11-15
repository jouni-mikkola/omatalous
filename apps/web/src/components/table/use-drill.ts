import { useState } from "react";
import { usePageAddress } from "../../page-address.ts";
import { DRILL_PARAM, readTableState, tableId, writeTableState } from "../../table-state.ts";

/**
 * The row a table has open, when the table itself holds it (a page that holds it passes `open`). In the address it
 * comes back with a reload and goes with a link; without an address it is state of the table.
 */
export function useOpenRow(caption: string): [string | null, (key: string | null) => void] {
  const [own, setOwn] = useState<string | null>(null);
  const address = usePageAddress();
  if (!address) return [own, setOwn];
  const table = tableId(caption);
  return [
    readTableState(address.search[DRILL_PARAM]).get(table) ?? null,
    (key) => address.change({ [DRILL_PARAM]: writeTableState(address.search[DRILL_PARAM], table, key) }),
  ];
}
