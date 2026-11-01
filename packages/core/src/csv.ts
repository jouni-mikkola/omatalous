/**
 * CSV for spreadsheet apps in Finnish locale: semicolon separated, decimal comma, UTF-8 with BOM so Excel detects the
 * encoding. One definition for the server's exports and the table's own download in the browser.
 */
export type CsvCell = string | number | null | undefined;

export function csvBody(rows: readonly (readonly CsvCell[])[]): string {
  const cell = (v: CsvCell) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    // formula injection guard: a cell that starts with = + - @, a tab or a CR (also after blanks) is
    // treated as text by spreadsheets
    const safe = typeof v === "string" && /^\s*[=+\-@]|^[\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `${rows.map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`; // language-allow: semicolon the column separator of Finnish spreadsheets
}

/** The BOM and the rows. A long file is written in pieces with `csvBody` instead, the BOM only once. */
export function csv(rows: readonly (readonly CsvCell[])[]): string {
  return `\ufeff${csvBody(rows)}`;
}
