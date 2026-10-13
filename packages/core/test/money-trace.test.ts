/**
 * The money trace of a pool: whose money paid every row. The replays are the household's own cases to the cent; after
 * every booked row the parts add up to the row, the lots less the open credit are what the account holds, and no
 * lot is below zero.
 */
import { describe, expect, it } from "vitest";
import { dayNumber as d } from "../src/dates.ts";
import { type Answer, openOf, questionsOf, settle, shareOf, splitOf, type TraceUser } from "../src/money-trace-answers.ts";
import { ASK_LIMIT, PAIR_DAYS, type RowParts, type SourcePart, TRACE_VERSION, type Trace, type TraceRow, trace } from "../src/money-trace.ts";
import { rng } from "./gen.ts";

const AINO = "u:u-aino";
const VILLE = "u:u-ville";
const CECILIA = "u:u-cecilia";
const two: TraceUser[] = [
  { owner: AINO, weight: 1 },
  { owner: VILLE, weight: 1 },
];
const three: TraceUser[] = [...two, { owner: CECILIA, weight: 1 }];
const HALF = { from: 0, to: 1, of: 2 };
const OWNER_Q = "g:text:ESIMERKKI OY";

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => {
  const day = d(date);
  return { key: `${day}|${cents}|${label}|00000`, ids: [label], day, cents, ...extra };
};
const own = (owner: string): Partial<TraceRow> => ({ from: { owner, kind: "own" } });
const payment = (owner: string): Partial<TraceRow> => ({ from: { owner, kind: "payment" } });
const forOne = (owner: string): Partial<TraceRow> => ({ to: { owner } });

const isUser = (owner: string) => owner.startsWith("u:");
const rowOf = (t: Trace, label: string): RowParts => t.rows.find((r) => r.ids[0] === label)!;
/** Aino's, Ville's and the unknown cents of a row. */
const cutOf = (t: Trace, label: string): number[] => {
  const parts = rowOf(t, label).parts;
  return [sum(parts.filter((p) => p.owner === AINO).map((p) => p.cents)), sum(parts.filter((p) => p.owner === VILLE).map((p) => p.cents)), sum(parts.filter((p) => !isUser(p.owner)).map((p) => p.cents))];
};
const passedOf = (t: Trace, label: string): number => sum(rowOf(t, label).parts.filter((p) => p.passed).map((p) => p.cents));
const left = (t: Trace, owner: string): number => sum(t.lots.filter((l) => l.owner === owner).map((l) => l.cents));

/** The invariants that hold after every booked row. */
function expectExact(t: Trace, rows: readonly TraceRow[], opening: number): void {
  for (const r of t.rows) {
    expect(sum(r.parts.map((p) => p.cents))).toBe(Math.abs(r.cents));
    for (const p of r.parts) expect(p.cents).toBeGreaterThan(0);
  }
  for (const l of t.lots) expect(l.cents).toBeGreaterThan(0);
  const booked = rows.filter((r) => !r.pending && !r.unmatched);
  expect(sum(t.lots.map((l) => l.cents)) - t.creditCents).toBe(opening + sum(booked.map((r) => r.cents)));
  // the open credit again, from the rows: what rows took on credit, less what refunds cancelled and what money paid
  const credit = (what: (r: RowParts) => boolean) => sum(t.rows.filter((r) => !r.pending && what(r)).flatMap((r) => r.parts.filter((p) => p.owner === "c").map((p) => p.cents)));
  expect(t.creditCents).toBe(Math.max(0, -opening) + credit((r) => r.cents < 0) - credit((r) => r.cents > 0) - sum(t.before.map((p) => p.cents)));
}

