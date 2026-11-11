/**
 * A bank's own CSV export of an account, read into rows (ADR 0025). The browser reads the file and runs this; only the rows
 * go to the install. Banks differ in their columns, so the household matches them once: `guessBankCsvLayout` proposes a
 * match from the header's words and the browser remembers the one the household settled on, keyed by the header
 * (`bankCsvKey`). The sign of a row is the account's: money out is negative.
 * Decision: a household whose bank gives an account's rows only as a file reads them in its own browser, with the columns it matched once.
 */
import type { IsoDate } from "./types.ts";
import { isRealDay, STATEMENT_TEXT_MAX } from "./analysis/statement-explain.ts";
import { CARD_FILE_MAX_CENTS } from "./card-file.ts";

const DELIMITERS = [";", ",", "\t"] as const;
type Delimiter = (typeof DELIMITERS)[number];

/** Which column (0-based) holds what. The amount is one signed column, or a debit and a credit column. */
export interface BankCsvLayout {
  delimiter: Delimiter;
  date: number;
  text: number;
  amount: number | null;
  /** Both given when the bank splits the sum: a debit is money out (any sign in the file), a credit money in. */
  debit: number | null;
  credit: number | null;
  /** Other text columns, tried in order when `text` is empty or only an account number. */
  more?: number[];
  /** When `text` names the payee, the column that names the payer: used for money in. */
  textIn?: number | null;
}

interface BankCsvRow {
  day: IsoDate;
  cents: number;
  text: string;
}

export interface BankCsvTable {
  delimiter: Delimiter;
  header: string[];
  body: string[][];
}

interface BankCsvRead {
  periodFrom: IsoDate;
  periodTo: IsoDate;
  rows: BankCsvRow[];
  /** Lines of the file that did not read as a row, joined with the delimiter. */
  unread: string[];
}

type BankCsvError = "unknown_layout" | "no_rows" | "too_many_rows";

/** Splits quoted CSV text into cells. A quote doubled inside quotes is a quote; a quoted cell may hold a line break. */
function split(text: string, delimiter: Delimiter): string[][] {
  const out: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endLine = () => {
    endCell();
    if (cells.some((c) => c.trim())) out.push(cells.map((c) => c.trim()));
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && !cell.trim()) {
      cell = "";
      quoted = true;
    } else if (ch === delimiter) endCell();
    else if (ch === "\n") endLine();
    else if (ch !== "\r") cell += ch;
  }
  endLine();
  return out;
}

/** The delimiter that splits the first line into the most cells, outside quotes. */
function findDelimiter(first: string): Delimiter {
  let best: Delimiter = ";";
  let most = 1;
  for (const d of DELIMITERS) {
    const n = split(first, d)[0]?.length ?? 0;
    if (n > most) {
      best = d;
      most = n;
    }
  }
  return best;
}

/** The header row and the rows under it. The first line that holds anything is the header. */
export function parseBankCsv(text: string): BankCsvTable | null {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim());
  if (!firstLine) return null;
  const delimiter = findDelimiter(firstLine);
  const [header, ...body] = split(clean, delimiter);
  if (!header || header.length < 2 || !body.length) return null;
  return { delimiter, header, body };
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The key a remembered layout is kept under: the header, as the bank words it. Two banks with the same header share a layout, which is right. */
export function bankCsvKey(header: readonly string[]): string {
  return header.map(norm).join("|");
}

