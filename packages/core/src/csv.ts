/**
 * CSV for spreadsheet apps in Finnish locale: semicolon separated, decimal comma, UTF-8 with BOM so Excel detects the
 * encoding. One definition for the server's exports and the table's own download in the browser.
 */
export type CsvCell = string | number | null | undefined;

/** A finite number as plain decimal digits, never an exponent. Not finite gives an empty cell. */
function plainNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign = "", int = "", frac = "", exp = "0"] = m;
  const digits = int + frac;
  const point = int.length + Number(exp);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

export function csvBody(rows: readonly (readonly CsvCell[])[]): string {
  const cell = (v: CsvCell) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? plainNumber(v).replace(".", ",") : v;
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
