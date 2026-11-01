/**
 * A bank's camt.053 statement (ISO 20022) read into rows (ADR 0025). The browser reads the file and runs this; only the
 * rows go to the install. The statement carries its opening and closing balance, and the closing one is checked against
 * the rows: opening plus the rows must equal it to the cent, else the file is refused with the difference. The XML is read
 * by a small tokenizer, not a DOM, so core stays pure and a file with a DOCTYPE (entities) is refused unread.
 * Decision: a household reading a bank's statement file is told, before any row is stored, when the rows do not add up to the balance the bank reports.
 */
import type { IsoDate } from "./types.ts";
import { isRealDay } from "./analysis/statement-explain.ts";
import { cleanStatementText } from "./bank-csv.ts";
import { CARD_FILE_MAX_CENTS, CARD_FILE_MAX_ROWS } from "./card-file.ts";

interface Node {
  name: string;
  attrs: string;
  kids: Node[];
  text: string;
}

interface CamtRow {
  day: IsoDate;
  cents: number;
  text: string;
}

export interface BankCamtRead {
  periodFrom: IsoDate;
  periodTo: IsoDate;
  rows: CamtRow[];
  /** Entries not booked yet, each as day and text: the balances count booked entries only. */
  unread: string[];
}

export type BankCamtError =
  | { error: "not_camt" | "no_rows" | "too_many_rows" | "currency" | "accounts" | "no_balance" | "unreadable" }
  /** `difference` is the closing balance the file reports minus the one the opening balance and the rows give. */
  | { error: "mismatch"; opening: number; closing: number; expected: number; difference: number };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescape(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The element tree of an XML text, or null when it is not well formed enough or holds a DOCTYPE. Namespace prefixes are dropped. */
function tree(xml: string): Node | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const root: Node = { name: "", attrs: "", kids: [], text: "" };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[7] !== undefined) top.text += unescape(m[7]);
    else if (m[4] !== undefined && m[2]) {
      if (stack.length < 2 || top.name !== m[4]) return null;
      stack.pop();
    } else if (m[4] !== undefined) {
      const node: Node = { name: m[4], attrs: m[5] ?? "", kids: [], text: "" };
      top.kids.push(node);
      if (!m[6]) stack.push(node);
      if (stack.length > 40) return null;
    }
  }
  return stack.length === 1 ? root : null;
}

const kids = (n: Node | undefined, name: string): Node[] => n?.kids.filter((k) => k.name === name) ?? [];
const path = (n: Node | undefined, ...names: string[]): Node | undefined => names.reduce<Node | undefined>((at, name) => kids(at, name)[0], n);
const text = (n: Node | undefined, ...names: string[]): string => (path(n, ...names)?.text ?? "").trim();

/** "1234.56" to cents; ISO 20022 writes a dot and no grouping. */
function cents(s: string): number | null {
  const m = /^(\d{1,15})(?:\.(\d{1,5}))?$/.exec(s.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (/[1-9]/.test(frac.slice(2))) return null;
  const n = Number(m[1]) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
  return Number.isSafeInteger(n) ? n : null;
}

/** Signed cents of an element with `Amt` and `CdtDbtInd`: a debit is money out. A reversal entry already states the direction of its own movement. */
function signed(n: Node): { cents: number; currency: string } | null {
  const amt = path(n, "Amt");
  const abs = amt ? cents(amt.text) : null;
  const ind = text(n, "CdtDbtInd");
  if (abs === null || (ind !== "CRDT" && ind !== "DBIT")) return null;
  const currency = /Ccy\s*=\s*["']([A-Za-z]{3})["']/.exec(amt!.attrs)?.[1]?.toUpperCase() ?? "";
  return { cents: ind === "DBIT" ? -abs : abs, currency };
}

/** The day of a camt date: `<Dt>` or `<DtTm>`. */
function dayOf(n: Node | undefined): IsoDate | null {
  const s = (text(n, "Dt") || text(n, "DtTm")).slice(0, 10);
  return isRealDay(s) ? s : null;
}

function entryText(e: Node, credit: boolean): string {
  const details = kids(path(e, "NtryDtls"), "TxDtls");
  const side = credit ? "Dbtr" : "Cdtr";
  // a batch entry has one sum and several transactions: all their parties are named, none is picked
  const parties = [...new Set(details.map((d) => cleanStatementText(text(d, "RltdPties", side, "Nm") || text(d, "RltdPties", side, "Pty", "Nm"))).filter(Boolean))];
  const message = details.map((d) => kids(path(d, "RmtInf"), "Ustrd").map((u) => u.text).join(" "));
  return [parties.join(", "), message.length === 1 ? message[0] : "", text(e, "AddtlNtryInf")].find((s) => s && cleanStatementText(s)) ?? "";
}

/** The rows of a camt.053 text, with its closing balance checked, or the reason it is refused. */
export function readBankCamt(xml: string): BankCamtRead | BankCamtError {
  const doc = tree(xml.replace(/^\uFEFF/, ""));
  const statements = kids(path(doc ?? undefined, "Document", "BkToCstmrStmt"), "Stmt");
  if (!statements.length) return { error: "not_camt" };
  const accounts = new Set(statements.map((s) => text(s, "Acct", "Id", "IBAN") || text(s, "Acct", "Id", "Othr", "Id")));
  if (accounts.size > 1) return { error: "accounts" };

  const rows: CamtRow[] = [];
  const unread: string[] = [];
  for (const stmt of statements) {
    const balance = (...codes: string[]) => kids(stmt, "Bal").find((b) => codes.includes(text(b, "Tp", "CdOrPrtry", "Cd")));
    const open = balance("OPBD", "PRCD");
    const close = balance("CLBD");
    const opening = open && signed(open);
    const closing = close && signed(close);
    if (!opening || !closing) return { error: "no_balance" };
    if (opening.currency !== "EUR" || closing.currency !== "EUR") return { error: "currency" };

    let sum = 0;
    for (const e of kids(stmt, "Ntry")) {
      const status = (text(e, "Sts") || text(e, "Sts", "Cd") || "BOOK").toUpperCase();
      const amount = signed(e);
      const day = dayOf(path(e, "BookgDt")) ?? dayOf(path(e, "ValDt"));
      const label = cleanStatementText(entryText(e, amount ? amount.cents > 0 : true));
      if (status !== "BOOK") unread.push(`${day ?? ""} ${label}`.trim());
      else if (amount && amount.currency !== "EUR") return { error: "currency" };
      else if (amount && amount.cents === 0) continue;
      else if (amount && day && label && Math.abs(amount.cents) <= CARD_FILE_MAX_CENTS) {
        rows.push({ day, cents: amount.cents, text: label });
        sum += amount.cents;
      } else return { error: "unreadable" };
      if (rows.length > CARD_FILE_MAX_ROWS) return { error: "too_many_rows" };
    }
    const expected = opening.cents + sum;
    if (expected !== closing.cents) return { error: "mismatch", opening: opening.cents, closing: closing.cents, expected, difference: closing.cents - expected };
  }
  if (!rows.length) return { error: "no_rows" };
  const days = rows.map((r) => r.day).sort();
  return { periodFrom: days[0]!, periodTo: days[days.length - 1]!, rows, unread };
}
