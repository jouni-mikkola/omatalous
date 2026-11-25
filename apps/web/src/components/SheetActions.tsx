import { Button } from "./ui/Button.tsx";
import { saveCsv } from "./table/csv.ts";
import { t } from "../text.ts";

/**
 * Print and CSV of a sheet, as two links in the head of its card. Printing is the browser's own (print.css of the sheet hides the rest of the page while
 * `printing-sheet` is set), so there is no PDF library and nothing to load.
 */
export function SheetActions({ id, name, csv }: { id: string; name: string; csv: () => string }) {
  const print = () => {
    const root = document.documentElement;
    const card = document.getElementById(id);
    card?.classList.add("print-sheet");
    root.classList.add("printing-sheet");
    const done = () => {
      card?.classList.remove("print-sheet");
      root.classList.remove("printing-sheet");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };
  return (
    <>
      <Button variant="link" onClick={print}>
        {t("sheet.print")}
      </Button>
      <span className="sheet-sep" aria-hidden="true">
        ·
      </span>
      <Button variant="link" onClick={() => saveCsv(name, csv())}>
        {t("sheet.csv")}
      </Button>
    </>
  );
}
