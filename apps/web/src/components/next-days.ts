// Decision: does the account cover what is due before the next pay
import { daysBetween } from "@banking/core";
import { date, dayHeading, dayMonth, money } from "../format.ts";
import type { DashboardData } from "../types.ts";
import { cardName } from "./holdings/holding-rows.ts";

export type Ahead = NonNullable<DashboardData["ahead"]>;
type Balance = NonNullable<Ahead["balance"]>;
type Row = Ahead["rows"][number];
/** A row that is a payment: it always has its sum, which a pay with no estimate has not. */
export type Payment = Row & { cents: number };
export const isPayment = (r: Row): r is Payment => r.cents !== null && r.cents < 0;

/**
 * The payday the window ends before, or null when it ends at no pay. A pay whose day has gone by and that is not late
 * yet ends none: the window runs to the next pay to wait for (`payday.next`), when one is coming.
 */
export function windowPayday({ reason, payday }: Ahead): string | null {
  if (reason !== "payday" || !payday) return null;
  return payday.expected ? (payday.next ?? null) : payday.date;
}

/**
 * The line under the heading: how far the block looks, by what the window waits for. With a payday it names the day
 * with its weekday, and that day is never one gone by. Without one it is the days from today. A pay that has not come
 * is told in a second sentence with the day it was expected: one behind its day, and one that is late. A day ends its
 * sentence with its own full stop, so the sentence adds none.
 */
export function windowLine(ahead: Ahead): string {
  const { payday, reason, from, days } = ahead;
  const until = windowPayday(ahead);
  const span = until ? `Palkkapäivään asti, ${dayHeading(until, from)}` : `Seuraavat ${days} päivää.`;
  if (reason === "payday" && payday) return payday.expected ? `${span} Palkka ei ole vielä tullut, sen piti tulla ${dayHeading(payday.expected, from)}` : span;
  if (reason === "late" && payday) return `${span} Palkka on myöhässä, sen piti tulla ${dayHeading(payday.date, from)}`;
  return `${span} Palkkapäivä ei ole tiedossa.`;
}

/** Which accounts the balance adds up, when that is not the one checking account in view. */
const COUNTS: Record<Balance["counts"], (accounts: number) => string | null> = {
  all: (accounts) => (accounts > 1 ? `${accounts} käyttötiliä` : null),
  own: () => "Omat käyttötilit, ilman yhteistä tiliä",
  part: () => "Osuutesi yhteisestä tilistä",
};

interface Figure {
  key: "balance" | "due" | "free";
  label: string;
  cents: number;
  /** The lines under the label. */
  notes: string[];
}

/**
 * The three figures: what the counted accounts hold today, what is due in the window and what is left after it. Core
 * has each of them, and none is added up here. Under the balance: which accounts it counts, and the day of a balance
 * that is older than a day. Null without a checking balance.
 */
export function figures(ahead: Ahead): Figure[] | null {
  const { balance, totals, from } = ahead;
  if (!balance) return null;
  const old = balance.balanceAt && daysBetween(balance.balanceAt.slice(0, 10), from) > 1 ? `Saldo päivältä ${date(balance.balanceAt)}` : null;
  return [
    { key: "balance", label: "Saldo", cents: balance.startCents, notes: [COUNTS[balance.counts](balance.accounts), old].filter((x): x is string => !!x) },
    { key: "due", label: "Erääntyvät maksut", cents: totals.dueCents, notes: [] },
    { key: "free", label: "Käytettävissä", cents: balance.freeCents, notes: [] },
  ];
}

/**
 * The one warning: a payment of the window is not covered. It names the day of the first payment that the balance and
 * the pay dated before it do not reach, and the most the account lacks, both as core has them. An account below zero
 * with nothing due names no payment, so it has no warning: its figures say it.
 */
export function warning(ahead: Ahead): string | null {
  const { balance } = ahead;
  if (!balance || balance.shortCents <= 0 || !balance.shortOn) return null;
  return `Tilin kate ei riitä ${dayMonth(balance.shortOn)} erääntyvään maksuun. Puuttuu ${money(balance.shortCents)}.`;
}

/**
 * What a row is, by its source: the line under its name, whether the name is a merchant of Tapahtumat (the name of a
 * card or of an account is not one), and whether the app estimates its day and sum. Every source has its entry, so a
 * new one cannot come without its words.
 */
const SOURCE: Record<Row["source"], { note: (r: Row) => string | null; merchant: boolean; estimate: (r: Row) => boolean }> = {
  // a pay is a mark on the line, not a bill: no estimate is told of it
  income: { note: () => null, merchant: true, estimate: () => false },
  recurring: { note: () => null, merchant: true, estimate: () => true },
  // the household typed the day and the sum in itself
  expected: { note: () => null, merchant: true, estimate: () => false },
  // a card's bill with no basis is the usual bill: the estimate is never left unsaid
  card: { note: (r) => (r.basis === "balance" ? "Luottokortin lasku" : "Luottokortin lasku, arvio aiemmista laskuista"), merchant: false, estimate: (r) => r.basis !== "balance" },
  transfer: { note: () => "Oma siirto", merchant: false, estimate: () => true },
};

