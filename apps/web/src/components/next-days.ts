// Decision: do I have enough on the account until the pay comes
import { daysBetween } from "@banking/core";
import { date, dayHeading, dayMonth, money } from "../format.ts";
import type { DashboardData } from "../types.ts";

export type Ahead = NonNullable<DashboardData["ahead"]>;

/** The days until a day in words: today, tomorrow, or a count. */
const until = (days: number): string => (days === 0 ? "tänään" : days === 1 ? "huomenna" : `${days} päivän päästä`);

interface Heading {
  title: string;
  sub: string;
}

/**
 * The heading of the card, by what the window waits for. With a payday it names the day, the weekday and the days to it.
 * Without one, or with a pay that is late, it is the 30 days from today, and a late pay says since when. The
 * day ends its sentence with its own full stop, so the sentence adds none.
 */
export function heading(ahead: Ahead): Heading {
  const { payday, reason, from, days } = ahead;
  if (reason === "payday" && payday) return { title: `Palkkapäivä ${dayHeading(payday.date, from)}`, sub: until(daysBetween(from, payday.date)) };
  const title = `Seuraavat ${days} päivää`;
  if (reason === "late" && payday) return { title, sub: `Palkka on myöhässä, sen piti tulla ${dayHeading(payday.date, from)}` };
  return { title, sub: "Palkkapäivä ei ole tiedossa." };
}

interface Figure {
  key: "bills" | "everyday" | "left";
  label: string;
  /** What the figure is made of, in a few words, or null. */
  note: string | null;
  cents: number;
}

/**
 * The figures a person decides by: the payments in the window, the usual everyday spending for its days and what is left
 * on its last day. The last needs a checking balance and a complete month, the second a complete month and a day after today.
 */
export function figures(ahead: Ahead): Figure[] {
  const { totals, balance, reason } = ahead;
  const waits = reason === "payday";
  const out: Figure[] = [{ key: "bills", label: waits ? "Maksut ennen palkkapäivää" : "Maksut", note: null, cents: totals.recurringCents + totals.typedCents }];
  if (ahead.everydayPerDayCents > 0 && ahead.days > 0) {
    out.push({ key: "everyday", label: "Ostokset ilman laskuja ja tilauksia", note: `tavallisesti ${money(ahead.everydayPerDayCents, false)} päivässä`, cents: totals.everydayCents });
  }
  if (balance) out.push({ key: "left", label: waits ? "Saldo ennen palkkapäivää" : `Saldo ${dayMonth(balance.last.date)}`, note: null, cents: balance.last.cents });
  return out;
}

/**
 * The lowest day first when it is under zero or under a day of everyday spending. The number comes first and its basis
 * after it, with no verdict word.
 */
export function warning(ahead: Ahead): string | null {
  const { balance, from, everydayPerDayCents } = ahead;
  if (!balance) return null;
  const { lowest } = balance;
  const at = `${money(lowest.cents, false)} (${dayHeading(lowest.date, from)})`;
  if (lowest.cents < 0) return `Alin saldo ${at}, tili jää miinukselle.`;
  if (lowest.cents < everydayPerDayCents) return `Alin saldo ${at}, ostoksiin menee tavallisesti ${money(everydayPerDayCents, false)} päivässä.`;
  return null;
}

interface PayLine {
  name: string;
  when: string;
  cents: number;
}

/** The pay the window waits for, the last line of the list and no row of it. A late pay is told in the heading. */
export function payLine(ahead: Ahead): PayLine | null {
  const { payday, reason, from } = ahead;
  return reason === "payday" && payday ? { name: payday.name, when: dayHeading(payday.date, from), cents: payday.cents } : null;
}

/** What the list is about, for a reader of the page that has no eyes for it. */
export function listCaption(ahead: Ahead): string {
  return ahead.reason === "payday" ? "Maksut ennen palkkapäivää" : `Maksut seuraavan ${ahead.days} päivän aikana`;
}

/** The start of the balance line, and what it leaves out. */
export function footnote(balance: NonNullable<Ahead["balance"]>): string {
  return `Lähtösaldo ${money(balance.startCents, false)}${balance.balanceAt ? `, laskettu pankin saldosta ${date(balance.balanceAt)}` : ""}. Omat siirrot eivät ole mukana.`;
}
