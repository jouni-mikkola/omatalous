/**
 * The cut of a series that what is ahead reads (`standingCut`): the viewer's past cents over its recent rows, counted as
 * `shareOf` counts a row, and the weights where the trace says nothing (ADR 0017). Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { applyUse, partOf } from "../src/account-use.ts";
import type { RowParts, SourcePart } from "../src/money-trace.ts";
import { type PaidOf, paidRows } from "../src/money-trace-answers.ts";
import { uncutRow } from "../src/shared.ts";
import { standingCut } from "../src/standing-cut.ts";
import type { Account, AccountUse, Part, Transaction } from "../src/types.ts";
import { standingSum } from "./kit/invariants.ts";
import { tx } from "./helpers.ts";

const POOL: Account = { id: "pool", name: "pool", holder: "A, B", iban: null, currency: "EUR", type: "checking" };
const DAYS = ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12"];
const BILL = -84364;

/** The pool's rows as `applyUse` hands them to a viewer who has half of it by the weights of an account cut by who paid. */
const HALF: Part = { from: 0, to: 1, of: 2 };
function halves(extra: Partial<Transaction> = {}): readonly Transaction[] {
  const use: AccountUse = { users: [{ userId: "u-1", label: "A", weight: 1 }, { userId: "u-2", label: "B", weight: 1 }], source: "bank", split: "unknown", mode: "source" };
  const rows = DAYS.map((bookingDate) => tx({ accountId: "pool", bookingDate, amountCents: BILL, merchant: "Lainat", ...extra }));
  return applyUse(rows, [POOL], new Map([["pool", partOf(use, "u-1")]]));
}
const parts = new Map([["pool", HALF]]);
/** What the trace says of every row: the viewer paid `own` of the `known` that users paid, of the `whole`. */
const told = (rows: readonly Transaction[], own: number, known = 84364, whole = 84364, before = 0): Map<string, PaidOf> => new Map(rows.map((t) => [t.id, { own, known, whole, before }]));

describe("a joint account cut by who paid", () => {
  it("the viewer paid it all: every row is the bank's whole amount", () => {
    const rows = halves();
    expect(rows[0]!.amountCents).toBe(-42182);
    const cut = standingCut(rows, parts, told(rows, 84364));
    expect(cut.map((t) => t.amountCents)).toEqual(DAYS.map(() => BILL));
    expect(cut.every((t) => t.wholeCents === undefined)).toBe(true);
  });

  it("the partner paid half of it: the viewer's half of every row", () => {
    const rows = halves();
    const cut = standingCut(rows, parts, told(rows, 42182));
    expect(cut.map((t) => [t.amountCents, t.wholeCents])).toEqual(DAYS.map(() => [-42182, BILL]));
  });

  it("the partner paid it all: the viewer has no row of the series", () => {
    const rows = halves();
    expect(standingCut(rows, parts, told(rows, 0))).toEqual([]);
  });

  it("no evidence at all: the weights cut the series as they cut the past", () => {
    const rows = halves();
    const cut = standingCut(rows, parts, new Map());
    expect(cut.map((t) => [t.amountCents, t.wholeCents])).toEqual(DAYS.map(() => [-42182, BILL]));
  });

  it("rows of money nobody owns: the weights share them, not the whole amount", () => {
    const rows = halves();
    const cut = standingCut(rows, parts, told(rows, 0, 0));
    expect(cut.map((t) => [t.amountCents, t.wholeCents])).toEqual(DAYS.map(() => [-42182, BILL]));
  });

  it("rows partly told: what the viewer paid and their weighted part of the rest", () => {
    const rows = halves();
    // the viewer paid 500,00, the rest of 343,64 is nobody's and half of it is the viewer's
    const cut = standingCut(rows, parts, told(rows, 50000, 50000));
    expect(cut.map((t) => t.amountCents)).toEqual(DAYS.map(() => -(50000 + 17182)));
  });

  it("only the latest rows tell who pays: a payer of long ago does not count", () => {
    const rows = halves();
    const evidence = told(rows, 84364);
    evidence.set(rows[0]!.id, { own: 0, known: 84364, whole: 84364, before: 0 });
    expect(standingCut(rows, parts, evidence).map((t) => t.amountCents)).toEqual(DAYS.map(() => BILL));
  });

  it("one part for the series: the past rows and the coming ones are cut the same", () => {
    const rows = halves();
    const evidence = new Map(rows.map((t, i): [string, PaidOf] => [t.id, { own: i % 2 ? 84364 : 0, known: 84364, whole: 84364, before: 0 }]));
    const cut = standingCut(rows, parts, evidence);
    expect(new Set(cut.map((t) => t.amountCents))).toEqual(new Set([-42182]));
  });

  it("each series has its own part", () => {
    const rows = [...halves(), ...halves({ merchant: "Sahko" })];
    const evidence = told(rows.filter((t) => t.merchant === "Lainat"), 84364);
    const cut = standingCut(rows, parts, evidence);
    expect(cut.filter((t) => t.merchant === "Lainat").every((t) => t.amountCents === BILL)).toBe(true);
    // a series with no evidence keeps the weights
    expect(cut.filter((t) => t.merchant === "Sahko").every((t) => t.amountCents === -42182)).toBe(true);
  });
});

