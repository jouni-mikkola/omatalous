import type { RawTransaction } from "@banking/core";

/**
 * Parses transaction exports from Nordea Finland's netbank (and most other
 * Finnish banks' CSV/TXT exports): semicolon, tab or comma separated, Finnish,
 * Swedish or English headers, "1 234,56" amounts, YYYY/MM/DD or DD.MM.YYYY dates.
 */

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["kirjauspäivä", "kirjauspaiva", "booking date", "bokföringsdag", "bokforingsdag", "päivämäärä", "date", "maksupäivä"],
  amount: ["määrä", "maara", "amount", "belopp", "summa", "määrä eur", "määrä euroa"],
  name: ["nimi", "name", "namn", "saaja/maksaja", "maksaja/saaja", "saajan nimi", "recipient/payer"],
  title: ["otsikko", "title", "rubrik", "selite", "tapahtuma", "transaction"],
  message: ["viesti", "message", "meddelande"],
  reference: ["viitenumero", "viite", "reference number", "reference", "referensnummer"],
  currency: ["valuutta", "currency", "valuta"],
  payer: ["maksaja", "sender", "avsändare", "avsandare"],
  payee: ["maksunsaaja", "recipient", "mottagare"],
  account: ["tilinumero", "saajan tilinumero", "account number"],
};

export interface CsvParseResult {
  transactions: RawTransaction[];
  errors: string[];
  /**
   * The exported account's own IBAN, when the file names it: the most
   * common payer on money out and payee on money in. Lets transfers to and
   * from another imported account pair up.
   */
  ownIban: string | null;
}

/** How far into a file the header row is looked for: some exports start with an account or period line. */
const HEADER_SEARCH_LINES = 15;
const HEAD_CHARS = 32_000;

/** A cell in a message to the user: never the whole of a huge cell. */
const shown = (s: string | undefined) => ((s ?? "").length > 40 ? `${(s ?? "").slice(0, 40)}…` : (s ?? ""));

const aliasIndex = (header: readonly string[], key: string) => header.findIndex((h) => HEADER_ALIASES[key]!.includes(h));
const isHeader = (row: readonly string[]) => {
  const h = row.map((c) => c.trim().toLowerCase());
  return aliasIndex(h, "date") >= 0 && aliasIndex(h, "amount") >= 0;
};

/**
 * Finds the delimiter and the header row from the start of the file. Each delimiter is tried, the most frequent
 * first, so blank lines or a line of text before the header cannot make the choice.
 */
function findHeader(text: string): string | null {
  const head = text.slice(0, HEAD_CHARS);
  const delimiters = [";", "\t", ","].map((d) => [d, head.split(d).length - 1] as const).sort((a, b) => b[1] - a[1]);
  for (const [delimiter] of delimiters) {
    if (parseDelimited(head, delimiter, HEADER_SEARCH_LINES, false).some(isHeader)) return delimiter;
  }
  return null;
}

/** A bank export of several years has a few thousand rows and about twenty columns. */
export const CSV_MAX_ROWS = 100_000;
export const CSV_MAX_COLUMNS = 50;
/** Row errors collected; the rest are only counted. */
const MAX_ERRORS = 50;

/** The file is bigger than any bank export; thrown by the parser and turned into a message by parseBankCsv. */
export class CsvTooLarge extends Error {}

/** RFC 4180-ish: quoted fields may contain the delimiter, newlines and "" escapes. */
export function parseDelimited(text: string, delimiter: string, stopAfter = Number.POSITIVE_INFINITY, enforceLimits = true): string[][] {
  return parseDelimitedWithLines(text, delimiter, stopAfter, enforceLimits).rows;
}

/** The same, with the line of the file (from 1) each kept row started on, for messages that name a row. */
export function parseDelimitedWithLines(text: string, delimiter: string, stopAfter = Number.POSITIVE_INFINITY, enforceLimits = true): { rows: string[][]; lines: number[] } {
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(field);
    if (enforceLimits && row.length > CSV_MAX_COLUMNS) throw new CsvTooLarge(`Tiedostossa on yli ${CSV_MAX_COLUMNS} saraketta. Se ei ole pankin tilioteviedosto.`);
    if (row.some((f) => f.trim())) {
      if (enforceLimits && rows.length >= CSV_MAX_ROWS) throw new CsvTooLarge(`Tiedostossa on yli ${CSV_MAX_ROWS} riviä. Tuo tapahtumat pienemmissä osissa.`);
      rows.push(row);
      lines.push(rowLine);
    }
    row = [];
    field = "";
    rowLine = line;
  };
  for (let i = 0; i < text.length && rows.length < stopAfter; i++) {
    const ch = text[i]!;
    if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      // checked while reading, not only at the end of the row: one endless row must not fill the memory
      if (enforceLimits && row.length > CSV_MAX_COLUMNS) throw new CsvTooLarge(`Tiedostossa on yli ${CSV_MAX_COLUMNS} saraketta. Se ei ole pankin tilioteviedosto.`);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
        line++;
      }
      endRow();
    } else {
      field += ch;
    }
  }
  if (rows.length < stopAfter) endRow();
  return { rows, lines };
}

/**
 * "-1 234,56", "-1.234,56", "-1,234.56", "1234.5", "12,50-" and "(12,50)" → cents. The separator
 * that comes last is the decimal one; a single separator before exactly three digits
 * ("1,234") is a thousands separator when the digits before it are a valid first group.
 * Anything that does not fit in a safe integer of cents is not a number here.
 */
