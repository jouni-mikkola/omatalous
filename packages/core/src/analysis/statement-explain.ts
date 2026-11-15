/**
 * Card statement rows: what a user read off a card statement and typed in to say what one card bill paid for.
 *
 * A row explains ONE bill and takes part in nothing else. The bill stays one row on the account (its amount, its
 * category, the balance walk, pairing, returns, series and income never see a statement row). Only the sums of
 * spending by category and month read the rows (`spendRows`): the bill's own `spend` falls by what the rows explain and
 * each row is spending on its own day, so the two add up to the bill to the cent. The rest of the bill stays "card
 * bill, not explained". Nothing here is stored: it is worked out again whenever the context is built, so removing
 * the rows brings the bill back whole.
 */
import { partCents } from "../account-use.ts";
import { getCategory, isKnownCategory } from "../categories.ts";
import { dayNumber, monthIndex, weekdayOf } from "../dates.ts";
import { fold, normalizeMerchant } from "../merchant.ts";
import { namesCard } from "../transfers.ts";
import type { Account, IsoDate, Part } from "../types.ts";
import type { AnalysisTx } from "./context.ts";

/** A statement may reach this many days back from the bill's booking day, and may itself be this long. */
const STATEMENT_MAX_DAYS = 62;
/** Rows of one bill. */
export const STATEMENT_MAX_ROWS = 200;
/** Characters of a row's text. */
export const STATEMENT_TEXT_MAX = 120;

const PAYMENT_WORDS: ReadonlySet<string> = new Set(["MAKSU", "KIITOS", "SUORITUS"]);

/** Whether a statement row's text is the bank's line for a payment received (the page drops these; they are no purchases). */
export function isPaymentRow(text: string): boolean {
  return fold(text).split(/[^A-Z0-9]+/).some((word) => PAYMENT_WORDS.has(word));
}
/** UTF-8 bytes of all the texts of one bill. */
export const STATEMENT_MAX_BYTES = 48 * 1024;
/** One row's sum is at most this many cents: far above a card bill, far below what a double holds exactly. */
export const STATEMENT_MAX_ROW_CENTS = 100_000_000_00;

/** One row of a statement as the reader gets it. `category` is what the user's rules say of its text. */
interface StatementRow {
  id: string;
  day: IsoDate;
  /** Positive: a purchase. Negative: a refund inside the statement. Never 0. */
  cents: number;
  text: string;
  category: string;
}

/** The rows of one bill and the period they cover. `part`: the viewer's part of the bill's account, when the view cuts by part. */
export interface StatementBill {
  billId: string;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  part?: Part;
  rows: readonly StatementRow[];
}

/** A row of a statement as spending: an entry of `AnalysisContext.explained`, never one of its `txs`. */
export interface ExplainedTx extends AnalysisTx {
  billId: string;
  rowId: string;
}

/**
 * Whether the rows of a bill are read, and if not why. `covered`, `not_card_bill` and `not_booked` are what the server
 * stores as the reason the rows are set aside (the user decides whether to keep them); `over_bill` and `period` are
 * read again on every build and set nothing aside.
 */
export type StatementState = { read: true } | { read: false; reason: "covered" | "not_card_bill" | "not_booked" | "over_bill" | "period" };

/** Whether `day` is a real calendar day (not 0000-00-00, not 2026-02-30). */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "0001-01-01") return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** What is wrong with a statement's period against its bill's booking day, or null: real days, in order, ending by the booking day, within the limits. */
export function periodProblem(from: string, to: string, bookingDate: string): "bad_day" | "order" | "after_bill" | "too_long" | "too_far_back" | null {
  if (!isRealDay(from) || !isRealDay(to)) return "bad_day";
  if (from > to) return "order";
  if (to > bookingDate) return "after_bill";
  if (dayNumber(to) - dayNumber(from) > STATEMENT_MAX_DAYS) return "too_long";
  if (dayNumber(bookingDate) - dayNumber(from) > STATEMENT_MAX_DAYS) return "too_far_back";
  return null;
}

/** The shape of a bill the rules look at: stored fields of a row. */
interface BillFacts {
  status: string;
  amountCents: number;
  category: string;
  isTransfer: boolean;
}

