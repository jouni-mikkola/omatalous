// Decision: does the account cover what is due before the next pay
import { daysBetween } from "@banking/core";
import { date, dayHeading, dayMonth, money } from "../format.ts";
import type { DashboardData } from "../types.ts";

export type Ahead = NonNullable<DashboardData["ahead"]>;
type Balance = NonNullable<Ahead["balance"]>;
type Row = Ahead["rows"][number];

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
 * What a row is, by its source: the line under its name, and whether the name is a merchant of Tapahtumat (the name of
 * a card or of an account is not one). Every source has its entry, so a new one cannot come without its words.
 */
const SOURCE: Record<Row["source"], { note: (r: Row) => string | null; merchant: boolean }> = {
  income: { note: () => null, merchant: true },
  recurring: { note: () => null, merchant: true },
  expected: { note: () => null, merchant: true },
  // a card's bill with no basis is the usual bill: the estimate is never left unsaid
  card: { note: (r) => (r.basis === "balance" ? "Luottokortin lasku" : "Luottokortin lasku, arvio aiemmista laskuista"), merchant: false },
  transfer: { note: () => "Oma siirto", merchant: false },
};

/** A row of one of the two tables. */
interface Line {
  /** "15.10." */
  day: string;
  name: string;
  /** The line under the name, or null. */
  note: string | null;
  /** The merchant Tapahtumat lists the row's payments by, or null. */
  merchant: string | null;
  /** Positive, whichever way the money goes: the table says which. */
  cents: number;
}

const lineOf = (r: Row): Line => ({ day: dayMonth(r.date), name: r.name, note: SOURCE[r.source].note(r), merchant: SOURCE[r.source].merchant ? r.name : null, cents: Math.abs(r.cents) });

/** The payments of the window, in core's order: by day, the larger of a day first. */
export const payments = (ahead: Ahead): Line[] => ahead.rows.filter((r) => r.cents < 0).map(lineOf);

/**
 * What is to arrive: other pay that lands in the window, and as the last row the pay the window waits for, on the day
 * it was expected. A late pay is told under the heading and is no row.
 */
export function incoming(ahead: Ahead): Line[] {
  const { payday, reason } = ahead;
  const lines = ahead.rows.filter((r) => r.cents > 0).map(lineOf);
  if (reason === "payday" && payday) lines.push({ day: dayMonth(payday.expected ?? payday.date), name: payday.name, note: null, merchant: payday.name, cents: payday.cents });
  return lines;
}

/** What the table of the payments is about, for a reader of the page that has no eyes for it. */
export function paymentsCaption(ahead: Ahead): string {
  return windowPayday(ahead) ? "Erääntyvät maksut ennen palkkapäivää" : `Erääntyvät maksut seuraavan ${ahead.days} päivän aikana`;
}