const WORDS = {
  date: /^(kirjauspäivä|kirjauspvm|maksupäivä|maksupvm|tapahtumapäivä|tapahtumapvm|päivämäärä|päivä|pvm|ostopäivä|booking date|transaction date|value date|date)(?![\p{L}])/u,
  amount: /^(summa|määrä|rahamäärä|euro|eur|amount|sum)(?![\p{L}])/u,
  debit: /^(debet|veloitus|menot|ulos|debit|withdrawal|out)(?![\p{L}])/u,
  credit: /^(kredit|hyvitys|tulot|sisään|credit|deposit|in)(?![\p{L}])/u,
  text: /(saaja|maksaja|saaja\/maksaja|kauppa|vastapuoli|nimi|selite|otsikko|kuvaus|viesti|payee|counterparty|merchant|description|details|reference)/,
};
/** A payee or payer names the row better than a message does. */
// A bare "Maksaja" or "Maksunsaaja" may hold an IBAN (Nordea), so a party column that says it is a name comes first and a bare one last.
const TEXT_ORDER = [/(saaja|maksaja).*nimi|nimi.*(saaja|maksaja)|kauppa|vastapuoli|payee|counterparty|merchant/, /selite|otsikko|kuvaus|description|details|nimi/, /saaja|maksaja/, /viesti|reference/];

function firstWhere(header: readonly string[], test: (h: string) => boolean, not: readonly (number | null)[] = []): number | null {
  const i = header.findIndex((h, n) => !not.includes(n) && test(norm(h)));
  return i < 0 ? null : i;
}

/** The match the words of the header suggest, or null when a date, a text or a sum cannot be found. The household checks it. */
export function guessBankCsvLayout(table: Pick<BankCsvTable, "delimiter" | "header">): BankCsvLayout | null {
  const { header, delimiter } = table;
  const date = firstWhere(header, (h) => WORDS.date.test(h));
  if (date === null) return null;
  const amount = firstWhere(header, (h) => WORDS.amount.test(h), [date]);
  const debit = amount === null ? firstWhere(header, (h) => WORDS.debit.test(h), [date]) : null;
  const credit = amount === null ? firstWhere(header, (h) => WORDS.credit.test(h), [date, debit]) : null;
  if (amount === null && (debit === null || credit === null)) return null;
  const used = [date, amount, debit, credit];
  let text: number | null = null;
  for (const rank of TEXT_ORDER) text ??= firstWhere(header, (h) => rank.test(h) && WORDS.text.test(h), used);
  text ??= firstWhere(header, (h) => WORDS.text.test(h), used);
  if (text === null) return null;
  const layout: BankCsvLayout = { delimiter, date, text, amount, debit, credit };
  const taken = [...used, text];
  const more: number[] = [];
  for (const rank of TEXT_ORDER) {
    header.forEach((h, n) => {
      if (!taken.includes(n) && !more.includes(n) && rank.test(norm(h)) && WORDS.text.test(norm(h))) more.push(n);
    });
  }
  if (more.length) layout.more = more;
  // the text names the payee: money in is named by the payer column instead
  if (/saaja/.test(norm(header[text]!)) && !/maksaja/.test(norm(header[text]!))) {
    const payer = firstWhere(header, (h) => /maksaja/.test(h) && !/saaja/.test(h.replace("maksaja", "")), taken);
    if (payer !== null) layout.textIn = payer;
  }
  return layout;
}

/** True when the layout points at columns the table has and gives a sum one way only. */
export function isBankCsvLayout(layout: BankCsvLayout, columns: number): boolean {
  const ok = (n: number | null): boolean => n === null || (Number.isInteger(n) && n >= 0 && n < columns);
  const single = layout.amount !== null;
  const split = layout.debit !== null && layout.credit !== null;
  return DELIMITERS.includes(layout.delimiter) && ok(layout.date) && ok(layout.text) && ok(layout.amount) && ok(layout.debit) && ok(layout.credit) && ok(layout.textIn ?? null) && (layout.more ?? []).every((n) => ok(n)) && single !== split;
}

/** "03.09.2026", "3/9/2026" (day first), "2026-09-03" or "2026/09/03", with a time after it allowed. */
function day(text: string): IsoDate | null {
  const s = text.trim();
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ].*)?$/.exec(s);
  const fi = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s.*)?$/.exec(s);
  const [y, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : fi ? [fi[3]!, fi[2]!, fi[1]!] : [];
  if (!y || !m || !d) return null;
  const out = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isRealDay(out) ? out : null;
}