/** Whether a stored row is a booked card bill that statement rows may explain (the server asks before it writes; the context asks again by `isCardBill` on what it counts). */
export const isExplainableBill = (t: BillFacts, accountType: string | undefined): boolean =>
  t.status === "booked" && t.amountCents < 0 && t.category === "card_bill" && !t.isTransfer && accountType !== "credit_card" && accountType !== "loan";

const floorDiv = (a: bigint, b: bigint): bigint => (a / b) * b > a ? a / b - 1n : a / b;

/**
 * `total` cents shared over rows in proportion to their sums, to whole cents that add up to `total`: each row's floor,
 * the cents left going to the rows with the largest remainders (the earlier row first). A refund row shares a negative
 * amount. `total` equal to the sum of `cents` gives `cents` itself.
 */
function shareOut(cents: readonly number[], total: number): number[] {
  const sum = cents.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return cents.map(() => 0);
  if (total === sum) return [...cents];
  const floors = cents.map((c) => floorDiv(BigInt(c) * BigInt(total), BigInt(sum)));
  const rem = cents.map((c, i) => BigInt(c) * BigInt(total) - floors[i]! * BigInt(sum));
  let left = total - floors.reduce((a, b) => a + Number(b), 0);
  const order = cents.map((_, i) => i).sort((a, b) => (rem[a]! === rem[b]! ? a - b : rem[a]! > rem[b]! ? -1 : 1));
  const out = floors.map(Number);
  for (const i of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

/** The category a row counts in: one of the user's expense categories, else `other`. */
function expenseCategory(id: string): string {
  const c = getCategory(id);
  return isKnownCategory(id) && c.kind === "expense" && id !== "card_bill" ? id : "other";
}

/** The rows' categories: a refund takes the category of the latest earlier purchase of the same merchant in the statement, else its own. */
function categoriesOf(rows: readonly StatementRow[]): string[] {
  const merchantOf = (r: StatementRow) => fold(normalizeMerchant(null, r.text));
  const out: string[] = [];
  rows.forEach((r, i) => {
    let found: string | undefined;
    if (r.cents < 0) for (let j = i - 1; j >= 0 && found === undefined; j--) if (rows[j]!.cents > 0 && merchantOf(rows[j]!) === merchantOf(r)) found = out[j];
    out.push(found ?? expenseCategory(r.category));
  });
  return out;
}

/** A row as an entry of spending on its own day. Its flows are its spending only: it moves no cash, the bill did. */
function entryOf(bill: AnalysisTx, row: StatementRow, cents: number, category: string): ExplainedTx {
  const c = getCategory(category);
  const { wholeCents: _whole, openCents: _open, ...base } = bill;
  return {
    ...base,
    id: `statement:${row.id}`,
    bookingDate: row.day,
    amountCents: -cents,
    counterparty: row.text,
    counterpartyIban: null,
    description: row.text,
    mcc: null,
    merchant: normalizeMerchant(null, row.text),
    category,
    categorySource: "rule",
    isTransfer: false,
    day: dayNumber(row.day),
    month: monthIndex(row.day),
    weekday: weekdayOf(row.day),
    kind: c.kind,
    group: c.group,
    flows: { consumption: cents, debt: 0, saved: 0, income: 0, borrowed: 0 },
    spend: cents,
    refunded: 0,
    billId: bill.id,
    rowId: row.id,
  };
}

/**
 * Whether the bank itself reports the purchases of a statement: the booked rows of the card accounts in `cards` span the
 * period, the first on or before its last day and the last on or after its first. A card whose rows stop before the
 * period (a consent that lapsed) or start after it leaves the statement's rows to be read.
 */
function bankSpans(txs: readonly AnalysisTx[], cards: ReadonlySet<string>, from: IsoDate, to: IsoDate): boolean {
  let first: IsoDate | undefined;
  let last: IsoDate | undefined;
  for (const t of txs) {
    if (!cards.has(t.accountId) || t.status !== "booked") continue;
    if (first === undefined || t.bookingDate < first) first = t.bookingDate;
    if (last === undefined || t.bookingDate > last) last = t.bookingDate;
  }
  return first !== undefined && last !== undefined && first <= to && last >= from;
}

/**
 * The place of a member's cents in a bill when no part says it: the larger share first and the smaller after it, so that
 * two members cut the same way share the bill's cents between them to the cent. Three members, or an even split, may
 * still differ by a cent in how the bill's explained sum and its rest are divided; the bill's own figure always adds up.
 */
function laidOut(mine: number, whole: number): Part {
  const others = whole - mine;
  const from = mine > others ? 0 : others;
  return { from, to: from + mine, of: whole };
}

/** Whether `bill` is a card bill that counts as spending now: a booked payment out in the card-bill category. */
const countsAsCardBill = (t: AnalysisTx): boolean => t.category === "card_bill" && t.spend > 0 && t.status === "booked" && t.amountCents < 0;

/**
 * Reads the statements of a context's rows: for each bill whose rows are read, what they leave of its `spend`
 * unexplained (`lowered`, by the bill's id: `txs` keeps the bill whole, so a reader that does not know of statements
 * counts it as it always did), and the rows as spending entries. Called once, after `moneyIn` and the series were worked out, so
 * a row is in no series and no return; the entries are in no list the walk of balances, the income or pairing reads.
 *
 * A bill's rows are read when: the row is a booked card bill now (it may have paired since, or been categorised by
 * hand), its account is not a card or a loan, the period still fits the bill, the rows add up to 0 to the bill's whole
 * amount (never trimmed to fit), and the bank does not send those purchases itself: no card account that the bill's
 * text names has booked rows that span the period (`bankSpans`). Otherwise the bill counts whole.
 *
 * A bill cut to a viewer's part: the bill's whole amount is split once, and the viewer's part of what is left comes from
 * the same cut as the bill's part itself; the rest of the bill's part is the viewer's explained sum, spread over the
 * rows by largest remainder. The viewers' figures add up to the bill's.
 */
export function explainStatements(txs: readonly AnalysisTx[], accounts: readonly Account[], statements: readonly StatementBill[]): { entries: ExplainedTx[]; states: Map<string, StatementState>; lowered: Map<string, number> } {
  const entries: ExplainedTx[] = [];
  const states = new Map<string, StatementState>();
  const lowered = new Map<string, number>();
  if (!statements.length) return { entries, states, lowered };
  const byId = new Map(txs.map((t) => [t.id, t]));
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const cards = accounts.filter((a) => a.type === "credit_card");
  for (const st of statements) {
    const bill = byId.get(st.billId);
    if (!bill) continue;
    const no = (reason: Extract<StatementState, { read: false }>["reason"]) => states.set(st.billId, { read: false, reason });
    if (bill.status !== "booked") { no("not_booked"); continue; }
    if (!countsAsCardBill(bill) || !isExplainableBill(bill, typeOf.get(bill.accountId))) { no("not_card_bill"); continue; }
    if (periodProblem(st.periodFrom, st.periodTo, bill.bookingDate) !== null) { no("period"); continue; }
    const text = [bill.merchant, bill.counterparty, bill.description].filter(Boolean).join(" ");
    const named = new Set(cards.filter((a) => namesCard(text, a)).map((a) => a.id));
    if (bankSpans(txs, named, st.periodFrom, st.periodTo)) { no("covered"); continue; }

    const rows = st.rows.filter((r) => r.day >= st.periodFrom && r.day <= st.periodTo).sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? -1 : 1));
    const explained = rows.reduce((sum, r) => sum + r.cents, 0);
    const whole = Math.abs(bill.wholeCents ?? bill.amountCents);
    if (rows.length !== st.rows.length) { no("period"); continue; }
    if (explained < 0 || explained > whole) { no("over_bill"); continue; }

    // the viewer's cut of the bill: its own cents `mine` of `whole`
    const mine = Math.abs(bill.amountCents);
    let rest = whole - explained;
    if (bill.wholeCents !== undefined) {
      const part = st.part && partCents(whole, st.part) === mine ? st.part : laidOut(mine, whole);
      rest = explained === 0 ? mine : Math.min(mine, partCents(whole - explained, part));
    }
    states.set(st.billId, { read: true });
    const explainedMine = mine - rest;
    lowered.set(st.billId, rest);
    const cats = categoriesOf(rows);
    const shares = bill.wholeCents === undefined ? rows.map((r) => r.cents) : shareOut(rows.map((r) => r.cents), explainedMine);
    rows.forEach((r, i) => {
      if (shares[i]) entries.push(entryOf(bill, r, shares[i]!, cats[i]!));
    });
  }
  return { entries: entries.sort((a, b) => a.day - b.day), states, lowered };
}