/** Traces rows and asserts the invariants after the full history and after every booked row of it. */
function replay(rows: readonly TraceRow[], opening = 0): Trace {
  const first = Math.min(...rows.filter((r) => !r.pending).map((r) => r.day));
  const t = trace(rows, opening, first);
  expectExact(t, rows, opening);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const keys = t.rows.filter((r) => !r.pending).map((r) => r.key);
  for (let k = 1; k < keys.length; k++) {
    const part = keys.slice(0, k).map((key) => byKey.get(key)!);
    expectExact(trace(part, opening, first), part, opening);
  }
  return t;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const next = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
/** 100 shuffles of the rows give the answer the sorted rows give. */
function expectStable(rows: readonly TraceRow[], opening = 0): void {
  const first = Math.min(...rows.filter((r) => !r.pending).map((r) => r.day));
  const base = trace(rows, opening, first);
  for (let seed = 1; seed <= 100; seed++) expect(trace(shuffled(rows, seed), opening, first)).toEqual(base);
}

const answer = (owner: string, key = "o"): Answer => ({ kind: key === "o" ? "opening" : "in", key, owner });

describe("constants", () => {
  it("states the asking sum, the days of a pair and a version", () => {
    expect(ASK_LIMIT).toBe(10000);
    expect(PAIR_DAYS).toBe(3);
    expect(TRACE_VERSION).toBeGreaterThan(0);
  });
});

describe("one funds: the old balance has an owner or not", () => {
  const rows = [
    row("in-jul", "2025-07-01", 115000, own(AINO)),
    row("mort-jul", "2025-07-03", -110437),
    row("esim", "2025-07-05", -4563),
    row("mort-aug", "2025-08-03", -110437),
    row("in-sep", "2025-09-01", 115000, own(AINO)),
    row("mort-sep", "2025-09-03", -110437),
  ];
  const raw = replay(rows, 312045);

  it.each([
    ["no answer", [], [0, 0, 110437], true],
    ["Aino", [answer(AINO)], [110437, 0, 0], false],
    ["Ville", [answer(VILLE)], [0, 110437, 0], false],
    ["Yhteistä", [answer("all")], [55219, 55218, 0], false],
    ["En tiedä", [answer("none")], [0, 0, 110437], false],
  ] as const)("August's mortgage with %s", (_name, answers, expected, open) => {
    const t = settle(raw, answers, two);
    expect(cutOf(t, "mort-aug")).toEqual(expected);
    // nothing else moves
    expect(cutOf(t, "mort-jul")).toEqual([110437, 0, 0]);
    expect(cutOf(t, "esim")).toEqual([4563, 0, 0]);
    expect(cutOf(t, "mort-sep")).toEqual([110437, 0, 0]);
    expect(rowOf(t, "mort-aug").parts.some((p) => openOf(t, answers)(p))).toBe(open);
    expect(questionsOf(t, answers).length).toBe(answers.length ? 0 : 1);
    expect(sum(t.lots.map((l) => l.cents))).toBe(4563 + 201608);
  });

  it("leaves Aino 45,63 and the opening 2 016,08", () => {
    expect(left(raw, AINO)).toBe(4563);
    expect(left(raw, "o")).toBe(201608);
  });

  it("shows her 552,19 of the row, all of it open until the opening is answered", () => {
    const open = openOf(raw, []);
    expect(shareOf(rowOf(raw, "mort-aug"), AINO, HALF, open)).toEqual({ cents: -55219, openCents: -55219, transfer: false });
    expect(shareOf(rowOf(raw, "mort-aug"), VILLE, { from: 1, to: 2, of: 2 }, open)).toEqual({ cents: -55218, openCents: -55218, transfer: false });
    const answers = [answer(AINO)];
    const settled = settle(raw, answers, two);
    expect(shareOf(rowOf(settled, "mort-aug"), AINO, HALF, openOf(settled, answers))).toEqual({ cents: -110437, openCents: 0, transfer: false });
  });

  it("asks about the opening only once a row took the opening", () => {
    const early = trace(rows.slice(0, 3), 312045, d("2025-07-01"));
    expect(early.openingTaken).toBe(false);
    expect(questionsOf(early, [])).toEqual([]);
    expect(questionsOf(raw, [])).toEqual([{ kind: "opening", key: "o", cents: 312045, day: d("2025-07-01"), openCents: 110437 }]);
  });

  it("gives one answer for 100 shuffles", () => expectStable(rows, 312045));
});

describe("the split", () => {
  const base = [row("in-a", "2025-07-01", 115000, own(AINO)), row("in-v", "2025-07-01", 5000, payment(VILLE)), row("mort", "2025-07-03", -110437), row("esim", "2025-07-05", -4563)];

  it("cuts a cost over what each has", () => {
    const t = replay(base);
    expect(cutOf(t, "mort")).toEqual([105835, 4602, 0]);
    expect(cutOf(t, "esim")).toEqual([4373, 190, 0]);
    expect([left(t, AINO), left(t, VILLE)]).toEqual([4792, 208]);
    expectStable(base);
  });

  it("returns the lots of a paired refund", () => {
    const rows = [...base, row("back", "2025-07-10", 4563, { from: { refundOf: base[3]!.key } })];
    const t = replay(rows);
    expect(cutOf(t, "back")).toEqual([4373, 190, 0]);
    expect(rowOf(t, "back").parts.map((p) => p.kind)).toEqual(["refund", "refund"]);
    expect([left(t, AINO), left(t, VILLE)]).toEqual([9165, 398]);
  });

  it("returns a partial refund in proportion", () => {
    const t = replay([...base, row("back", "2025-07-10", 2000, { from: { refundOf: base[3]!.key } })]);
    expect(cutOf(t, "back")).toEqual([1917, 83, 0]);
  });

  it("shares money back with no pair by the mix of the day before", () => {
    const t = replay([...base, row("back", "2025-07-10", 100, { from: "back" })]);
    expect(cutOf(t, "back")).toEqual([96, 4, 0]);
    expect(rowOf(t, "back").parts.every((p) => p.kind === "back")).toBe(true);
  });

  it("gives a pending row parts and takes nothing", () => {
    const t = replay([...base, row("wait", "2025-07-10", -1000, { pending: true })]);
    expect(cutOf(t, "wait")).toEqual([958, 42, 0]);
    expect([left(t, AINO), left(t, VILLE)]).toEqual([4792, 208]);
    expect(rowOf(t, "wait").pending).toBe(true);
  });

  it("cuts a cost that arrives late by the lots of its own day", () => {
    const t = replay([...base, row("late", "2025-07-02", -3001)]);
    expect(cutOf(t, "late")).toEqual([2876, 125, 0]);
    expect(cutOf(t, "mort")).toEqual([105835, 4602, 0]);
    expect(cutOf(t, "esim")).toEqual([4373, 190, 0]);
  });

  it("gives one answer for 100 shuffles with a refund, money back and a pending row", () => {
    expectStable([...base, row("back", "2025-07-10", 2000, { from: { refundOf: base[3]!.key } }), row("again", "2025-07-11", 100, { from: "back" }), row("wait", "2025-07-12", -1000, { pending: true })]);
  });
});

describe("the pair of a movement for one person", () => {
  const funds = (move: number, mortgageOn: string, moveOn = "2025-08-05"): TraceRow[] => [
    row("aino", "2025-08-01", 115000, own(AINO)),
    row("ville", "2025-08-04", 40000, payment(VILLE)),
    row("move", moveOn, -move, forOne(AINO)),
    row("mort", mortgageOn, -110437),
  ];

  it.each(["2025-08-03", "2025-08-04", "2025-08-06"])("takes Ville's 400,00 and leaves the mortgage to Aino (mortgage on %s)", (on) => {
    const rows = funds(40000, on);
    const t = replay(rows);
    expect(cutOf(t, "move")).toEqual([0, 40000, 0]);
    expect(passedOf(t, "move")).toBe(40000);
    expect(cutOf(t, "mort")).toEqual([110437, 0, 0]);
    expectStable(rows);
  });

  it("does not come out as the unpaired readings (354,37 passed, or 720,24 / 384,13)", () => {
    const third = replay(funds(40000, "2025-08-03"));
    expect(passedOf(third, "move")).not.toBe(35437);
    const sixth = replay(funds(40000, "2025-08-06"));
    expect(cutOf(sixth, "mort")).not.toEqual([72024, 38413, 0]);
  });

  it("pairs nothing when she moves 395,00: the mortgage on the 3rd leaves her 45,63 of her own and 349,37 of his", () => {
    const t = replay(funds(39500, "2025-08-03"));
    expect(cutOf(t, "move")).toEqual([4563, 34937, 0]);
    expect(passedOf(t, "move")).toBe(34937);
  });

  it("pairs nothing when she moves 395,00: the mortgage on the 6th leaves her 395,00 of her own, none passed", () => {
    const t = replay(funds(39500, "2025-08-06"));
    expect(cutOf(t, "move")).toEqual([39500, 0, 0]);
    expect(passedOf(t, "move")).toBe(0);
  });

  it("pairs a movement 3 days after the money in and not 4 days after", () => {
    const three = replay(funds(40000, "2025-08-06", "2025-08-07"));
    expect(cutOf(three, "move")).toEqual([0, 40000, 0]);
    expect(cutOf(three, "mort")).toEqual([110437, 0, 0]);
    const four = replay(funds(40000, "2025-08-06", "2025-08-08"));
    expect(cutOf(four, "move")).not.toEqual([0, 40000, 0]);
    expect(cutOf(four, "mort")[1]).toBeGreaterThan(0);
  });

  it("pairs a row once and by the nearest day", () => {
    const rows = [
      row("far", "2025-08-01", 40000, payment(VILLE)),
      row("near", "2025-08-03", 40000, own(AINO)),
      row("first", "2025-08-04", -40000, forOne(AINO)),
      row("second", "2025-08-04", -40000, forOne(AINO)),
    ];
    const t = replay(rows);
    // the nearest money in is hers (the 3rd), the other movement takes the one left
    expect(cutOf(t, "first")).toEqual([40000, 0, 0]);
    expect(cutOf(t, "second")).toEqual([0, 40000, 0]);
    expect(passedOf(t, "second")).toBe(40000);
  });

  it("moves given parts on whole", () => {
    const rows = [
      row("aino", "2025-09-01", 200000, own(AINO)),
      row(
        "pool",
        "2025-09-10",
        500000,
        {
          from: {
            parts: [
              { owner: AINO, kind: "pool", cents: 250000 },
              { owner: VILLE, kind: "pool", cents: 250000 },
            ],
          },
        },
      ),
      row("move", "2025-09-11", -500000, forOne(AINO)),
    ];
    const t = replay(rows);
    expect(cutOf(t, "move")).toEqual([250000, 250000, 0]);
    expect(passedOf(t, "move")).toBe(250000);
    expect(left(t, AINO)).toBe(200000);
    expect(left(t, VILLE)).toBe(0);
  });

  it("moving her money back and forth passes nothing and leaves his", () => {
    const rows: TraceRow[] = [row("ville", "2025-06-01", 40000, payment(VILLE))];
    for (const [i, day] of ["2025-06-10", "2025-07-10", "2025-08-10"].entries()) {
      rows.push(row(`in${i}`, day, 100000, own(AINO)));
      const next = `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1)}`;
      rows.push(row(`back${i}`, next, -100000, forOne(AINO)));
    }
    const t = replay(rows);
    for (let i = 0; i < 3; i++) expect(passedOf(t, `back${i}`)).toBe(0);
    expect(left(t, VILLE)).toBe(40000);
    expect(left(t, AINO)).toBe(0);
  });
});

describe("unknown money", () => {
  const rows = (unknown: number): TraceRow[] => [
    row("oy", "2025-07-01", unknown, { group: OWNER_Q }),
    row("aino", "2025-07-02", 20000, own(AINO)),
    row("cost", "2025-07-05", -19000),
  ];

  it("lets unknown money stand among the owners, last, and asks about it", () => {
    const t = replay(rows(250000));
    expect(cutOf(t, "cost")).toEqual([1407, 0, 17593]);
    expect(questionsOf(t, [])).toEqual([{ kind: "in", key: OWNER_Q, cents: 250000, day: d("2025-07-01"), openCents: 250000 + 17593 }]);
    expectStable(rows(250000));
  });

  it("relabels to Ville and to both", () => {
    const t = replay(rows(250000));
    expect(cutOf(settle(t, [answer(VILLE, OWNER_Q)], two), "cost")).toEqual([1407, 17593, 0]);
    expect(cutOf(settle(t, [answer("all", OWNER_Q)], two), "cost")).toEqual([10204, 8796, 0]);
    expect(cutOf(settle(t, [answer("none", OWNER_Q)], two), "cost")).toEqual([1407, 0, 17593]);
    expect(questionsOf(t, [answer("none", OWNER_Q)])).toEqual([]);
  });

  it("shows Aino 102,04 of the row, 87,97 open, before any answer", () => {
    const t = replay(rows(250000));
    expect(shareOf(rowOf(t, "cost"), AINO, HALF, openOf(t, []))).toEqual({ cents: -10204, openCents: -8797, transfer: false });
  });

  it("signs the open cents like the row: money in positive, money out negative, and settled = cents - openCents", () => {
    const t = replay([row("in", "2025-07-01", 25000, { group: OWNER_Q }), row("out", "2025-07-02", -25000)]);
    expect(shareOf(rowOf(t, "in"), AINO, HALF, openOf(t, []))).toEqual({ cents: 12500, openCents: 12500, transfer: false });
    expect(shareOf(rowOf(t, "out"), AINO, HALF, openOf(t, []))).toEqual({ cents: -12500, openCents: -12500, transfer: false });
    // answered: nothing is open, on either sign
    const answers = [answer(AINO, OWNER_Q)];
    const s = settle(t, answers, two);
    expect(shareOf(rowOf(s, "out"), AINO, HALF, openOf(s, answers))).toEqual({ cents: -25000, openCents: 0, transfer: false });
  });

  it("is not asked about at 99,99 and is at 100,00", () => {
    const below = replay(rows(9999));
    expect(cutOf(below, "cost")).toEqual([19000, 0, 0]);
    expect(questionsOf(below, [])).toEqual([]);
    const at = replay(rows(10000));
    expect(cutOf(at, "cost")).toEqual([12667, 0, 6333]);
    expect(questionsOf(at, [])).toHaveLength(1);
  });

  it("counts the lots a group made before its sum reached the limit as tier 2", () => {
    const t = replay([row("a", "2025-07-01", 6000, { group: OWNER_Q }), row("b", "2025-07-02", 4000, { group: OWNER_Q }), row("aino", "2025-07-03", 20000, own(AINO)), row("cost", "2025-07-05", -19000)]);
    expect(t.lots.filter((l) => l.owner === OWNER_Q).map((l) => l.tier)).toEqual([2, 1]);
    // Aino 200,00 and the second row's 40,00 are tier 1; the first row's 60,00 is left alone
    expect(cutOf(t, "cost")).toEqual([15833, 0, 3167]);
    expect(t.groups).toEqual([{ key: OWNER_Q, cents: 10000, firstDay: d("2025-07-01") }]);
  });

  it("orders the questions by what is open, largest first", () => {
    const t = replay([
      row("big", "2025-07-01", 100000, { group: "g:text:ALPHA" }),
      row("bigger", "2025-07-01", 90000, { group: "g:text:BETA" }),
      row("aino", "2025-07-02", 1000, own(AINO)),
      row("cost", "2025-07-05", -50000),
    ]);
    expect(questionsOf(t, []).map((q) => q.key)).toEqual(["g:text:ALPHA", "g:text:BETA"]);
    expect(questionsOf(t, []).map((q) => q.openCents)).toEqual([100000 + 26178, 90000 + 23560]);
  });

  it("does not ask about a row only one of two copies has", () => {
    const t = replay([row("a", "2025-07-01", 9000, own(AINO)), { ...row("x", "2025-07-02", 500000), unmatched: true }, row("b", "2025-07-03", -1000)]);
    expect(rowOf(t, "x").parts).toEqual([{ owner: "g:text:unmatched", kind: "unknown", cents: 500000 }]);
    expect(cutOf(t, "b")).toEqual([1000, 0, 0]);
    expect(questionsOf(t, [])).toEqual([]);
  });
});

describe("short: credit", () => {
  it("fills the credit with the next money in, oldest row first, by its owners", () => {
    const rows = [row("mort", "2025-07-03", -110437), row("ville", "2025-07-04", 5000, payment(VILLE)), row("aino", "2025-07-05", 115000, own(AINO))];
    const t = replay(rows);
    expect(cutOf(t, "mort")).toEqual([105437, 5000, 0]);
    expect(left(t, AINO)).toBe(9563);
    expect(trace(rows.slice(0, 1), 0, d("2025-07-03")).creditCents).toBe(110437);
    expect(rowOf(trace(rows.slice(0, 1), 0, d("2025-07-03")), "mort").parts).toEqual([{ owner: "c", kind: "credit", cents: 110437 }]);
    expectStable(rows);
  });

  it("names a debt of the time before the history and reports who paid it", () => {
    const rows = [row("aino", "2025-07-01", 115000, own(AINO)), row("mort", "2025-07-03", -110437)];
    const t = replay(rows, -50000);
    expect(t.before).toEqual([{ owner: AINO, kind: "before", cents: 50000 }]);
    expect(cutOf(t, "mort")).toEqual([65000, 0, 45437]);
    expect(t.lots).toEqual([]);
    expect(t.creditCents).toBe(45437);
    expect(shareOf(rowOf(t, "mort"), AINO, HALF, openOf(t, [])).cents).toBe(-87719);
    expectStable(rows, -50000);
  });

  it("charges the earlier payer first when two rows were paid on credit", () => {
    const rows = [row("one", "2025-07-01", -3000), row("two", "2025-07-02", -2000), row("aino", "2025-07-03", 3500, own(AINO)), row("ville", "2025-07-04", 2000, payment(VILLE))];
    const t = replay(rows);
    expect(cutOf(t, "one")).toEqual([3000, 0, 0]);
    expect(cutOf(t, "two")).toEqual([500, 1500, 0]);
    expect(rowOf(t, "two").parts.map((p) => p.owner)).toEqual([AINO, VILLE, "c"].slice(0, 2));
    expect(left(t, VILLE)).toBe(500);
  });

  it("cancels the credit a purchase was paid on when it is refunded", () => {
    const purchase = row("shop", "2025-07-03", -10000);
    const refund = row("refund", "2025-07-04", 4000, { from: { refundOf: purchase.key } });
    const rows = [purchase, refund, row("aino", "2025-07-05", 10000, own(AINO))];
    const middle = replay([purchase, refund]);
    expect(middle.creditCents).toBe(6000);
    expect(rowOf(middle, "refund").parts).toEqual([{ owner: "c", kind: "credit", cents: 4000 }]);
    const t = replay(rows);
    expect(cutOf(t, "shop")).toEqual([6000, 0, 4000]);
    expect(left(t, AINO)).toBe(4000);
    expect(t.creditCents).toBe(0);
  });

  it("gives a short row for one person the same credit", () => {
    const t = replay([row("aino", "2025-07-01", 1000, own(AINO)), row("pay", "2025-07-02", -2500, forOne(AINO))]);
    expect(rowOf(t, "pay").parts).toEqual([
      { owner: AINO, kind: "own", cents: 1000 },
      { owner: "c", kind: "credit", cents: 1500 },
    ]);
  });

  it("gives one answer for 100 shuffles with an opening below zero", () => {
    expectStable([row("mort", "2025-07-03", -110437), row("ville", "2025-07-04", 5000, payment(VILLE)), row("aino", "2025-07-05", 115000, own(AINO)), row("cost", "2025-07-06", -9000)], -20000);
  });
});

describe("money both ways: refunds on every rule", () => {
  const funded = [row("aino", "2025-07-01", 10000, own(AINO)), row("ville", "2025-07-01", 10000, payment(VILLE))];

  it("returns more than the purchase held as money back, by the mix of the day before", () => {
    const purchase = row("shop", "2025-07-03", -3000);
    const t = replay([...funded, purchase, row("refund", "2025-07-05", 5000, { from: { refundOf: purchase.key } })]);
    expect(cutOf(t, "shop")).toEqual([1500, 1500, 0]);
    const parts = rowOf(t, "refund").parts;
    expect(parts.filter((p) => p.kind === "refund").map((p) => p.cents)).toEqual([1500, 1500]);
    expect(parts.filter((p) => p.kind === "back").map((p) => p.cents)).toEqual([1000, 1000]);
    expect(sum(parts.map((p) => p.cents))).toBe(5000);
  });

  it("splits a second refund over what the first left", () => {
    const purchase = row("shop", "2025-07-03", -3001);
    const rows = [...funded, purchase, row("r1", "2025-07-04", 1000, { from: { refundOf: purchase.key } }), row("r2", "2025-07-05", 2001, { from: { refundOf: purchase.key } })];
    const t = replay(rows);
    const returned = [AINO, VILLE].map((o) => sum(["r1", "r2"].flatMap((l) => rowOf(t, l).parts.filter((p) => p.owner === o).map((p) => p.cents))));
    expect(returned).toEqual(cutOf(t, "shop").slice(0, 2));
  });

  it("reads a refund booked on its purchase's day right after the purchase", () => {
    const purchase = row("shop", "2025-07-03", -5000);
    const rows = [...funded, row("later", "2025-07-03", -3000), purchase, row("refund", "2025-07-03", 5000, { from: { refundOf: purchase.key } }), row("pay", "2025-07-03", 100, own(AINO))];
    const t = replay(rows);
    expect(t.rows.filter((r) => r.day === d("2025-07-03")).map((r) => r.ids[0])).toEqual(["pay", "shop", "refund", "later"]);
    expect(cutOf(t, "refund")).toEqual(cutOf(t, "shop").slice(0, 2).concat(0));
    expectStable(rows);
  });

  it("returns an opening part as the opening", () => {
    const purchase = row("shop", "2025-07-03", -3000);
    const t = replay([purchase, row("refund", "2025-07-04", 3000, { from: { refundOf: purchase.key } })], 10000);
    expect(rowOf(t, "refund").parts).toEqual([{ owner: "o", kind: "opening", cents: 3000 }]);
    expect(t.lots.map((l) => [l.owner, l.kind, l.tier])).toEqual([["o", "opening", 2], ["o", "opening", 2]]);
    expect(left(t, "o")).toBe(10000);
  });

  it("treats money back into an empty pool as unknown money of its payer", () => {
    const t = replay([row("back", "2025-07-03", 700, { from: "back", group: "g:text:KAUPPA" })]);
    expect(rowOf(t, "back").parts).toEqual([{ owner: "g:text:KAUPPA", kind: "unknown", cents: 700 }]);
    expect(t.lots).toEqual([{ owner: "g:text:KAUPPA", kind: "unknown", cents: 700, tier: 2 }]);
  });

  it("treats a refund whose purchase is not there as money back", () => {
    const t = replay([...funded, row("refund", "2025-07-05", 1000, { from: { refundOf: "no such row" } })]);
    expect(cutOf(t, "refund")).toEqual([500, 500, 0]);
  });

  it("gives money back that same day's mix of the end of the day before", () => {
    const t = replay([...funded, row("big", "2025-07-02", -10000), row("back", "2025-07-02", 400, { from: "back" })]);
    expect(cutOf(t, "back")).toEqual([200, 200, 0]);
  });
});

describe("three users and odd cents", () => {
  const funds = [row("a", "2025-07-01", 10000, own(AINO)), row("v", "2025-07-01", 10000, payment(VILLE)), row("c", "2025-07-01", 10000, payment(CECILIA))];
  const cutThree = (t: Trace, label: string) => [AINO, VILLE, CECILIA].map((o) => sum(rowOf(t, label).parts.filter((p) => p.owner === o).map((p) => p.cents)));

  it("gives the odd cent by the order of the parts and loses none", () => {
    const t = replay([...funds, row("one", "2025-07-02", -1), row("hundred", "2025-07-03", -10000)]);
    // the order of the parts is by user id: Aino, Cecilia, Ville
    expect(cutThree(t, "one")).toEqual([0, 0, 1]);
    expect(cutThree(t, "hundred")).toEqual([3333, 3333, 3334]);
    expect(sum(t.lots.map((l) => l.cents))).toBe(30000 - 1 - 10000);
  });

  it("cuts unknown money over three users at their weights", () => {
    const t = replay([row("oy", "2025-07-01", 10000, { group: OWNER_Q }), row("cost", "2025-07-02", -10000)]);
    const s = settle(t, [answer("all", OWNER_Q)], three);
    expect(cutThree(s, "cost")).toEqual([3333, 3333, 3334]);
    const weighted = settle(t, [answer("all", OWNER_Q)], [{ owner: AINO, weight: 3 }, { owner: VILLE, weight: 2 }, { owner: CECILIA, weight: 0 }]);
    expect(cutThree(weighted, "cost")).toEqual([6000, 4000, 0]);
  });
});

describe("two pools", () => {
  it("cuts a movement to another pool as a transfer and carries its parts", () => {
    const x = replay([row("a", "2025-07-01", 60000, own(AINO)), row("v", "2025-07-01", 40000, payment(VILLE)), row("out", "2025-07-02", -50000, { to: "pool" })]);
    expect(cutOf(x, "out")).toEqual([30000, 20000, 0]);
    expect(rowOf(x, "out").what).toBe("pool");
    expect(shareOf(rowOf(x, "out"), AINO, HALF, () => false)).toEqual({ cents: -25000 - 5000, openCents: 0, transfer: true });
    expect([left(x, AINO), left(x, VILLE)]).toEqual([30000, 20000]);
    const carried = rowOf(x, "out").parts.map((p) => ({ ...p, kind: "pool" as const }));
    const y = replay([row("in", "2025-07-02", 50000, { from: { parts: carried } })]);
    expect(y.lots).toEqual([
      { owner: AINO, kind: "pool", cents: 30000, tier: 1 },
      { owner: VILLE, kind: "pool", cents: 20000, tier: 1 },
    ]);
    expect(shareOf(rowOf(y, "in"), AINO, HALF, () => false)).toEqual({ cents: 30000, openCents: 0, transfer: true });
  });

  it("makes the unknown part of a movement between pools a question of the other pool", () => {
    const t = replay([row("in", "2025-07-02", 50000, { from: { parts: [{ owner: "g:iban:FI0000000002", kind: "pool", cents: 50000 }] } })]);
    expect(questionsOf(t, [])).toHaveLength(1);
    expect(t.lots[0]!.tier).toBe(1);
  });
});

describe("the transfer flag", () => {
  const rows = [
    row("own", "2025-07-01", 5000, own(AINO)),
    row("pay", "2025-07-01", 4000, payment(VILLE)),
    row("shop", "2025-07-02", -1000),
    row("refund", "2025-07-03", 1000, { from: { refundOf: row("shop", "2025-07-02", -1000).key } }),
    row("oy", "2025-07-03", 200, { group: OWNER_Q }),
    row("one", "2025-07-04", -300, forOne(AINO)),
  ];
  it("is true for money in from a person and money out for one, not for a refund, unknown money or a cost", () => {
    const t = replay(rows);
    const flag = (label: string) => shareOf(rowOf(t, label), AINO, HALF, () => false).transfer;
    expect([flag("own"), flag("pay"), flag("shop"), flag("refund"), flag("oy"), flag("one")]).toEqual([true, true, false, false, false, true]);
  });
  it("adds up to the row over the users", () => {
    const t = replay(rows);
    for (const r of t.rows) {
      const a = shareOf(r, AINO, { from: 0, to: 1, of: 2 }, () => false).cents;
      const v = shareOf(r, VILLE, { from: 1, to: 2, of: 2 }, () => false).cents;
      expect(a + v).toBe(r.cents);
    }
  });
});

describe("the conditions of setting the split", () => {
  const window = { from: d("2025-07-01"), to: d("2025-09-30") };
  const jul = (extra: TraceRow[] = [], firstDay = "2025-07-01") => [
    row("in-jul", firstDay, 115000, own(AINO)),
    row("mort-jul", "2025-07-03", -110437),
    row("esim", "2025-07-05", -4563),
    ...extra,
    row("mort-aug", "2025-08-03", -110437),
    row("in-sep", "2025-09-01", 115000, own(AINO)),
    row("mort-sep", "2025-09-03", -110437),
  ];
  const run = (rows: TraceRow[], answers: Answer[] = [], opening = 312045, first = "2025-07-01") => splitOf(replay(rows, opening), answers, two, window) && splitOf(trace(rows, opening, d(first)), answers, two, window);

  it("fails C4 while the opening is unknown and August's mortgage took it", () => {
    const r = run(jul());
    expect([r.c3, r.c4, r.c5]).toEqual([true, false, true]);
  });

  it("fails C5 after the answer: the offer is 100 % and 0 %", () => {
    const r = run(jul(), [answer(AINO)]);
    expect([r.c3, r.c4, r.c5]).toEqual([true, true, false]);
    expect(r.percents).toEqual([
      { owner: AINO, percent: 100 },
      { owner: VILLE, percent: 0 },
    ]);
  });

  it("holds all three when Aino pays in on 1.8. too", () => {
    const r = run(jul([row("in-aug", "2025-08-01", 115000, own(AINO))]));
    expect([r.c3, r.c4, r.c5]).toEqual([true, true, true]);
    expect(r.percents.map((p) => p.percent)).toEqual([100, 0]);
  });

  it("misses C3 by a day: the first row on 2.7.", () => {
    const r = run(jul([row("in-aug", "2025-08-01", 115000, own(AINO))], "2025-07-02"), [], 312045, "2025-07-02");
    expect([r.c3, r.c4, r.c5]).toEqual([false, true, true]);
  });

  it("misses C4 with no cost row in the window", () => {
    const rows = [row("in", "2025-07-01", 100000, own(AINO)), row("one", "2025-07-10", -1000, forOne(AINO)), row("outside", "2025-10-03", -1000)];
    const r = splitOf(trace(rows, 0, d("2025-07-01")), [], two, window);
    expect([r.c3, r.c4, r.c5]).toEqual([true, false, true]);
  });

  it("misses C4 with En tiedä and keeps C5, since nothing was relabelled", () => {
    const r = run(jul(), [answer("none")]);
    expect([r.c4, r.c5]).toEqual([false, true]);
  });

  it("misses C5 only for an answer that reaches a row of the window", () => {
    const rows = [row("in", "2025-07-01", 115000, own(AINO)), row("mort", "2025-07-03", -110437), row("late", "2025-10-03", -9000), row("cost", "2025-07-04", -4000)];
    const r = splitOf(trace(rows, 5000, d("2025-07-01")), [answer(AINO)], two, window);
    expect([r.c4, r.c5]).toEqual([true, true]);
    const hit = splitOf(trace([row("in", "2025-07-01", 1000, own(AINO)), row("big", "2025-07-03", -4000)], 5000, d("2025-07-01")), [answer(AINO)], two, window);
    expect([hit.c4, hit.c5]).toEqual([true, false]);
  });

  it("states the traced split in whole percents that add up to 100", () => {
    const r = run(jul(), [answer("all")]);
    expect(r.percents).toEqual([
      { owner: AINO, percent: 84 },
      { owner: VILLE, percent: 16 },
    ]);
    expect(sum(r.percents.map((p) => p.percent))).toBe(100);
  });

  it("leaves a pending row of the window out", () => {
    const r = run(jul([row("wait", "2025-07-20", -5000, { pending: true })]), [answer(AINO)]);
    expect(r.percents.map((p) => p.percent)).toEqual([100, 0]);
  });
});

/** A seeded history of booked rows: money in of every kind, costs for all and for one, refunds, money back, pending. */
function history(seed: number, owners: readonly string[], count: number): TraceRow[] {
  const next = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const groups = ["g:text:ESIMERKKI OY", "g:iban:FI0000000001", "g:text:KAUPPA"];
  const rows: TraceRow[] = [];
  const purchases: TraceRow[] = [];
  let day = d("2025-01-01");
  for (let i = 0; i < count; i++) {
    day += Math.floor(next() * 2);
    const kind = next();
    const cents = 1 + Math.floor(next() * 60000);
    const base = { key: `${day}|${i}|r${i}|00000`, ids: [`r${i}`], day };
    if (kind < 0.22) rows.push({ ...base, cents, from: { owner: pick(owners), kind: "own" } });
    else if (kind < 0.3) rows.push({ ...base, cents, from: { owner: pick(owners), kind: "payment" } });
    else if (kind < 0.38) rows.push({ ...base, cents: cents * 2, group: pick(groups) });
    else if (kind < 0.42) {
      const a = Math.floor(cents / 3);
      const parts: SourcePart[] = [
        { owner: owners[0]!, kind: "pool", cents: a },
        { owner: pick(owners), kind: "pool", cents: cents - a },
      ];
      rows.push({ ...base, cents, from: { parts: parts.filter((p) => p.cents > 0) } });
    } else if (kind < 0.76) {
      const r = { ...base, cents: -cents };
      rows.push(r);
      purchases.push(r);
    } else if (kind < 0.84) rows.push({ ...base, cents: -cents, to: { owner: pick(owners) } });
    else if (kind < 0.87) rows.push({ ...base, cents: -cents, to: "pool" });
    else if (kind < 0.93 && purchases.length) {
      const p = pick(purchases);
      rows.push({ ...base, cents: 1 + Math.floor(next() * (Math.abs(p.cents) + 500)), from: { refundOf: p.key } });
    } else if (kind < 0.96) rows.push({ ...base, cents: Math.floor(cents / 10) + 1, from: "back", group: pick(groups) });
    else rows.push({ ...base, cents: -cents, pending: true });
  }
  return rows;
}

describe("a seeded history of 300 rows", () => {
  it.each([
    [1, [AINO, VILLE], 0],
    [2, [AINO, VILLE], 400000],
    [3, [AINO, VILLE, CECILIA], -150000],
    [4, [AINO, VILLE, CECILIA], 90000],
    [5, [AINO, VILLE], -25000],
  ] as const)("keeps the three invariants, seed %i", (seed, owners, opening) => {
    const rows = history(seed, owners, 300);
    const t = replay(rows, opening);
    expect(t.rows).toHaveLength(300);
    expect(t.rows.some((r) => r.parts.some((p) => p.kind === "refund"))).toBe(true);
  }, 60000);

  it("passes other members' money in some of the seeded histories", () => {
    const passed = [1, 2, 3, 4, 5].map((seed) => trace(history(seed, [AINO, VILLE], 300), 0, d("2025-01-01")).rows.some((r) => r.parts.some((p) => p.passed)));
    expect(passed.some(Boolean)).toBe(true);
  });

  it.each([
    [11, [AINO, VILLE], 100000],
    [12, [AINO, VILLE, CECILIA], -60000],
  ] as const)("changes no part that did not belong to the group, seed %i", (seed, owners, opening) => {
    const users = owners.map((owner): TraceUser => ({ owner, weight: 1 }));
    const raw = replay(history(seed, owners, 300), opening);
    const keys = [...raw.groups.map((g) => g.key), "o"];
    expect(keys.length).toBeGreaterThan(1);
    for (const key of keys) {
      for (const owner of [AINO, VILLE, "all", "none"]) {
        const settled = settle(raw, [answer(owner, key)], users);
        expect(settled.rows.map((r) => r.key)).toEqual(raw.rows.map((r) => r.key));
        expect(settled.creditCents).toBe(raw.creditCents);
        expect(sum(settled.lots.map((l) => l.cents))).toBe(sum(raw.lots.map((l) => l.cents)));
        raw.rows.forEach((before, i) => {
          const after = settled.rows[i]!.parts;
          let at = 0;
          for (const p of before.parts) {
            if (p.owner !== key) {
              expect(after[at]).toEqual(p);
              at++;
              continue;
            }
            let given = 0;
            while (given < p.cents) given += after[at++]!.cents;
            expect(given).toBe(p.cents);
          }
          expect(at).toBe(after.length);
        });
      }
    }
  }, 120000);

  it("gives one answer for 100 shuffles", () => expectStable(history(7, [AINO, VILLE, CECILIA], 300), 50000), 60000);

  it("traces 5 000 rows in a blink", () => {
    const rows = history(9, [AINO, VILLE], 5000);
    const start = performance.now();
    const t = trace(rows, 0, rows[0]!.day);
    expect(performance.now() - start).toBeLessThan(3000);
    expectExact(t, rows, 0);
  });
});
