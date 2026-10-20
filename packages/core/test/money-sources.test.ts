/**
 * What each member of a joint account paid in, bore and moved, month by month: the months of the household's own cases
 * to the cent, and on a random history the columns of every row of a month add up to the account's rows of that kind
 * and the balances to the walked balance at the month's end.
 */
import { describe, expect, it } from "vitest";
import { dayNumber as d, fromDayNumber } from "../src/dates.ts";
import { sourcesByMonth } from "../src/money-sources.ts";
import { type Answer, settle, shareOf, type TraceUser } from "../src/money-trace-answers.ts";
import { type Trace, type TraceRow, trace } from "../src/money-trace.ts";
import { rng } from "./gen.ts";

const AINO = "u:u-aino";
const VILLE = "u:u-ville";
const CECILIA = "u:u-cecilia";
const two = [AINO, VILLE];
const weights = (owners: readonly string[]): TraceUser[] => owners.map((owner) => ({ owner, weight: 1 }));
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
type MonthSources = ReturnType<typeof sourcesByMonth>[number];

const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => {
  const day = d(date);
  return { key: `${day}|${cents}|${label}|00000`, ids: [label], day, cents, ...extra };
};
const own = (owner: string): Partial<TraceRow> => ({ from: { owner, kind: "own" } });
const payment = (owner: string): Partial<TraceRow> => ({ from: { owner, kind: "payment" } });
const forOne = (owner: string): Partial<TraceRow> => ({ to: { owner } });

/** The trace of rows with the opening before the first booked row, settled by the answers over `owners`. */
function traced(rows: readonly TraceRow[], opening = 0, answers: readonly Answer[] = [], owners: readonly string[] = two): Trace {
  const first = Math.min(...rows.filter((r) => !r.pending).map((r) => r.day));
  return settle(trace(rows, opening, first), answers, weights(owners));
}

/** One row of the page's table: a figure for each member and for the rest, in the order of the columns. */
type Figure = "paidInCents" | "costsCents" | "movedCents" | "takenCents" | "leftCents";
const line = (m: MonthSources | undefined, figure: Figure): number[] => m!.columns.map((c) => c[figure]);
const monthOf = (months: MonthSources[], month: string) => months.find((m) => m.month === month);

