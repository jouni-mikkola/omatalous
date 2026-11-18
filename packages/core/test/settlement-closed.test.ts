/**
 * A closed month is compared with today only on what a member said after it closed and on rows it never held (ADR 0017).
 * Made-up names and sums: Matti (u:1), Maija (u:2), the pool "Yhteinen tili".
 */
import { describe, expect, it } from "vitest";
import { dayNumber as d } from "../src/dates.ts";
import type { Owner, TraceRow } from "../src/money-trace.ts";
import { trace } from "../src/money-trace.ts";
import type { AgreementRow } from "../src/settlement-agreements.ts";
import type { Entry, SaidAnswer } from "../src/settlement-ledger.ts";
import { type ClosedMonth, type Settlement, type SettlementLine, settlement } from "../src/settlement.ts";

const MATTI = "u:1";
const MAIJA = "u:2";
const POOL = "iban-yhteinen-tili";
const ACME = "g:text:acme";
const BETA = "g:text:beta";
const EQUAL: AgreementRow = { accountKey: POOL, validFrom: "2026-01-01", kind: "equal", value: { who: [MATTI, MAIJA] } };

const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => ({ key: `${d(date)}|${cents}|${label}|00000`, ids: [label], day: d(date), cents, ...extra });
const own = (owner: Owner): Partial<TraceRow> => ({ from: { owner, kind: "own" } });

interface Setup {
  agreements?: AgreementRow[];
  answers?: SaidAnswer[];
  said?: Record<string, string>;
  split?: "unknown";
  asOf: string;
  closed?: ClosedMonth[];
}
const run = (month: string, rows: readonly TraceRow[], o: Setup): Settlement => {
  const t = trace(rows, 0, Math.min(...rows.map((r) => r.day)));
  const pool = { key: POOL, trace: t, answers: o.answers ?? [], users: [{ owner: MATTI, weight: 1 }, { owner: MAIJA, weight: 1 }], ...(o.split ? { split: o.split } : {}), ...(o.said ? { usesSaidOn: new Map(Object.entries(o.said)) } : {}) };
  return settlement(month, pool, o.agreements ?? [EQUAL], new Set([MATTI, MAIJA]), [], new Map(), o.asOf, o.closed ?? []);
};
/** September as stored on 5.1.: closed by 29.12. at the latest, 90 days after its end. */
const closedSep = (rows: readonly TraceRow[], o: Partial<Setup> = {}): ClosedMonth => {
  const s = run("2026-09", rows, { asOf: "2027-01-05", ...o });
  expect(s.status.open).toBe(false);
  return s as ClosedMonth;
};
const late = (s: Settlement): SettlementLine[] => s.lines.filter((l) => l.kind === "late_change");
const byOwner = (entries: readonly Entry[]) => Object.fromEntries(entries.map((e) => [e.owner, e.cents]));
/** What a correction pays and what it owes: the two are always equal. */
const sides = (l: SettlementLine): [number, number] => [l.paid.reduce((s, e) => s + e.cents, 0), l.owed.reduce((s, e) => s + e.cents, 0)];
const answer = (key: string, owner: Owner, saidOn: string): SaidAnswer => ({ kind: "in", key, owner, saidOn });

