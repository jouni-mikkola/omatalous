/**
 * A card statement file, read into rows (ADR 0025). The browser reads the file and runs this; only the rows it gives go to
 * the install. Three layouts, each told by its own header: a semicolon table (`op`), a tab table (`nordea`) and the lines of
 * a statement's text, as a PDF gives them (`spankki`). A sign in the file is the issuer's; a row leaves here with the
 * account's: money out of the card is negative, a payment into it positive.
 * Decision: a household whose bank cannot give a card's rows reads the statement the bank does give, in its own browser.
 */
import type { IsoDate } from "./types.ts";
import { isPaymentRow, isRealDay, STATEMENT_TEXT_MAX } from "./analysis/statement-explain.ts";

const CARD_FILE_LAYOUTS = ["op", "nordea", "spankki"] as const;
type CardFileLayout = (typeof CARD_FILE_LAYOUTS)[number];

/** Rows of one file. A statement is a month of one card; more is another kind of file. */
export const CARD_FILE_MAX_ROWS = 1000;
/** A row's sum is at most this many cents, the same bound as the typed statement rows. */
export const CARD_FILE_MAX_CENTS = 100_000_000_00;

interface CardFileRow {
  day: IsoDate;
  /** The card account's sign: a purchase is negative, a refund or a payment into the card positive. */
  cents: number;
  text: string;
  /** The issuer's line for a payment received. */
  payment: boolean;
}

export interface CardFileRead {
  layout: CardFileLayout;
  /** The last four digits of the card number when the file names them. */
  cardLast4: string | null;
  periodFrom: IsoDate | null;
  periodTo: IsoDate | null;
  rows: CardFileRow[];
  /** Lines of the file that looked like rows and could not be read, as they are. */
  unread: string[];
}

type CardFileError = "unknown_layout" | "no_rows" | "too_many_rows";

export type CardFileResult = ({ ok: true } & CardFileRead) | { ok: false; error: CardFileError };