describe("the months of the household's own cases", () => {
  it("T11: the pair, with the mortgage on the 3rd", () => {
    const rows = [row("aino", "2026-08-01", 115000, own(AINO)), row("ville", "2026-08-04", 40000, payment(VILLE)), row("move", "2026-08-05", -40000, forOne(AINO)), row("mort", "2026-08-03", -110437)];
    const aug = monthOf(sourcesByMonth(traced(rows), two), "2026-08");
    expect(line(aug, "paidInCents")).toEqual([115000, 40000, 0]);
    expect(line(aug, "costsCents")).toEqual([110437, 0, 0]);
    expect(line(aug, "movedCents")).toEqual([0, 40000, 0]);
    expect(line(aug, "leftCents")).toEqual([4563, 0, 0]);
    // she took 400,00 of his: it is on her column, not a cost and not income
    expect(line(aug, "takenCents")).toEqual([40000, 0, 0]);
  });

  it("T11: short, then paid; the cost of July waits for the money that comes", () => {
    const jul = [row("mort", "2026-07-03", -110437), row("ville", "2026-07-04", 5000, payment(VILLE))];
    const paid = sourcesByMonth(traced([...jul, row("aino", "2026-07-05", 115000, own(AINO))]), two);
    expect(line(paid[0], "costsCents")).toEqual([105437, 5000, 0]);
    expect(line(paid[0], "paidInCents")).toEqual([115000, 5000, 0]);
    expect(line(paid[0], "leftCents")).toEqual([9563, 0, 0]);
    // her money comes on 1.8.: July ends with her month's cost unpaid
    const late = sourcesByMonth(traced([...jul, row("aino", "2026-08-01", 115000, own(AINO))]), two);
    expect(late.map((m) => m.month)).toEqual(["2026-08", "2026-07"]);
    expect(line(late[1], "costsCents")).toEqual([105437, 5000, 0]);
    expect(line(late[1], "paidInCents")).toEqual([0, 5000, 0]);
    expect(line(late[1], "leftCents")).toEqual([-105437, 0, 0]);
    expect(line(late[0], "paidInCents")).toEqual([115000, 0, 0]);
    expect(line(late[0], "leftCents")).toEqual([9563, 0, 0]);
  });

  it("T6: an opening below zero ends July at -454,37, in the column of nobody", () => {
    const rows = [row("aino", "2026-07-01", 115000, own(AINO)), row("mort", "2026-07-03", -110437)];
    const jul = sourcesByMonth(traced(rows, -50000), two)[0];
    expect(line(jul, "paidInCents")).toEqual([115000, 0, 0]);
    expect(line(jul, "costsCents")).toEqual([65000, 0, 45437]);
    expect(line(jul, "leftCents")).toEqual([0, 0, -45437]);
    // near miss: an opening of nothing leaves no credit and no unknown
    expect(line(sourcesByMonth(traced(rows, 0), two)[0], "leftCents")).toEqual([4563, 0, 0]);
  });

  it("T1: an opening nobody owns is unknown until it is answered, then it is theirs in every month", () => {
    const rows = [
      row("in-jul", "2025-07-01", 115000, own(AINO)),
      row("mort-jul", "2025-07-03", -110437),
      row("esim", "2025-07-05", -4563),
      row("mort-aug", "2025-08-03", -110437),
      row("in-sep", "2025-09-01", 115000, own(AINO)),
      row("mort-sep", "2025-09-03", -110437),
    ];
    const open = sourcesByMonth(traced(rows, 312045), two);
    expect(open.map((m) => m.month)).toEqual(["2025-09", "2025-08", "2025-07"]);
    expect(line(open[1], "costsCents")).toEqual([0, 0, 110437]);
    expect(line(open[0], "leftCents")).toEqual([4563, 0, 201608]);
    const total = (months: MonthSources[]) => months.map((m) => sum(m.columns.map((c) => c.leftCents)));
    for (const [answer, aug, left] of [
      [AINO, [110437, 0, 0], [206171, 0, 0]],
      [VILLE, [0, 110437, 0], [4563, 201608, 0]],
      ["all", [55219, 55218, 0], [4563 + 100804, 100804, 0]],
      ["none", [0, 0, 110437], [4563, 0, 201608]],
    ] as const) {
      const months = sourcesByMonth(traced(rows, 312045, [{ kind: "opening", key: "o", owner: answer }]), two);
      expect(line(months[1], "costsCents"), answer).toEqual(aug);
      expect(line(months[0], "leftCents"), answer).toEqual(left);
      // the answer moves cents between columns and no other: the balances still add up
      expect(total(months), answer).toEqual(total(open));
      expect(months.map((m) => sum(m.columns.map((c) => c.costsCents))), answer).toEqual(open.map((m) => sum(m.columns.map((c) => c.costsCents))));
    }
  });

  it("T5: unknown money in moves to the person in every month it is answered for", () => {
    const rows = (unknown: number) => [
      row("oy", "2025-07-01", unknown, { group: "g:text:ESIMERKKI OY" }),
      row("aino", "2025-07-02", 20000, own(AINO)),
      row("cost", "2025-08-05", -19000),
    ];
    const before = sourcesByMonth(traced(rows(250000)), two);
    expect(line(before[1], "paidInCents")).toEqual([20000, 0, 250000]);
    expect(line(before[0], "costsCents")).toEqual([1407, 0, 17593]);
    const after = sourcesByMonth(traced(rows(250000), 0, [{ kind: "in", key: "g:text:ESIMERKKI OY", owner: VILLE }]), two);
    expect(line(after[1], "paidInCents")).toEqual([20000, 250000, 0]);
    expect(line(after[0], "costsCents")).toEqual([1407, 17593, 0]);
    expect(line(after[0], "leftCents")).toEqual([18593, 232407, 0]);
    // near miss: below the sum the app asks about it is not a lot of its own, and the costs fall on the members
    const small = sourcesByMonth(traced(rows(9999)), two);
    expect(line(small[0], "costsCents")).toEqual([19000, 0, 0]);
    expect(line(small[1], "paidInCents")).toEqual([20000, 0, 9999]);
  });
});

