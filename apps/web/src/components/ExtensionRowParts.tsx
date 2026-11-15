import { WEB_EXTENSIONS } from "../extensions.ts";
import type { TransactionItem } from "../types.ts";
import { ExtensionBoundary } from "./ExtensionBoundary.tsx";

/**
 * What an add-on module shows on a row of Tapahtumat (docs/MODULES.md): with `mark`, its mark on the row's line
 * (`rowMark`), else what it shows in the opened row (`rowPart`). With no module it draws no element. A part that throws
 * is dropped and the row stays.
 */
export function ExtensionRowParts({ row, mark = false }: { row: TransactionItem; mark?: boolean }) {
  return (
    <>
      {WEB_EXTENSIONS.map((e) => {
        const Part = mark ? e.rowMark : e.rowPart;
        return (
          Part && (
            <ExtensionBoundary key={e.id}>
              <Part row={row} />
            </ExtensionBoundary>
          )
        );
      })}
    </>
  );
}
