import { Button } from "./ui/Button.tsx";
import { saveCsv } from "./table/csv.ts";
import { t } from "../text.ts";

/**
 * Print and CSV of a sheet. Printing is the browser's own (print.css of the sheet hides the rest of the page while
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
      <Button onClick={print}>{t("sheet.print")}</Button>
      <Button onClick={() => saveCsv(name, csv())}>{t("sheet.csv")}</Button>
    </>
  );
}