/** "-1 234,56", "1,234.56", "+23.40", "23,40-" or "12 EUR" to cents; null for anything else. A lone comma or dot is the decimal one; with three digits after it ("12,345") it could be either, so it does not read. */
function sum(text: string): number | null {
  const m = /^([+-]?)\s*([\d\s\u00a0\u202f.,]*\d)\s*([+-]?)\s*(?:EUR|€)?$/i.exec(text.trim());
  if (!m) return null;
  const body = m[2]!.replace(/[\u00a0\u202f]/g, " ");
  const at = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  const tail = at < 0 ? "" : body.slice(at + 1);
  const bothKinds = body.includes(".") && body.includes(",");
  const decimal = at >= 0 && (bothKinds || ((tail.length === 1 || tail.length === 2) && body.split(body[at]!).length === 2));
  // a thousand times apart, and a CSV has no closing balance to tell which: the line goes to unread
  if (!decimal && tail.length === 3 && body.split(/[.,]/).length === 2) return null;
  const whole = decimal ? body.slice(0, at) : body;
  // groups of three, one kind of separator: "1.2.3" or "1,23.456" is a typo, not a sum
  if (whole && !/^(\d+|\d{1,3}([ .,])\d{3}(\2\d{3})*)$/.test(whole)) return null;
  if (decimal && !/^\d{1,2}$/.test(tail)) return null;
  const cents = Number(whole.replace(/[^\d]/g, "") || "0") * 100 + (decimal ? Number(tail.padEnd(2, "0")) : 0);
  return m[1] === "-" || m[3] === "-" ? -cents : cents;
}

export const cleanStatementText = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, STATEMENT_TEXT_MAX).trim();

function rowCents(cells: readonly string[], layout: BankCsvLayout): number | null {
  if (layout.amount !== null) return sum(cells[layout.amount] ?? "");
  // one of the two holds the sum, the other is empty or zero; a debit is out whatever sign the bank gives it
  const [debit, credit] = [cells[layout.debit!] ?? "", cells[layout.credit!] ?? ""];
  const out = sum(debit);
  const into = sum(credit);
  // digits that are no sum make the line unread; a placeholder such as "-" or "n/a" counts as empty
  if ((out === null && /\d/.test(debit)) || (into === null && /\d/.test(credit))) return null;
  if (out && !into) return -Math.abs(out);
  if (into && !out) return Math.abs(into);
  return null;
}

/** Only an account number: an IBAN, or digits with spaces and dashes. */
const isAccount = (t: string): boolean => /^[A-Z]{2}\d{2}[A-Z0-9 ]{8,30}$/.test(t) && /\d{6}/.test(t.replace(/ /g, "")) || /^[\d\s-]{6,}$/.test(t);

/** The text of a row: the column for its direction, then the chosen one, then the others; the first that is a name. */
function rowText(cells: readonly string[], layout: BankCsvLayout, cents: number | null): string {
  const order = [cents !== null && cents > 0 ? layout.textIn : null, layout.text, ...(layout.more ?? [])];
  for (const n of order) {
    if (n === null || n === undefined) continue;
    const t = cleanStatementText(cells[n] ?? "");
    if (t && !isAccount(t)) return t;
  }
  return "";
}

/** The rows of a table under a layout. A line that does not read is told in `unread`, never dropped. */
export function readBankCsvRows(table: Pick<BankCsvTable, "delimiter" | "body">, layout: BankCsvLayout): BankCsvRead | { error: BankCsvError } {
  const rows: BankCsvRow[] = [];
  const unread: string[] = [];
  for (const cells of table.body) {
    const d = day(cells[layout.date] ?? "");
    const cents = rowCents(cells, layout);
    const text = rowText(cells, layout, cents);
    if (d && cents && text && Math.abs(cents) <= CARD_FILE_MAX_CENTS) rows.push({ day: d, cents, text });
    else unread.push(cells.join(table.delimiter));
  }
  if (!rows.length) return { error: "no_rows" };
  const days = rows.map((r) => r.day).sort();
  return { periodFrom: days[0]!, periodTo: days[days.length - 1]!, rows, unread };
}