const A = "u:a";
const B = "u:b";
const C = "u:c";
const MEMBERS = [
  { owner: A, part: { from: 0, to: 1, of: 3 } },
  { owner: B, part: { from: 1, to: 2, of: 3 } },
  { owner: C, part: { from: 2, to: 3, of: 3 } },
] satisfies { owner: string; part: Part }[];
const TWO = [
  { owner: A, part: { from: 0, to: 1, of: 2 } },
  { owner: B, part: { from: 1, to: 2, of: 2 } },
] satisfies { owner: string; part: Part }[];

/** A traced row of the pool: the cents out and who they were, in the order of the parts. */
function traced(t: Transaction, owners: readonly [string, number][]): RowParts {
  const parts: SourcePart[] = owners.map(([owner, cents]) => ({ owner, kind: isUser(owner) ? "own" : "unknown", cents }));
  return { key: t.id, ids: [t.id], day: 0, cents: t.amountCents, what: "all", parts };
}
const isUser = (owner: string): boolean => owner.startsWith("u:");
const rowsOf = (cents: readonly number[], merchant = "Lainat"): Transaction[] => cents.map((amountCents, i) => tx({ accountId: "pool", bookingDate: DAYS[i % DAYS.length]!, amountCents, merchant }));

describe("B0: the members' standing amounts of a series add up to the bank's amount", () => {
  const sum = (name: string, rows: Transaction[], paying: (t: Transaction) => [string, number][], members = TWO) => standingSum(name, { account: POOL, rows, trace: rows.filter((t) => paying(t).length).map((t) => traced(t, paying(t))), members });

  it("one member paid it all", () => {
    expect(sum("all", rowsOf(DAYS.map(() => BILL)), (t) => [[A, -t.amountCents]])).toEqual([]);
  });

  it("each paid half", () => {
    expect(sum("halves", rowsOf(DAYS.map(() => BILL)), (t) => [[A, 42182], [B, 42182]])).toEqual([]);
  });

  it("money nobody owns, whole and in part, and rows the trace does not hold", () => {
    const rows = rowsOf(DAYS.map(() => BILL));
    expect(sum("opening", rows, () => [["o", 84364]])).toEqual([]);
    expect(sum("partly", rows, () => [[A, 50000], ["g:outside", 34364]])).toEqual([]);
    expect(sum("mixed", rows, (t) => (t.bookingDate < "2026-06-01" ? [] : [[B, 30000], ["o", 54364]]))).toEqual([]);
  });

  it("amounts that do not split evenly, for two and for three members, to the cent", () => {
    const amounts = [-1, -2, -7, -100, -101, -250, -999, -84364, -84365];
    const rows = rowsOf([...DAYS.map(() => -101), ...amounts]);
    // the recent rows are the 101 cents ones: 40 for A, 40 for B, the rest of 21 for nobody
    const paying = (t: Transaction): [string, number][] => (t.amountCents === -101 ? [[A, 40], [B, 40], ["o", 21]] : []);
    expect(sum("two", rows, paying)).toEqual([]);
    expect(sum("three", rows, (t) => (t.amountCents === -101 ? [[A, 33], [B, 33], [C, 33], ["o", 2]] : []), MEMBERS)).toEqual([]);
  });

  it("is violated by a cut that gives each member the bank's whole amount", () => {
    const rows = rowsOf(DAYS.map(() => BILL));
    const whole: typeof standingCut = (rowsIn) => rowsIn.map(uncutRow);
    const found = standingSum("whole", { account: POOL, rows, trace: rows.map((t) => traced(t, [["o", 84364]])), members: TWO }, whole);
    expect(found).toHaveLength(rows.length);
    expect(found[0]!.check).toBe("B0.standing-sum");
  });

  it("each member's evidence is read from the same trace", () => {
    const rows = rowsOf(DAYS.map(() => BILL));
    const trace = rows.map((t) => traced(t, [[A, 20000], [B, 30000], ["o", 34364]]));
    expect([...paidRows(trace, B).values()][0]).toEqual({ own: 30000, known: 50000, whole: 84364, before: 20000 });
    expect([...paidRows(trace, A).values()][0]).toEqual({ own: 20000, known: 50000, whole: 84364, before: 0 });
  });
});
