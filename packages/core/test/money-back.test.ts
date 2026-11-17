/**
 * The money a merchant may owe back (analysis/money-back.ts): a charge made twice and a charge after Lopetettu, found
 * by the definitions the alerts use, and each question's answer. Made-up merchants and sums; the day is 9.10.2026.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { moneyBackOf } from "../src/analysis/money-back.ts";
import { monthRange } from "../src/dates.ts";
import type { Account, Transaction, UserMark } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

const shop = { merchant: "Verkkokauppa", category: "shopping" };
const twice = (day: string, cents: number, partial: Partial<Transaction> = shop) => [tx({ ...partial, bookingDate: day, amountCents: cents }), tx({ ...partial, bookingDate: day, amountCents: cents })];
const mark = (subject: string, kind: UserMark["mark"], day: string): UserMark => ({ subject, mark: kind, markedAt: `${day}T08:30:00.000Z` });
const backOf = (txs: Transaction[], marks: UserMark[] = []) => moneyBackOf(createContext(txs, [checking], today), marks, today);

/** A gym charged on the 1st of each month from June to October. */
const gym = () => monthRange("2026-06", "2026-10").map((m) => tx({ merchant: "Elixia", category: "fitness", bookingDate: `${m}-01`, amountCents: -5900 }));

describe("a charge made twice", () => {
  it("is one question that asks for the extra charge, with the rows of both", () => {
    const rows = twice("2026-09-20", -16743);
    const [item, ...rest] = backOf(rows);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ id: `double:${rows[1]!.id}`, kind: "double", merchant: "Verkkokauppa", cents: 16743, rowIds: rows.map((r) => r.id), lastDate: "2026-09-20", subject: `alert:double:${rows[1]!.id}`, askedOn: null });
  });

  it("asks the extra charges of a charge made three times", () => {
    const rows = [...twice("2026-09-20", -3000), tx({ ...shop, bookingDate: "2026-09-20", amountCents: -3000 })];
    expect(backOf(rows).map((m) => m.cents)).toEqual([6000]);
  });

  it("near misses: under 20 euros, a merchant that does it routinely, a charge older than the window", () => {
    expect(backOf(twice("2026-09-20", -1990))).toEqual([]);
    const cinema = { merchant: "Finnkino", category: "entertainment" };
    expect(backOf([...twice("2026-07-03", -2400, cinema), ...twice("2026-08-07", -2400, cinema), ...twice("2026-09-11", -2400, cinema)])).toEqual([]);
    expect(backOf(twice("2026-05-16", -16743))).toEqual([]);
  });

  it("closes by itself when the merchant pays one of them back", () => {
    const back = tx({ ...shop, bookingDate: "2026-09-27", amountCents: 16743 });
    expect(backOf([...twice("2026-09-20", -16743), back])).toEqual([]);
  });

  it("asks the most money first", () => {
    const small = twice("2026-09-25", -2500, { merchant: "Kahvila", category: "restaurants" });
    const large = twice("2026-09-01", -9000, { merchant: "Verkkokauppa", category: "shopping" });
    expect(backOf([...small, ...large]).map((m) => [m.merchant, m.cents])).toEqual([["Verkkokauppa", 9000], ["Kahvila", 2500]]);
  });
});

describe("a charge after Lopetettu", () => {
  const cancelled = mark("merchant:Elixia", "cancelled", "2026-09-15");

  it("is one question for the charges after the mark, with what they come to", () => {
    const rows = gym();
    const [item, ...rest] = backOf(rows, [cancelled]);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ id: `cancelled:${rows[4]!.id}`, kind: "cancelled", merchant: "Elixia", cents: 5900, rowIds: [rows[4]!.id], lastDate: "2026-10-01", askedOn: null });
  });

  it("asks nothing before the mark or when the merchant paid the charge back", () => {
    expect(backOf(gym())).toEqual([]);
    const back = tx({ merchant: "Elixia", category: "fitness", bookingDate: "2026-10-05", amountCents: 5900 });
    expect(backOf([...gym(), back], [cancelled])).toEqual([]);
  });
});

describe("the answer", () => {
  const rows = twice("2026-09-20", -16743);
  const subject = `alert:double:${rows[1]!.id}`;

  it("Veloitus on oikein (dismissed) closes the question for good", () => {
    expect(backOf(rows, [mark(subject, "dismissed", "2026-09-21")])).toEqual([]);
  });

  it("Pyydän hyvityksen (in_use) waits 30 days, then asks once more with the day it was asked", () => {
    expect(backOf(rows, [mark(subject, "in_use", "2026-09-10")])).toEqual([]);
    expect(backOf(rows, [mark(subject, "in_use", "2026-09-09")])).toMatchObject([{ cents: 16743, askedOn: "2026-09-09" }]);
    expect(backOf(rows, [mark(subject, "in_use", "2026-08-01")])).toMatchObject([{ askedOn: "2026-08-01" }]);
  });

  it("the second answer (cancelled) closes it for good, and a refund that lands closes it too", () => {
    expect(backOf(rows, [mark(subject, "cancelled", "2026-10-09")])).toEqual([]);
    const back = tx({ ...shop, bookingDate: "2026-10-08", amountCents: 16743 });
    expect(backOf([...rows, back], [mark(subject, "in_use", "2026-08-01")])).toEqual([]);
  });

  it("a mark on another alert leaves it open", () => {
    expect(backOf(rows, [mark("alert:double:other", "dismissed", "2026-09-21")])).toHaveLength(1);
  });
});

describe("a plain household", () => {
  it("has no question", () => {
    expect(backOf(series("2026-08-01", 7, 10, -6500, { merchant: "Prisma", category: "groceries" }))).toEqual([]);
  });
});