describe("a refund and money back are not money in", () => {
  const base = [row("aino", "2026-07-01", 115000, own(AINO)), row("ville", "2026-07-01", 5000, payment(VILLE)), row("mort", "2026-07-03", -110437), row("esim", "2026-07-05", -4563)];

  it("a refund in the month after its purchase makes that month's costs negative and is no money paid in", () => {
    const rows = [...base, row("back", "2026-08-10", 4563, { from: { refundOf: base[3]!.key } })];
    const [aug, jul] = sourcesByMonth(traced(rows), two);
    expect(line(jul, "costsCents")).toEqual([110208, 4792, 0]);
    expect(line(jul, "paidInCents")).toEqual([115000, 5000, 0]);
    expect(line(aug, "costsCents")).toEqual([-4373, -190, 0]);
    expect(line(aug, "paidInCents")).toEqual([0, 0, 0]);
    expect(line(aug, "leftCents")).toEqual([9165, 398, 0]);
    // near miss: the same 45,63 from a payer, not from the shop, is money paid in
    const paid = sourcesByMonth(traced([...base, row("gift", "2026-08-10", 4563, own(AINO))]), two)[0];
    expect(line(paid, "paidInCents")).toEqual([4563, 0, 0]);
    expect(line(paid, "costsCents")).toEqual([0, 0, 0]);
  });

  it("money back with no pair is the same, by the mix of the day before", () => {
    const [aug] = sourcesByMonth(traced([...base, row("back", "2026-08-10", 100, { from: "back" })]), two);
    expect(line(aug, "costsCents")).toEqual([-96, -4, 0]);
    expect(line(aug, "paidInCents")).toEqual([0, 0, 0]);
  });

  it("a refund in the month of its purchase takes the cost back inside the month", () => {
    const [jul] = sourcesByMonth(traced([...base, row("back", "2026-07-20", 2000, { from: { refundOf: base[3]!.key } })]), two);
    expect(line(jul, "costsCents")).toEqual([108291, 4709, 0]);
    expect(sum(line(jul, "costsCents"))).toBe(110437 + 4563 - 2000);
  });

  it("money out for one person and to another pool is moved, not a cost", () => {
    const rows = [...base, row("pay", "2026-07-08", -3000, forOne(VILLE)), row("pool", "2026-07-09", -1000, { to: "pool" })];
    const jul = sourcesByMonth(traced(rows), two)[0];
    expect(sum(line(jul, "movedCents"))).toBe(4000);
    expect(sum(line(jul, "costsCents"))).toBe(110437 + 4563);
  });
});

