import { isPaymentRow, STATEMENT_TEXT_MAX } from "@banking/core";

// Lines copied from a card statement, one row per line: the day, the text, the sum. Read in the page; nothing leaves it
// before the user saves.

export interface StatementLine {
  day: string;
  cents: number;
  text: string;
}

export interface ReadStatement {
  rows: StatementLine[];
  /** Payment-received lines (MAKSU, KIITOS, SUORITUS): not purchases, left out. */
  payments: number;
  /** Lines with no day or no sum, as they were typed. */
  unread: string[];
}

const SUM = /(-?\s*\d{1,3}(?:[   .]\d{3})*,\d{2}|-?\s*\d+,\d{2})\s*(-?)\s*(?:EUR|€)?$/i;
const DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?\s+/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})\s+/;

const pad = (n: number | string): string => String(n).padStart(2, "0");
const realDay = (y: number, m: number, d: number): string | null => {
  const iso = `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
  const at = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === iso ? iso : null;
};

/**
 * A statement shows a day as "12.10." (the year is the period's: the latest such day on or before its end) or "12.10.2026".
 * A sum is "23,45", "1 234,56", "-23,45" or "23,45-", a refund when it is negative.
 */
export function readStatement(text: string, periodTo: string): ReadStatement {
  const out: ReadStatement = { rows: [], payments: 0, unread: [] };
  const endYear = Number(periodTo.slice(0, 4));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[\s  ]+/g, " ").trim();
    if (!line) continue;
    let day: string | null = null;
    let rest = line;
    const iso = ISO_DAY.exec(line);
    const fi = DAY.exec(line);
    if (iso) {
      day = realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      rest = line.slice(iso[0].length);
    } else if (fi) {
      const m = Number(fi[2]);
      const d = Number(fi[1]);
      day = fi[3] ? realDay(Number(fi[3]), m, d) : (realDay(endYear, m, d) ?? "");
      if (!fi[3] && day && day > periodTo) day = realDay(endYear - 1, m, d);
      rest = line.slice(fi[0].length);
    }
    const sum = SUM.exec(rest);
    const body = sum ? rest.slice(0, sum.index).trim().slice(0, STATEMENT_TEXT_MAX).trim() : "";
    if (!day || !sum || !body) {
      out.unread.push(line);
      continue;
    }
    if (isPaymentRow(body)) {
      out.payments++;
      continue;
    }
    const digits = sum[1]!.replace(/[^\d,]/g, "").replace(",", "");
    const negative = sum[1]!.includes("-") || sum[2] === "-";
    const cents = Number(digits) * (negative ? -1 : 1);
    if (!cents) {
      out.unread.push(line);
      continue;
    }
    out.rows.push({ day, cents, text: body });
  }
  return out;
}
