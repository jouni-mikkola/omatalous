/**
 * What a kit household and its events are built from: Nordea accounts and rows as `ingestTransactions` stores them
 * (the merchant from the counterparty and the text, a default category that enrichment replaces).
 */
import { addMonths, daysInMonth, monthOf, weekdayOf } from "../../src/dates.ts";
import { normalizeMerchant } from "../../src/merchant.ts";
import type { Account, IsoDate, Transaction } from "../../src/types.ts";

export const IBAN = { chk: "FI2112345600000785", sav: "FI1410093000123458", loan: "FI5512345600000123" } as const;

export const ACCOUNTS: readonly Account[] = [
  { id: "chk", name: "Käyttötili", iban: IBAN.chk, currency: "EUR", type: "checking" },
  { id: "sav", name: "Säästötili", iban: IBAN.sav, currency: "EUR", type: "savings" },
  { id: "card", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" },
  { id: "loan", name: "Asuntolaina", iban: IBAN.loan, currency: "EUR", type: "loan" },
];

/** A row as the bank gives it; `account` defaults to the checking account. */
export interface RowSpec {
  date: IsoDate;
  cents: number;
  counterparty?: string | null;
  description?: string | null;
  iban?: string | null;
  mcc?: string | null;
  account?: string;
}

/** Where a household's rows go: the judging day, the months of its history and a row maker with its own id prefix. */
export interface Frame {
  today: IsoDate;
  /** Every month from the first of the history to today's, oldest first. */
  months: readonly string[];
  /** `months` without today's, which is not complete. */
  complete: readonly string[];
  /** The day of `month` (clamped to its length). */
  on: (month: string, day: number) => IsoDate;
  /** The month `n` months before today's. */
  ago: (n: number) => string;
}

export function frameOf(today: IsoDate, history: number): Frame {
  const last = monthOf(today);
  const months = Array.from({ length: history + 1 }, (_, i) => addMonths(last, i - history));
  return {
    today,
    months,
    complete: months.slice(0, -1),
    on: (month, day) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`,
    ago: (n) => addMonths(last, -n),
  };
}

/** The banking day on or before `date`: pay that falls on a weekend comes on the Friday before. */
export function banking(date: IsoDate, step: (d: IsoDate, n: number) => IsoDate): IsoDate {
  let d = date;
  while (weekdayOf(d) > 4) d = step(d, -1);
  return d;
}

/**
 * Something that happens to a household. `add` makes its rows with `rows(id, f.today)`; card rows land on the next
 * Gold bill. `drop` takes base rows away (the old rent after a move, a card that stopped syncing) after the bills are
 * made, so the checking leg of a bill stays when the card's rows are gone. The event's own rows are never dropped.
 */
export interface LifeEvent {
  id: string;
  add: (f: Frame) => Transaction[];
  drop?: (t: Transaction, f: Frame) => boolean;
  /** A base row as the event leaves it: moved to another account, say. The row itself when nothing changes. */
  move?: (t: Transaction, f: Frame) => Transaction;
  /**
   * `<source> <statement id>` patterns of what the event may make the product say, each with its reason in a comment:
   * what really happened. Usually none. Never one for a statement the review would call false: that goes to known.ts.
   */
  allows: readonly RegExp[];
}

/** A maker of rows with ids `<prefix>-00001`…; rows dated after `today` are not made. */
export function rows(prefix: string, today: IsoDate) {
  const out: Transaction[] = [];
  const add = (r: RowSpec): void => {
    if (r.date > today) return;
    out.push({
      id: `${prefix}-${String(out.length).padStart(5, "0")}`,
      accountId: r.account ?? "chk",
      bookingDate: r.date,
      amountCents: r.cents,
      currency: "EUR",
      status: "booked",
      counterparty: r.counterparty ?? null,
      counterpartyIban: r.iban ?? null,
      description: r.description ?? null,
      mcc: r.mcc ?? null,
      merchant: normalizeMerchant(r.counterparty ?? null, r.description ?? null),
      category: r.cents >= 0 ? "income" : "other",
      categorySource: "default",
      isTransfer: false,
    });
  };
  return { out, add };
}