describe("a member who pays all the money in, one who takes some out, and one who never touches the pool", () => {
  it("S17: the payer bears the shared bills whole; what the other takes is passed, never a cost of the payer", () => {
    const rows = [row("in", "2026-09-01", 100000, own(AINO)), row("take", "2026-09-03", -30000, forOne(VILLE)), row("visa", "2026-09-04", -8000, forOne(VILLE)), row("rent", "2026-09-05", -60000)];
    const sep = sourcesByMonth(traced(rows), two)[0];
    expect(line(sep, "paidInCents")).toEqual([100000, 0, 0]);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
    expect(line(sep, "movedCents")).toEqual([38000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 38000, 0]);
    expect(line(sep, "leftCents")).toEqual([2000, 0, 0]);
  });

  it("S17 near miss: what the taker paid in himself he takes back as his own, and only the rest is passed", () => {
    const rows = [row("in", "2026-09-01", 100000, own(AINO)), row("his", "2026-09-02", 20000, own(VILLE)), row("take", "2026-09-03", -30000, forOne(VILLE)), row("visa", "2026-09-04", -8000, forOne(VILLE)), row("rent", "2026-09-05", -60000)];
    const sep = sourcesByMonth(traced(rows), two)[0];
    expect(line(sep, "paidInCents")).toEqual([100000, 20000, 0]);
    expect(line(sep, "movedCents")).toEqual([18000, 20000, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 18000, 0]);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
    expect(line(sep, "leftCents")).toEqual([22000, 0, 0]);
  });

  it("S18: a member who never touches the pool bears 0,00 of every bill, and the account's rows stay whole", () => {
    const rows = [row("in", "2026-09-01", 90000, own(AINO)), row("power", "2026-09-03", -40000), row("water", "2026-09-04", -25000)];
    const t = traced(rows);
    const sep = sourcesByMonth(t, two)[0];
    expect(line(sep, "costsCents")).toEqual([65000, 0, 0]);
    expect(line(sep, "leftCents")).toEqual([25000, 0, 0]);
    // his own view of each bill is nothing; the rows themselves are whole
    const half = { from: 1, to: 2, of: 2 };
    for (const label of ["power", "water"]) {
      const r = t.rows.find((x) => x.ids[0] === label)!;
      expect(shareOf(r, VILLE, half, () => false).cents).toBe(0);
      expect(shareOf(r, AINO, { from: 0, to: 1, of: 2 }, () => false).cents).toBe(r.cents);
    }
    expect(t.rows.map((r) => r.cents)).toEqual([90000, -40000, -25000]);
    // near miss: he pays in 100,00 first, and bears his share of what the money was
    const paid = sourcesByMonth(traced([row("his", "2026-09-01", 10000, own(VILLE)), ...rows]), two)[0];
    expect(line(paid, "costsCents")).toEqual([58500, 6500, 0]);
    expect(line(paid, "leftCents")).toEqual([31500, 3500, 0]);
  });
});

describe("what a member took of the other's money, when the pool was short and the money came after", () => {
  const credit = (label: string, date: string, cents: number) => row(label, date, -cents, forOne(VILLE));

  it("his credit is paid on 31.8., her money comes on 1.9.: he took 350,00 of hers all the same", () => {
    const [sep, aug] = sourcesByMonth(traced([credit("credit", "2026-08-31", 35000), row("in", "2026-09-01", 100000, own(AINO))]), two);
    // the row is hers once her money has paid it, and her August ends below zero
    expect(line(aug, "movedCents")).toEqual([35000, 0, 0]);
    expect(line(aug, "takenCents")).toEqual([0, 35000, 0]);
    expect(line(aug, "leftCents")).toEqual([-35000, 0, 0]);
    expect(line(sep, "leftCents")).toEqual([65000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 0, 0]);
  });

  it("near miss: her money is there on 30.8., the credit is paid on 31.8.: the same 350,00 taken", () => {
    const [aug] = sourcesByMonth(traced([row("in", "2026-08-30", 100000, own(AINO)), credit("credit", "2026-08-31", 35000)]), two);
    expect(line(aug, "movedCents")).toEqual([35000, 0, 0]);
    expect(line(aug, "takenCents")).toEqual([0, 35000, 0]);
  });

  it("S19: his own credit paid from the pool: his own 100,00 is no taking, the 250,00 that waited for her money is", () => {
    const rows = [row("his", "2026-09-01", 10000, payment(VILLE)), credit("credit", "2026-09-05", 35000), row("in", "2026-10-01", 100000, own(AINO))];
    const [oct, sep] = sourcesByMonth(traced(rows), two);
    expect(line(sep, "paidInCents")).toEqual([0, 10000, 0]);
    expect(line(sep, "movedCents")).toEqual([25000, 10000, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 25000, 0]);
    expect(line(sep, "leftCents")).toEqual([-25000, 0, 0]);
    expect(line(oct, "leftCents")).toEqual([75000, 0, 0]);
  });

  it("S17: the bills and his takings wait for her money; she bears the bill whole and he took 380,00 of hers", () => {
    const rows = [credit("loan", "2026-09-03", 30000), credit("visa", "2026-09-04", 8000), row("rent", "2026-09-05", -60000), row("in", "2026-10-01", 100000, own(AINO))];
    const [oct, sep] = sourcesByMonth(traced(rows), two);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
    expect(line(sep, "movedCents")).toEqual([38000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 38000, 0]);
    expect(line(sep, "leftCents")).toEqual([-98000, 0, 0]);
    expect(line(oct, "paidInCents")).toEqual([100000, 0, 0]);
    expect(line(oct, "leftCents")).toEqual([2000, 0, 0]);
    // near miss: with nobody else's money in the pool he took nothing from anybody
    const alone = sourcesByMonth(traced([row("his", "2026-09-01", 50000, own(VILLE)), credit("visa", "2026-09-04", 8000)]), two)[0];
    expect(line(alone, "takenCents")).toEqual([0, 0, 0]);
  });
});

