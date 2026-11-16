/**
 * The cut of a series that what is ahead reads (`standingCut`): the share of its recent rows the viewer paid, and no
 * guessed half where the trace says nothing (ADR 0017). Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { applyUse, partOf } from "../src/account-use.ts";
import type { PaidOf } from "../src/money-trace-answers.ts";
import { standingCut } from "../src/standing-cut.ts";
import type { Account, AccountUse, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const POOL: Account = { id: "pool", name: "pool", holder: "A, B", iban: null, currency: "EUR", type: "checking" };
const DAYS = ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12"];
const BILL = -84364;

/** The pool's rows as `applyUse` hands them to a viewer who has half of it by the weights of an account cut by who paid. */
function halves(extra: Partial<Transaction> = {}): readonly Transaction[] {
  const use: AccountUse = { users: [{ userId: "u-1", label: "A", weight: 1 }, { userId: "u-2", label: "B", weight: 1 }], source: "bank", split: "unknown", mode: "source" };
  const rows = DAYS.map((bookingDate) => tx({ accountId: "pool", bookingDate, amountCents: BILL, merchant: "Lainat", ...extra }));
  return applyUse(rows, [POOL], new Map([["pool", partOf(use, "u-1")]]));
}
const paid = (rows: readonly Transaction[], own: number, whole = 84364): Map<string, PaidOf> => new Map(rows.map((t) => [t.id, { own, known: whole, whole }]));

describe("a joint account cut by who paid", () => {
  it("the viewer paid it all: every row is the bank's whole amount", () => {
    const rows = halves();
    expect(rows[0]!.amountCents).toBe(-42182);
    const cut = standingCut(rows, new Set(["pool"]), paid(rows, 84364));
    expect(cut.map((t) => t.amountCents)).toEqual(DAYS.map(() => BILL));
    expect(cut.every((t) => t.wholeCents === undefined)).toBe(true);
  });

  it("the partner paid half of it: the viewer's half of every row", () => {
    const rows = halves();
    const cut = standingCut(rows, new Set(["pool"]), paid(rows, 42182));
    expect(cut.map((t) => [t.amountCents, t.wholeCents])).toEqual(DAYS.map(() => [-42182, BILL]));
  });

  it("the partner paid it all: the viewer has no row of the series", () => {
    const rows = halves();
    expect(standingCut(rows, new Set(["pool"]), paid(rows, 0))).toEqual([]);
  });

  it("no evidence and no split said: the bank's whole amount, never an assumed half", () => {
    const rows = halves();
    const cut = standingCut(rows, new Set(["pool"]), new Map());
    expect(cut.map((t) => t.amountCents)).toEqual(DAYS.map(() => BILL));
    expect(cut.every((t) => t.wholeCents === undefined)).toBe(true);
  });

  it("no evidence where the weights were said: the weights cut it as they did", () => {
    const rows = halves();
    expect(standingCut(rows, new Set(), new Map()).map((t) => t.amountCents)).toEqual(rows.map((t) => t.amountCents));
  });

  it("rows the trace does not tell whole give no evidence", () => {
    const rows = halves();
    const open = new Map(rows.map((t) => [t.id, { own: 0, known: 0, whole: 84364 }]));
    expect(standingCut(rows, new Set(["pool"]), open).map((t) => t.amountCents)).toEqual(DAYS.map(() => BILL));
  });

  it("only the latest rows tell who pays: a payer of long ago does not count", () => {
    const rows = halves();
    const evidence = paid(rows, 84364);
    evidence.set(rows[0]!.id, { own: 0, known: 84364, whole: 84364 });
    expect(standingCut(rows, new Set(["pool"]), evidence).map((t) => t.amountCents)).toEqual(DAYS.map(() => BILL));
  });

  it("one part for the series: the past rows and the coming ones are cut the same", () => {
    const rows = halves();
    const evidence = new Map(rows.map((t, i) => [t.id, { own: i % 2 ? 84364 : 0, known: 84364, whole: 84364 }]));
    const cut = standingCut(rows, new Set(["pool"]), evidence);
    expect(new Set(cut.map((t) => t.amountCents)).size).toBe(1);
  });

  it("each series has its own part", () => {
    const rows = [...halves(), ...halves({ merchant: "Sahko" })];
    const evidence = new Map(rows.filter((t) => t.merchant === "Lainat").map((t) => [t.id, { own: 84364, known: 84364, whole: 84364 }]));
    const cut = standingCut(rows, new Set(["pool"]), evidence);
    // the series with no evidence on an account nobody split counts the bank's amount too
    expect(cut.filter((t) => t.merchant === "Lainat").every((t) => t.amountCents === BILL)).toBe(true);
    expect(cut.filter((t) => t.merchant === "Sahko").every((t) => t.amountCents === BILL)).toBe(true);
  });
});