describe("a closed month and what was said after it", () => {
  // Acme's 100,00 paid the first purchase and Beta's the second: an answer on one group reads only its purchase
  const acme = row("acme", "2026-09-01", 10000, { group: ACME });
  const shop1 = row("shop1", "2026-09-02", -10000);
  const beta = row("beta", "2026-09-03", 10000, { group: BETA });
  const shop2 = row("shop2", "2026-09-04", -10000);
  const rows = [acme, shop1, beta, shop2];

  it("keeps a month as it closed when only a rule changed: a payer recognised or a purchase made one member's brings no line", () => {
    const sep = closedSep(rows);
    const ruled = [row("acme", "2026-09-01", 10000, own(MATTI)), row("shop1", "2026-09-02", -10000, { to: { owner: MAIJA } }), beta, shop2];
    expect(run("2026-09", ruled, { asOf: "2027-01-10", closed: [sep] })).toBe(sep);
    expect(run("2026-10", ruled, { asOf: "2027-01-10", closed: [sep] }).lines).toEqual([]);
  });

  it("carries a row the month never held, booked after it closed, and records the row it moved", () => {
    const sep = closedSep(rows);
    const booked = row("booked", "2026-09-20", -2000);
    const oct = run("2026-10", [...rows, row("more", "2026-09-19", 2000, own(MATTI)), booked], { asOf: "2027-01-10", closed: [sep] });
    expect(late(oct).map((l) => [l.key, l.cents, l.byRow?.map((r) => r.key)])).toEqual([["2026-09", 2000, [booked.key]]]);
    expect(byOwner(late(oct)[0]!.owed)).toEqual({ [MATTI]: 1000, [MAIJA]: 1000 });
  });

  it("still carries a row a rule turned from no cost into one: the month never held it (the residual of ADR 0017)", () => {
    const moved = (extra: Partial<TraceRow>) => [row("in", "2026-09-01", 10000, own(MATTI)), row("move", "2026-09-15", -5000, extra)];
    const sep = closedSep(moved({ to: "pool" }));
    const oct = run("2026-10", moved({}), { asOf: "2027-01-10", closed: [sep] });
    expect(late(oct).map((l) => [l.key, l.cents])).toEqual([["2026-09", 5000]]);
  });

  it("leaves the settled figure when an answer said after the closing is taken back: what is gone has no day", () => {
    const sep = closedSep(rows);
    const oct = run("2026-10", rows, { answers: [answer(ACME, MAIJA, "2027-01-08")], asOf: "2027-01-10", closed: [sep] }) as ClosedMonth;
    expect(late(oct).map((l) => [l.cents, byOwner(l.paid), l.byRow?.map((r) => r.key)])).toEqual([[0, { [ACME]: -10000, [MAIJA]: 10000 }, [shop1.key]]]);
    const nov = run("2026-11", rows, { asOf: "2027-01-20", closed: [sep, oct] });
    expect(nov.lines).toEqual([]);
  });

  it("takes off only the rows a later word reads again: an answer on Beta leaves Acme's correction as it was carried", () => {
    const sep = closedSep(rows);
    const first = [answer(ACME, MAIJA, "2027-01-08")];
    const oct = run("2026-10", rows, { answers: first, asOf: "2027-01-10", closed: [sep] }) as ClosedMonth;
    const nov = run("2026-11", rows, { answers: [...first, answer(BETA, MATTI, "2027-01-15")], asOf: "2027-01-20", closed: [sep, oct] });
    expect(late(nov).map((l) => [byOwner(l.paid), l.byRow?.map((r) => r.key)])).toEqual([[{ [BETA]: -10000, [MATTI]: 10000 }, [shop2.key]]]);
  });

  it("does not compare a refund whose purchase is untold today, also one older than the first stored month", () => {
    const cost = row("cost", "2026-08-03", -10000);
    const refunded = [row("in", "2026-08-01", 10000, own(MATTI)), cost, row("refund", "2026-09-05", 4000, { from: { refundOf: cost.key } })];
    const sep = closedSep(refunded);
    expect(sep.lines.map((l) => [l.kind, l.of])).toEqual([["refund", cost.key]]);
    // the use said after the closing reads every row, and the refund still says nothing new
    const oct = run("2026-10", refunded, { agreements: [], split: "unknown", said: { [POOL]: "2027-01-08" }, asOf: "2027-01-10", closed: [sep] });
    expect(oct.lines).toEqual([]);
  });

  describe("a month under a fixed agreement", () => {
    // Maija pays the first 50,00 of the month and the rest is cut equally; both purchases are counted in the fixed amount
    const FIXED: AgreementRow = { accountKey: POOL, validFrom: "2026-01-01", kind: "fixed", value: { cents: { [MAIJA]: 5000 }, rest: { kind: "equal" } } };
    // a rule made the first purchase Matti's after the month closed
    const ruled = [acme, row("shop1", "2026-09-02", -10000, { to: { owner: MATTI } }), beta, shop2];

    it("reads the fixed line anew with a purchase in it: a purchase an answer reads is not owed a second time in the fixed amount", () => {
      const sep = closedSep(rows, { agreements: [FIXED] });
      const oct = run("2026-10", ruled, { agreements: [FIXED], answers: [answer(ACME, MAIJA, "2027-01-08")], asOf: "2027-01-10", closed: [sep] });
      expect(late(oct).map((l) => [sides(l), byOwner(l.owed), l.byRow?.map((r) => r.key)])).toEqual([[[0, 0], { [MATTI]: 5000, [MAIJA]: -5000 }, [shop1.key, "2026-09"]]]);
    });

    it("reads every purchase in the fixed amount with the fixed line: a row booked later does not drop a purchase from what is owed", () => {
      const sep = closedSep(rows, { agreements: [FIXED] });
      const oct = run("2026-10", [...ruled, row("more", "2026-09-19", 2000, own(MATTI)), row("booked", "2026-09-20", -2000)], { agreements: [FIXED], asOf: "2027-01-10", closed: [sep] });
      expect(late(oct).map(sides)).toEqual([[2000, 2000]]);
    });
  });

  describe("a correction stored before corrections recorded their rows", () => {
    // what an earlier version carried for September: Acme's purchase as Matti's
    const legacy: SettlementLine = { kind: "late_change", key: "2026-09", day: d("2027-01-06"), cents: 0, paid: [{ owner: ACME, cents: -10000 }, { owner: MATTI, cents: 10000 }], owed: [] };
    const octWith = (sep: ClosedMonth, answers: SaidAnswer[]): ClosedMonth => {
      const oct = run("2026-10", rows, { answers, asOf: "2027-01-06", closed: [sep] });
      return { ...oct, lines: [...oct.lines.filter((l) => l.kind !== "late_change"), legacy] } as ClosedMonth;
    };

    it("is never reversed when nothing was said after the closing", () => {
      const sep = closedSep(rows);
      expect(run("2026-11", rows, { asOf: "2027-01-20", closed: [sep, octWith(sep, [])] }).lines).toEqual([]);
    });

    it("is not reversed by a word said after it on other rows", () => {
      const sep = closedSep(rows);
      const nov = run("2026-11", rows, { answers: [answer(BETA, MAIJA, "2027-01-15")], asOf: "2027-01-20", closed: [sep, octWith(sep, [])] });
      expect(late(nov).map((l) => [byOwner(l.paid), l.undid])).toEqual([[{ [BETA]: -10000, [MAIJA]: 10000 }, undefined]]);
    });

    it("is taken off once when the word that made it was said by its day, and a later month takes it off no more", () => {
      const sep = closedSep(rows);
      const answers = [answer(ACME, MATTI, "2027-01-02"), answer(BETA, MAIJA, "2027-01-15")];
      const oct = octWith(sep, answers.slice(0, 1));
      const nov = run("2026-11", rows, { answers, asOf: "2027-01-20", closed: [sep, oct] }) as ClosedMonth;
      expect(late(nov).map((l) => [byOwner(l.paid), l.undid && byOwner(l.undid.paid)])).toEqual([[{ [BETA]: -10000, [MAIJA]: 10000 }, { [ACME]: 10000, [MATTI]: -10000 }]]);
      expect(run("2026-12", rows, { answers, asOf: "2027-01-25", closed: [sep, oct, nov] }).lines).toEqual([]);
    });

    it("is taken off when the month has a row it never held, which the line may hold already: the row is counted once", () => {
      const sep = closedSep(rows);
      const booked = [row("more", "2026-09-19", 2000, own(MATTI)), row("booked", "2026-09-20", -2000)];
      // the earlier version compared every row, so a row booked before its line is in it
      const carried: SettlementLine = { kind: "late_change", key: "2026-09", day: d("2027-01-06"), cents: 2000, paid: [{ owner: MATTI, cents: 2000 }], owed: [{ owner: MATTI, cents: 1000 }, { owner: MAIJA, cents: 1000 }] };
      const oct = { ...octWith(sep, []), lines: [carried] } as ClosedMonth;
      expect(run("2026-11", [...rows, ...booked], { asOf: "2027-01-20", closed: [sep, oct] }).lines).toEqual([]);
    });

    it("counts the first answer twice when it is said again after the line (the residual of ADR 0017): only the latest day is stored", () => {
      const sep = closedSep(rows);
      const nov = run("2026-11", rows, { answers: [answer(ACME, MAIJA, "2027-01-15")], asOf: "2027-01-20", closed: [sep, octWith(sep, [answer(ACME, MATTI, "2027-01-02")])] });
      // today's answer gives Acme's purchase to Maija; Matti keeps the 100,00 the old line gave him
      expect(late(nov).map((l) => byOwner(l.paid))).toEqual([{ [ACME]: -10000, [MAIJA]: 10000 }]);
    });
  });
});