describe("a refund of a row for one person comes off what that row was counted in", () => {
  const base = [row("in", "2026-09-01", 100000, own(AINO)), row("visa", "2026-09-04", -8000, forOne(VILLE)), row("rent", "2026-09-05", -60000)];
  const refund = (date: string, cents = 8000, of = base[1]!) => row("ref" + date, date, cents, { from: { refundOf: of.key } });

  it("near miss: no refund: she bore 600,00, 80,00 was moved and he took 80,00", () => {
    const [sep] = sourcesByMonth(traced(base), two);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
    expect(line(sep, "movedCents")).toEqual([8000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 8000, 0]);
  });

  it("in the same month: Menot stays 600,00, nothing is moved or taken, the balance is 400,00", () => {
    const [sep] = sourcesByMonth(traced([...base, refund("2026-09-20")]), two);
    expect(line(sep, "paidInCents")).toEqual([100000, 0, 0]);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
    expect(line(sep, "movedCents")).toEqual([0, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 0, 0]);
    expect(line(sep, "leftCents")).toEqual([40000, 0, 0]);
  });

  it("in the month after: the earlier month keeps 80,00 moved and taken, the later one takes them back and has no Menot", () => {
    const [oct, sep] = sourcesByMonth(traced([...base, refund("2026-10-02")]), two);
    expect(line(sep, "movedCents")).toEqual([8000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 8000, 0]);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
    expect(line(oct, "movedCents")).toEqual([-8000, 0, 0]);
    expect(line(oct, "takenCents")).toEqual([0, -8000, 0]);
    expect(line(oct, "costsCents")).toEqual([0, 0, 0]);
    expect(line(oct, "paidInCents")).toEqual([0, 0, 0]);
    expect(line(oct, "leftCents")).toEqual([40000, 0, 0]);
    expect(line(sep, "leftCents")).toEqual([32000, 0, 0]);
  });

  it("a refund of 30,00 takes 30,00 back and the rest stays moved and taken", () => {
    const [sep] = sourcesByMonth(traced([...base, refund("2026-09-20", 3000)]), two);
    expect(line(sep, "movedCents")).toEqual([5000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 5000, 0]);
    expect(line(sep, "costsCents")).toEqual([60000, 0, 0]);
  });

  it("near miss: a refund of a shared purchase still comes off Menot", () => {
    const [sep] = sourcesByMonth(traced([...base, refund("2026-09-20", 10000, base[2]!)]), two);
    expect(line(sep, "costsCents")).toEqual([50000, 0, 0]);
    expect(line(sep, "movedCents")).toEqual([8000, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 8000, 0]);
  });

  it("near miss: a row he paid with his own money gives it back as his own: moved comes down, nothing was taken", () => {
    const rows = [row("his", "2026-09-01", 10000, payment(VILLE)), row("visa", "2026-09-04", -8000, forOne(VILLE))];
    const [sep] = sourcesByMonth(traced([...rows, row("ref", "2026-09-20", 8000, { from: { refundOf: rows[1]!.key } })]), two);
    expect(line(sep, "movedCents")).toEqual([0, 0, 0]);
    expect(line(sep, "takenCents")).toEqual([0, 0, 0]);
    expect(line(sep, "leftCents")).toEqual([0, 10000, 0]);
  });

  it("a refund of a row paid on credit, before her money came: the sums of the month stay", () => {
    const rows = [row("visa", "2026-09-04", -8000, forOne(VILLE))];
    const t = traced([...rows, row("ref", "2026-09-10", 8000, { from: { refundOf: rows[0]!.key } }), row("in", "2026-09-20", 50000, own(AINO))]);
    const [sep] = sourcesByMonth(t, two);
    expect(sum(line(sep, "movedCents"))).toBe(0);
    expect(sum(line(sep, "takenCents"))).toBe(0);
    expect(sum(line(sep, "leftCents"))).toBe(50000);
  });
});

