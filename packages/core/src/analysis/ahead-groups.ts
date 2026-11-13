/**
 * Decision: which of the bills ahead the household sees under which sum, and which month the first page opens on.
 *
 * What the first page and the bills page read of the window (`ahead.ts`) once the server has built it. A file of its own
 * so that the browser does not load the window's whole build (`cashAhead` and the analyses it reads) for them.
 */
import type { AheadData, AheadRow } from "./ahead.ts";

/** A group of `upcoming` as Laskut lists it, with the group's one sum. */
interface AheadGroup {
  /**
   * "window": paid to the window's last day; "after": paid after the pay that ends the window, a bill paid from the pay
   * on its own day (`withPay`) too; "days": the 30 days, when no pay ends the window; "card": charged to a credit card,
   * which leaves no account. The first group of a pay stays without rows too, the others only with rows.
   */
  key: "window" | "after" | "days" | "card";
  /** Indexes into `upcoming`, in its order: the rows that pay a known sum. */
  rows: number[];
  /** What the rows pay, in positive cents. */
  cents: number;
}

/**
 * The month Yhteenveto opens on: the running one once its pay has come, else the last complete one, so the page does
 * not open on a month that holds the bills but not yet the pay ("Tulos" deep below zero before payday). The pay is the
 * one the window waits for (`payday`): when it is due this month, or is behind its day this month, it has not come. A
 * household with no regular pay opens on the running month.
 */
export function openingMonth({ from, payday }: Pick<AheadData, "from" | "payday">): "month" | "last-month" {
  if (!payday) return "month";
  const month = from.slice(0, 7);
  return (payday.expected ?? payday.date).slice(0, 7) === month ? "last-month" : "month";
}

/**
 * `upcoming` in Laskut's groups, each with its sum (GET /api/ahead sends them with the window): the page lists and sums
 * none itself. A pay ends the window when one is to wait for, or when the pay behind its day has a next one to come.
 */
export function upcomingGroups({ upcoming, to, reason, payday }: Pick<AheadData, "upcoming" | "to" | "reason" | "payday">): AheadGroup[] {
  const untilPay = reason === "payday" && payday !== null && (!payday.expected || payday.next !== undefined);
  const paid = upcoming.flatMap((r, i) => (r.cents !== null && r.cents < 0 ? [i] : []));
  const group = (key: AheadGroup["key"], rows: number[]): AheadGroup => ({ key, rows, cents: rows.reduce((sum, i) => sum - upcoming[i]!.cents!, 0) });
  const own = paid.filter((i) => !upcoming[i]!.onCard);
  const card = paid.filter((i) => upcoming[i]!.onCard);
  const inWindow = (i: number) => upcoming[i]!.date <= to && !upcoming[i]!.withPay;
  const after = own.filter((i) => !inWindow(i));
  const groups = !untilPay ? [group("days", own)] : after.length ? [group("window", own.filter(inWindow)), group("after", after)] : [group("window", own)];
  return card.length ? [...groups, group("card", card)] : groups;
}

/** What accounts the balance leaves out pay in the 30 days: the rows marked `outside`, in no figure of the window. */
export function upcomingElsewhereCents(upcoming: readonly AheadRow[]): number {
  return upcoming.reduce((sum, r) => (r.outside && r.cents !== null && r.cents < 0 ? sum - r.cents : sum), 0);
}
