import { WEB_EXTENSIONS } from "../extensions.ts";
import type { TransactionItem } from "../types.ts";

/**
 * What an add-on module shows on a row of Tapahtumat (docs/MODULES.md): with `mark`, its mark on the row's line
 * (`rowMark`), else what it shows in the opened row (`rowPart`). With no module it draws no element.
 */
export function ExtensionRowParts({ row, mark = false }: { row: TransactionItem; mark?: boolean }) {
  return (
    <>
      {WEB_EXTENSIONS.map((e) => {
        const Part = mark ? e.rowMark : e.rowPart;
        return Part && <Part key={e.id} row={row} />;
      })}
    </>
  );
}
