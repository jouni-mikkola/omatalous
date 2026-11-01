/**
 * The table as a CSV file: the rows the reader sees, in their order, one line each. The head is the columns' names, a sum
 * is a number (euros, not "1 050 €") and the grouped rows carry their group's name in the first column. The
 * format is the server's (core `csv`): semicolons, decimal comma, a BOM for Excel. Pure but for `saveCsv`.
 */
import { type CsvCell, csv } from "@banking/core";
import { type Column, csvValueOf, textOf } from "./columns.ts";
import { t } from "../../text.ts";
import type { Section } from "./model.ts";

/** The name of the column that holds the group's name in a grouped table's file. */
export const groupHead = (): string => t("table.csv_group");

/** The columns the file has: every column with a name, unless it says `csv: false`. */
const inFile = <R,>(columns: readonly Column<R>[]): Column<R>[] => columns.filter((c) => c.csv !== false && !c.headHidden);

/** The lines of the file as cells; `sections` is set when the table is grouped (then `rows` is their flat order). */
export function csvLines<R>(columns: readonly Column<R>[], rows: readonly R[], sections: readonly Section<R>[] | null): CsvCell[][] {
  const used = inFile(columns);
  const head = used.map(textOf);
  const line = (row: R): CsvCell[] => used.map((c) => csvValueOf(c, row));
  if (!sections) return [head, ...rows.map(line)];
  return [[groupHead(), ...head], ...sections.flatMap((s) => s.rows.map((row): CsvCell[] => [s.title, ...line(row)]))];
}

/** The file's text for a table. */
export const tableCsv = <R,>(columns: readonly Column<R>[], rows: readonly R[], sections: readonly Section<R>[] | null): string => csv(csvLines(columns, rows, sections));

/** The file name: the table's name with letters and digits, and `.csv`. */
export const csvName = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9äöå]+/g, "-").replace(/^-|-$/g, "") || t("table.csv_name")}.csv`;

/** Hands the file to the browser as a download. */
export function saveCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvName(name);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