describe("a row only one of two copies has is no part of the months", () => {
  it("is left out, and a month with only such rows is not listed", () => {
    const rows = [row("in", "2026-07-01", 100000, own(AINO)), row("copy", "2026-08-05", 25000, { unmatched: true }), row("shop", "2026-07-05", -10000)];
    const months = sourcesByMonth(traced(rows), two);
    expect(months.map((m) => m.month)).toEqual(["2026-07"]);
    expect(line(months[0], "paidInCents")).toEqual([100000, 0, 0]);
  });

  it("near miss: a payee really named UNMATCHED, folded to upper case, is money in of unknown kind and shows", () => {
    const rows = [row("in", "2026-07-01", 100000, own(AINO)), row("payee", "2026-08-05", 25000, { group: "g:text:UNMATCHED" })];
    const months = sourcesByMonth(traced(rows), two);
    expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-07"]);
    expect(line(months[0], "paidInCents")).toEqual([0, 0, 25000]);
    expect(line(months[0], "leftCents")).toEqual([100000, 0, 25000]);
  });
});

describe("the months listed", () => {
  const base = [row("aino", "2026-05-01", 100000, own(AINO)), row("shop", "2026-05-02", -10000), row("shop2", "2026-07-02", -20000)];

  it("lists the months with a booked row, newest first, and none between", () => {
    const months = sourcesByMonth(traced(base), two);
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-05"]);
    // June has no row: May's balance is what July began with
    expect(line(months[0], "leftCents")).toEqual([70000, 0, 0]);
    expect(line(months[1], "leftCents")).toEqual([90000, 0, 0]);
  });

  it("counts no pending row, and a month of pending rows only is not listed", () => {
    const months = sourcesByMonth(traced([...base, row("wait", "2026-07-10", -5000, { pending: true }), row("wait2", "2026-08-10", -5000, { pending: true })]), two);
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-05"]);
    expect(line(months[0], "costsCents")).toEqual([20000, 0, 0]);
    expect(line(months[0], "leftCents")).toEqual([70000, 0, 0]);
  });

  it("gives a column to each of three members and one to the rest", () => {
    const rows = [row("a", "2026-05-01", 30000, own(AINO)), row("v", "2026-05-01", 30000, own(VILLE)), row("c", "2026-05-01", 30000, own(CECILIA)), row("shop", "2026-05-02", -9000)];
    const month = sourcesByMonth(traced(rows, 0, [], [AINO, VILLE, CECILIA]), [AINO, VILLE, CECILIA])[0]!;
    expect(month.columns.map((c) => c.owner)).toEqual([AINO, VILLE, CECILIA, null]);
    expect(line(month, "costsCents")).toEqual([3000, 3000, 3000, 0]);
    expect(line(month, "leftCents")).toEqual([27000, 27000, 27000, 0]);
    // a member who is not among the users given is in the column of the rest
    expect(line(sourcesByMonth(traced(rows, 0, [], [AINO, VILLE, CECILIA]), two)[0], "paidInCents")).toEqual([30000, 30000, 30000]);
  });

  it("lists nothing for a history with no booked row", () => {
    const rows = [row("wait", "2026-07-10", -5000, { pending: true }), row("zero", "2026-07-11", 0)];
    expect(sourcesByMonth(settle(trace(rows, 0, d("2026-07-10")), [], weights(two)), two)).toEqual([]);
  });
});