/** A row whose day and sum the app estimates from the bank's rows, against one the household typed in or the card owes today. */
export const isEstimate = (r: Row): boolean => SOURCE[r.source].estimate(r);

/** A row of one of the two tables. */
interface Line {
  /** "15.10." */
  day: string;
  name: string;
  /** The line under the name, or null. */
  note: string | null;
  /** The merchant Tapahtumat lists the row's payments by, or null. */
  merchant: string | null;
  /** Positive, whichever way the money goes: the table says which. Null: a pay with no estimate. */
  cents: number | null;
  /** The app estimates its day and sum: the row carries a ring where a given one carries a disc. */
  estimate: boolean;
  /** The bill is paid and the bank has not booked the payment yet: the name carries the word Tapahtumat gives such a row. */
  pending?: boolean;
  /** A pay's sum as the table prints it ("noin 2 480 €", "2 100–2 900 €"), null when the pay has none; a bill's is its cents. */
  sum?: string | null;
}

/** What a row is called: a card is called as Varallisuus calls it, without the type the bank adds in brackets. */
export const rowName = (r: Row): string => (r.source === "card" ? cardName(r.name) : r.name);

const lineOf = (r: Payment): Line => ({ day: dayMonth(r.date), name: rowName(r), note: SOURCE[r.source].note(r), merchant: SOURCE[r.source].merchant ? r.name : null, cents: Math.abs(r.cents), estimate: isEstimate(r), ...(r.pending ? { pending: true } : {}) });

/** The rows of the payments' table, in core's order: by day, the larger of a day first. */
export const paymentRows = (ahead: Ahead): Payment[] => ahead.rows.filter(isPayment);

/** The payments of the window as table lines. */
export const payments = (ahead: Ahead): Line[] => paymentRows(ahead).map(lineOf);

type Pay = NonNullable<Row["pay"]>;

/** What is to arrive, as the table lists it. */
interface Arrival {
  date: string;
  name: string;
  /** The estimate of the pay, null when too few pays came to say a sum. */
  pay: Pay | null;
}

/**
 * What is to arrive: other pay that lands in the window, and as the last row the pay the window waits for, on the day
 * it was expected. A late pay is told under the heading and is no row.
 */
export function arrivals(ahead: Ahead): Arrival[] {
  const { payday, reason } = ahead;
  const list = ahead.rows.filter((r) => r.source === "income").map((r) => ({ date: r.date, name: r.name, pay: r.pay ?? null }));
  if (reason === "payday" && payday) list.push({ date: payday.expected ?? payday.date, name: payday.name, pay: payday.pay });
  return list;
}

/** Whole euros as a figure without the sign of the currency: 210000 -> "2 100". */
const figure = (cents: number): string => money(cents, false).replace(/[\s ]*€$/, "");

/** The range of a figure: "2 100–2 900 €". */
const range = (low: number, high: number): string => `${figure(low)}–${money(high, false)}`;

/**
 * A coming pay is never a bare sum: a steady one is "noin" its usual sum, one that varies is the range of the estimate,
 * floor to ceiling. Null without an estimate: the row has its day and no sum.
 */
export function paySum(pay: Pay | null): string | null {
  if (!pay) return null;
  return pay.kind === "steady" ? `noin ${money(pay.usualCents, false)}` : range(pay.floorCents, pay.ceilCents);
}

/**
 * The one sentence under the table of what is to arrive, when the pay the window waits for varies: the facts of the
 * pays that came, and with a base the least that has come. Null for a steady pay and for one with no estimate.
 */
export function payNote({ payday, reason }: Ahead): string | null {
  const pay = reason === "payday" ? payday?.pay : null;
  if (!pay || pay.kind !== "varies") return null;
  const facts = `Palkka vaihtelee: ${pay.count} viime palkkaa ${range(pay.lowCents, pay.highCents)}, tavallisin ${money(pay.usualCents, false)}.`;
  return pay.baseCents === undefined ? facts : `${facts} Vähintään on tullut ${money(pay.baseCents, false)}.`;
}

/** The arrivals as the lines of the second table: every one is projected from the pays that came, so every one is an estimate. */
export const incoming = (ahead: Ahead): Line[] =>
  arrivals(ahead).map((a) => ({ day: dayMonth(a.date), name: a.name, note: null, merchant: a.name, cents: a.pay?.floorCents ?? null, estimate: true, sum: paySum(a.pay) }));

/** What the table of the payments is about, for a reader of the page that has no eyes for it. */
export function paymentsCaption(ahead: Ahead): string {
  return windowPayday(ahead) ? "Erääntyvät maksut ennen palkkapäivää" : `Erääntyvät maksut seuraavan ${ahead.days} päivän aikana`;
}
