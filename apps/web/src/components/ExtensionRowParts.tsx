import { WEB_EXTENSIONS } from "../extensions.ts";
import type { TransactionItem } from "../types.ts";

/**
 * What the build's extensions show on a row of Tapahtumat: with `mark`, their mark on the row's line (`rowMark`), else
 * what they show under the row (`rowPart`). Nothing in the shared build.
 */
export function ExtensionRowParts({ row, mark = false }: { row: TransactionItem; mark?: boolean }) {
  return <>{WEB_EXTENSIONS.map((e) => {
    const Part = mark ? e.rowMark : e.rowPart;
    return Part && <Part key={e.id} row={row} />;
  })}</>;
}
