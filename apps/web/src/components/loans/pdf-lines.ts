/**
 * The text layer of a PDF page as the lines a reader sees. pdf.js gives pieces of text with a place each, in the order
 * the file drew them. A loan statement is a table, so a label and its value are two pieces far apart on one row: they
 * become one line with a tab between them, which the loan parser reads as a label and its value.
 */

/** The part of a pdf.js text item this needs. `transform[4]` and `[5]` are the left edge and the baseline. */
export interface PdfTextPiece {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
}

/** Pieces whose baselines are closer than this share of the text height stand on one row. */
const SAME_ROW = 0.5;
/** A gap over this many text heights starts a new column; one over `WORD_GAP` is a space between words. */
const COLUMN_GAP = 1.5;
const WORD_GAP = 0.15;

export function pdfLines(items: readonly PdfTextPiece[]): string[] {
  const pieces = items
    .filter((item) => item.str.trim() !== "")
    .map((item) => ({ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width, height: item.height || Math.abs(item.transform[3] ?? 0) || 10 }));
  // top of the page first: a PDF's y grows upwards
  pieces.sort((a, b) => b.y - a.y);
  const rows: (typeof pieces)[] = [];
  for (const piece of pieces) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0]!.y - piece.y) < SAME_ROW * Math.max(row[0]!.height, piece.height)) row.push(piece);
    else rows.push([piece]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let end = 0;
    for (const piece of row) {
      const gap = piece.x - end;
      if (line !== "") {
        if (gap > COLUMN_GAP * piece.height) line = `${line.trimEnd()}\t`;
        else if (gap > WORD_GAP * piece.height && !line.endsWith(" ") && !piece.str.startsWith(" ")) line += " ";
      }
      line += line.endsWith("\t") ? piece.str.trimStart() : piece.str;
      end = piece.x + piece.width;
    }
    return line.trim();
  });
}