describe("a random history of 300 rows", () => {
  /** The rows of one seed: money in of every kind, costs, a refund, money back, money for one person and to a pool, some pending. */
  function history(seed: number): TraceRow[] {
    const next = rng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    const rows: TraceRow[] = [];
    const purchases: TraceRow[] = [];
    for (let i = 0; i < 300; i++) {
      const date = fromDayNumber(d("2026-01-01") + Math.floor(next() * 200));
      const cents = 100 + Math.floor(next() * 90000);
      const pending = next() < 0.05 ? { pending: true as const } : {};
      const kind = next();
      let r: TraceRow;
      if (kind < 0.2) r = row(`own${i}`, date, cents, { ...own(pick(two)), ...pending });
      else if (kind < 0.28) r = row(`pay${i}`, date, cents, { ...payment(pick(two)), ...pending });
      else if (kind < 0.36) r = row(`unk${i}`, date, cents, { group: pick(["g:text:ESIMERKKI OY", "g:text:KAUPPA OY", "g:iban:FI9900000000000009"]), ...pending });
      else if (kind < 0.42 && purchases.length) r = row(`ref${i}`, date, 100 + Math.floor(next() * 5000), { from: { refundOf: pick(purchases).key }, ...pending });
      else if (kind < 0.46) r = row(`back${i}`, date, 100 + Math.floor(next() * 2000), { from: "back", ...pending });
      else if (kind < 0.56) r = row(`one${i}`, date, -cents, { ...forOne(pick(two)), ...pending });
      else if (kind < 0.6) r = row(`pool${i}`, date, -cents, { to: "pool", ...pending });
      else {
        r = row(`cost${i}`, date, -cents, pending);
        if (!r.pending) purchases.push(r);
      }
      // a row for one person can be refunded too
      if (kind >= 0.46 && kind < 0.56 && !r.pending) purchases.push(r);
      rows.push(r);
    }
    return rows;
  }

  /** Every property of the months, against the rows and the lots and not against the code that made the months. */
  function expectMonths(t: Trace, months: MonthSources[], rows: readonly TraceRow[], opening: number, owners: readonly string[]) {
    const booked = rows.filter((r) => !r.pending);
    const monthKey = (day: number) => fromDayNumber(day).slice(0, 7);
    expect(months.map((m) => m.month)).toEqual([...new Set(booked.map((r) => monthKey(r.day)))].sort().reverse());
    for (const m of months) {
      const mine = booked.filter((r) => monthKey(r.day) === m.month);
      const parts = t.rows.filter((r) => !r.pending && monthKey(r.day) === m.month);
      // what the refunds gave back: of rows for one person (not money back by the mix) and of every other
      const gaveBack = (ofOne: boolean) =>
        parts.filter((r) => r.what === "in").flatMap((r) => r.parts.filter((p) => !["own", "payment", "pool", "unknown"].includes(p.kind) && (r.refundFor !== undefined && p.kind !== "back") === ofOne).map((p) => ({ ...p, refundFor: r.refundFor })));
      const refunded = sum(gaveBack(false).map((p) => p.cents));
      const refundedOne = sum(gaveBack(true).map((p) => p.cents));
      // what the rows for one person took of another member's money, less what their refunds gave back
      const another = (p: { owner: string }, to: string | undefined) => p.owner.startsWith("u:") && p.owner !== to;
      const taken = sum(parts.filter((r) => r.what === "one").flatMap((r) => r.parts.filter((p) => another(p, r.to)).map((p) => p.cents))) - sum(gaveBack(true).filter((p) => another(p, p.refundFor)).map((p) => p.cents));
      const col = (f: Figure) => sum(line(m, f));
      // money in: what was paid in and what the refunds gave back are the rows of money in, whole
      expect(col("paidInCents") + refunded + refundedOne, m.month).toBe(sum(mine.filter((r) => r.cents > 0).map((r) => r.cents)));
      expect(col("costsCents") + refunded, m.month).toBe(0 - sum(mine.filter((r) => r.cents < 0 && !r.to).map((r) => r.cents)));
      expect(col("movedCents") + refundedOne, m.month).toBe(0 - sum(mine.filter((r) => r.cents < 0 && r.to).map((r) => r.cents)));
      // what is left, at the month's end, is the walked balance
      const walked = opening + sum(booked.filter((r) => monthKey(r.day) <= m.month).map((r) => r.cents));
      expect(col("leftCents"), m.month).toBe(walked);
      expect(m.columns.map((c) => c.owner)).toEqual([...owners, null]);
      // what was taken is every part of a row for one person that was another member's money, whether the pool was short or not
      expect(col("takenCents"), m.month).toBe(taken);
    }
  }

  it.each([1, 2, 3])("adds up in every month (seed %i)", (seed) => {
    const rows = history(seed);
    const t = traced(rows, 25000 * seed - 40000);
    expectMonths(t, sourcesByMonth(t, two), rows, 25000 * seed - 40000, two);
  });

  it("adds up with an opening below zero", () => {
    const rows = history(4);
    const t = traced(rows, -454_37);
    expect(t.before.length + t.creditCents).toBeGreaterThanOrEqual(0);
    expectMonths(t, sourcesByMonth(t, two), rows, -454_37, two);
  });

  it("adds up with the opening and the unknown money answered Yhteistä, and with each answer the sums stay", () => {
    const rows = history(5);
    const plain = sourcesByMonth(traced(rows, 150000), two);
    for (const owner of ["all", AINO, VILLE, "none"]) {
      const answers: Answer[] = [{ kind: "opening", key: "o", owner }, ...["g:text:ESIMERKKI OY", "g:text:KAUPPA OY", "g:iban:FI9900000000000009"].map((key): Answer => ({ kind: "in", key, owner })) ];
      const t = traced(rows, 150000, answers);
      const months = sourcesByMonth(t, two);
      expectMonths(t, months, rows, 150000, two);
      // the row sums stay: only the columns move
      for (const f of ["paidInCents", "costsCents", "movedCents", "leftCents"] as const) expect(months.map((m) => sum(line(m, f))), `${owner} ${f}`).toEqual(plain.map((m) => sum(line(m, f))));
    }
  });

  it("adds up with three members", () => {
    const rows = history(6).map((r, i) => (typeof r.from === "object" && "owner" in r.from && i % 3 === 0 ? { ...r, from: { ...r.from, owner: CECILIA } } : r));
    const owners = [AINO, VILLE, CECILIA];
    const t = traced(rows, 90000, [], owners);
    expectMonths(t, sourcesByMonth(t, owners), rows, 90000, owners);
  });

  it("gives the same months for the rows in any order", () => {
    const rows = history(7);
    const base = sourcesByMonth(traced(rows, 0), two);
    const next = rng(99);
    for (let k = 0; k < 20; k++) expect(sourcesByMonth(traced([...rows].sort(() => next() - 0.5), 0), two)).toEqual(base);
  });
});