export function parseAmount(s: string): number | null {
  let t = s.replace(/[\s'€\u00a0\u202f]/g, "").replace(/^\+/, "").replace(/^\u2212/, "-");
  // some systems write a negative as "12,50-" or "(12,50)"
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  else if (/^[^-].*-$/.test(t)) t = `-${t.slice(0, -1)}`;
  if (!t) return null;
  const last = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (last >= 0) {
    const fraction = t.slice(last + 1);
    const separators = t.match(/[.,]/g)!.length;
    const grouped = separators === 1 && fraction.length === 3 && /^-?[1-9]\d{0,2}$/.test(t.slice(0, last));
    t = grouped ? t.replace(/[.,]/, "") : `${t.slice(0, last).replace(/[.,]/g, "")}.${fraction}`;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "2026-09-30", "2026.9.30" or "30.9.2026" → "2026-09-30"; only real calendar dates. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let y = 0;
  let mo = 0;
  let d = 0;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1990 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const looksLikeIban = (s: string | undefined) => !!s && /^[A-Z]{2}\d{2}[A-Z0-9 ]{8,}$/.test(s.trim());
const compactIban = (s: string) => s.replace(/\s+/g, "");

export function parseBankCsv(text: string): CsvParseResult {
  try {
    return parseBankCsvUnchecked(text);
  } catch (err) {
    if (err instanceof CsvTooLarge) return { transactions: [], errors: [err.message], ownIban: null };
    throw err;
  }
}

function parseBankCsvUnchecked(text: string): CsvParseResult {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = findHeader(clean);
  if (delimiter === null) {
    // a file opened with the wrong character set has its umlauts replaced, and then no header matches
    const garbled = clean.slice(0, 2000).includes("\uFFFD");
    return {
      transactions: [],
      errors: [
        garbled
          ? "Tiedoston merkistö ei näytä oikealta (ä ja ö ovat korvautuneet). Tallenna tiedosto uudelleen UTF-8- tai Windows-1252-merkistöllä."
          : `Päivämäärä- tai summasaraketta ei tunnistettu. Otsikot: ${shown(clean.split(/\r\n|\n|\r/).find((l) => l.trim()) ?? "")}`,
      ],
      ownIban: null,
    };
  }
  const { rows: all, lines } = parseDelimitedWithLines(clean, delimiter);
  const at = all.findIndex(isHeader);
  const rows = all.slice(at);
  const errors: string[] = [];
  let moreErrors = 0;
  const addError = (message: string) => (errors.length < MAX_ERRORS ? errors.push(message) : moreErrors++);
  if (rows.length < 2) return { transactions: [], errors: ["Tiedostossa ei ole tapahtumarivejä."], ownIban: null };

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(Object.keys(HEADER_ALIASES).map((k) => [k, aliasIndex(header, k)])) as Record<string, number>;
  const get = (row: string[], key: string) => (idx[key]! >= 0 ? row[idx[key]!]?.trim() || undefined : undefined);

  const transactions: RawTransaction[] = [];
  const ownIbans = new Map<string, number>();
  const foreign = new Map<string, number>();
  rows.slice(1).forEach((row, i) => {
    // the line of the file, so the user finds the row in a spreadsheet
    const where = `Rivi ${lines[at + 1 + i]}`;
    const dateText = get(row, "date") ?? "";
    const date = parseDate(dateText);
    const amount = parseAmount(get(row, "amount") ?? "");
    if (!date) {
      // reserved card payments are exported with "Varaus" instead of a date
      if (!/varaus|reserv/i.test(dateText)) addError(`${where}: tuntematon päivämäärä "${shown(dateText)}"`);
      return;
    }
    if (amount === null) {
      addError(`${where}: tuntematon summa "${shown(get(row, "amount"))}"`);
      return;
    }
    // the app counts in euros: another currency's amount would be added to them as if it were euros
    const currency = (get(row, "currency") ?? "EUR").toUpperCase();
    if (currency !== "EUR") {
      foreign.set(currency, (foreign.get(currency) ?? 0) + 1);
      return;
    }
    const counterpartyAccount = amount < 0 ? (get(row, "payee") ?? get(row, "account")) : (get(row, "payer") ?? get(row, "account"));
    const ownAccount = amount < 0 ? get(row, "payer") : get(row, "payee");
    if (looksLikeIban(ownAccount)) {
      const iban = compactIban(ownAccount!);
      ownIbans.set(iban, (ownIbans.get(iban) ?? 0) + 1);
    }
    const description = [get(row, "title"), get(row, "message")].filter(Boolean).join(" ");
    transactions.push({
      externalId: null,
      bookingDate: date,
      valueDate: null,
      amountCents: amount,
      currency,
      status: "booked",
      counterparty: get(row, "name") ?? null,
      counterpartyIban: looksLikeIban(counterpartyAccount) ? compactIban(counterpartyAccount!) : null,
      description: description || null,
      reference: get(row, "reference") ?? null,
      mcc: null,
    });
  });
  if (moreErrors) errors.push(`Lisäksi ${moreErrors} riviä, joissa on virhe.`);
  const skipped = [...foreign.values()].reduce((a, b) => a + b, 0);
  if (skipped) errors.unshift(`Ohitettu ${skipped === 1 ? "1 rivi" : `${skipped} riviä`}, joiden valuutta ei ole EUR (${[...foreign.keys()].join(", ")}).`);
  // first seen wins a tie (Map keeps insertion order)
  let ownIban: string | null = null;
  for (const [iban, n] of ownIbans) if (ownIban === null || n > ownIbans.get(ownIban)!) ownIban = iban;
  return { transactions, errors, ownIban };
}