const pad = (n: number | string): string => String(n).padStart(2, "0");
const realDay = (y: number, m: number, d: number): IsoDate | null => {
  const iso = `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
  return isRealDay(iso) ? iso : null;
};

/** "03.09.2026" to an ISO day. */
function fiDay(text: string): IsoDate | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  return m ? realDay(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** "-1 234,56", "23,40" or "23,40-" to cents; null for anything else. A sum with a dot decimal is `dotSum`. */
function commaSum(text: string): number | null {
  const m = /^(-?)\s*(\d{1,3}(?:[\s\u00a0\u202f.]\d{3})*|\d+),(\d{2})\s*(-?)\s*(?:EUR|€)?$/i.exec(text.trim());
  if (!m) return null;
  const cents = Number(m[2]!.replace(/[^\d]/g, "")) * 100 + Number(m[3]);
  return m[1] || m[4] ? -cents : cents;
}

function dotSum(text: string): number | null {
  const m = /^([+-]?)(\d+)\.(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number(m[3]);
  return m[1] === "-" ? -cents : cents;
}

const clean = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, STATEMENT_TEXT_MAX).trim();

const last4Of = (text: string): string | null => /(?:\*{2,}|x{2,}|\bkortti\w*|\bcard\b)[\s:*x-]*(\d{4})\b/i.exec(text)?.[1] ?? null;

function row(day: IsoDate, cents: number, text: string): CardFileRow | null {
  const body = clean(text);
  if (!body || !cents || Math.abs(cents) > CARD_FILE_MAX_CENTS) return null;
  return { day, cents, text: body, payment: isPaymentRow(body) };
}

const lines = (text: string): string[] => text.replace(/^\uFEFF/, "").split(/\r?\n/);

/**
 * The cells of one line. A cell that opens with a quote mark runs to its closing mark: the separator inside it is text and a
 * doubled mark is one mark. Text after the closing mark stays in the cell as it is, the way `parseBankCsv` reads it. Null when
 * a quote never closes, so the line is kept as unread (the bank table reader takes such a cell to the end of the text instead).
 */
function cellsOf(line: string, sep: string): string[] | null {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    let open = at;
    while (line[open] === " ") open++;
    let cell = "";
    let from = at;
    if (line[open] === '"') {
      from = open + 1;
      for (;;) {
        const mark = line.indexOf('"', from);
        if (mark < 0) return null;
        cell += line.slice(from, mark);
        from = mark + 1;
        if (line[from] !== '"') break;
        cell += '"';
        from++;
      }
    }
    const end = line.indexOf(sep, from);
    out.push(cell + line.slice(from, end < 0 ? line.length : end));
    if (end < 0) return out;
    at = end + 1;
  }
}

/**
 * `op`: a header row of Ostopäivä;Kirjauspäivä;Kauppa;Summa. The card is named on a line above it ("Kortti;**** 1234"). The
 * sum is the card's debt: positive is a purchase, negative a payment or a refund.
 */
function readOp(all: string[]): CardFileRead | null {
  const head = all.findIndex((l) => /^\s*Ostopäivä;Kirjauspäivä;[^;]+;Summa\s*$/i.test(l));
  if (head < 0) return null;
  const out: CardFileRead = { layout: "op", cardLast4: last4Of(all.slice(0, head).join("\n")), periodFrom: null, periodTo: null, rows: [], unread: [] };
  for (const raw of all.slice(head + 1)) {
    if (!raw.trim()) continue;
    const cells = cellsOf(raw, ";") ?? [];
    const day = cells.length === 4 ? fiDay(cells[0]!) : null;
    const sum = cells.length === 4 ? commaSum(cells[3]!) : null;
    const made = day && sum !== null ? row(day, -sum, cells[2]!) : null;
    if (made) out.rows.push(made);
    else out.unread.push(raw.trim());
  }
  return out;
}

/** `nordea`: tab separated, a header row of Päivä, Kuvaus and Määrä. Dates are ISO, sums have a dot, and the sign is the account's. */
function readNordea(all: string[]): CardFileRead | null {
  const head = all.findIndex((l) => /^\s*Päivä\tKuvaus\tMäärä\s*$/i.test(l));
  if (head < 0) return null;
  const out: CardFileRead = { layout: "nordea", cardLast4: last4Of(all.slice(0, head).join("\n")), periodFrom: null, periodTo: null, rows: [], unread: [] };
  for (const raw of all.slice(head + 1)) {
    if (!raw.trim()) continue;
    const cells = cellsOf(raw, "\t") ?? [];
    const iso = cells.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0]!.trim()) ? cells[0]!.trim() : "";
    const sum = cells.length === 3 ? dotSum(cells[2]!) : null;
    const made = isRealDay(iso) && sum !== null ? row(iso, sum, cells[1]!) : null;
    if (made) out.rows.push(made);
    else out.unread.push(raw.trim());
  }
  return out;
}

const PERIOD = /Laskutuskausi\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{4})/i;

/**
 * `spankki`: the text of a statement. A line "Laskutuskausi 01.09.2026 - 30.09.2026" gives the period, and each row is
 * "03.09. PRISMA TIKKURILA 23,40": a day without a year (the period's), a text and the debt's sum, negative for a payment or a refund.
 */
function readLines(all: string[]): CardFileRead | null {
  const period = PERIOD.exec(all.join("\n"));
  const from = period ? fiDay(period[1]!) : null;
  const to = period ? fiDay(period[2]!) : null;
  if (!from || !to) return null;
  const out: CardFileRead = { layout: "spankki", cardLast4: last4Of(all.join("\n")), periodFrom: from, periodTo: to, rows: [], unread: [] };
  for (const raw of all) {
    const line = raw.replace(/[\s\u00a0\u202f]+/g, " ").trim();
    const m = /^(\d{1,2})\.(\d{1,2})\.\s+(.+?)\s+(-?(?:\d{1,3}(?:[ .]\d{3})+|\d+),\d{2}-?)$/.exec(line);
    if (!m) {
      // a line that opens like a row but does not read must be told, not dropped
      if (/^\d{1,2}\.\d{1,2}\.\s/.test(line) && /\d/.test(line.slice(7))) out.unread.push(line);
      continue;
    }
    // the year of the day is the period's: the latest such day on or before its end
    const day = realDay(Number(to.slice(0, 4)), Number(m[2]), Number(m[1]));
    const inPeriod = day && day > to ? realDay(Number(to.slice(0, 4)) - 1, Number(m[2]), Number(m[1])) : day;
    const sum = commaSum(m[4]!);
    const made = inPeriod && inPeriod >= from && sum !== null ? row(inPeriod, -sum, m[3]!) : null;
    if (made) out.rows.push(made);
    else out.unread.push(line);
  }
  return out;
}

/** Reads the text of a statement file; the layout is found from the text, never from the file's name. */
export function readCardFile(text: string): CardFileResult {
  const all = lines(text);
  const read = readOp(all) ?? readNordea(all) ?? readLines(all);
  if (!read) return { ok: false, error: "unknown_layout" };
  if (!read.rows.length) return { ok: false, error: "no_rows" };
  if (read.rows.length > CARD_FILE_MAX_ROWS) return { ok: false, error: "too_many_rows" };
  if (!read.periodFrom) {
    const days = read.rows.map((r) => r.day).sort();
    read.periodFrom = days[0]!;
    read.periodTo = days[days.length - 1]!;
  }
  return { ok: true, ...read };
}
