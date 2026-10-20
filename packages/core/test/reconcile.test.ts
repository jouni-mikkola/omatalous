/**
 * Täsmää pankin saldoon: the stored rows against the bank's own booked balances, to the cent. Made-up household
 * (Käyttötili of Matti Meikalainen, checking, EUR), made-up sums.
 */
import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates.ts";
import { compactReconcile, reconcile, type ReconcileBalance } from "../src/reconcile.ts";

type ReconcileRow = Parameters<typeof reconcile>[1][number];

const ACCOUNT = { type: "checking", currency: "EUR" } as const;
const TODAY = "2026-10-16";
const FROM = "2026-09-01";

/** A balance of the given type for a reference day, fetched the day after it unless said otherwise. */
const bal = (ref: string | null, cents: number, over: Partial<ReconcileBalance> = {}): ReconcileBalance => ({
  day: ref === null ? "2026-10-01" : addDays(ref, 1),
  type: "CLBD",
  referenceDate: ref,
  cents,
  fetchedAt: `${ref === null ? "2026-10-01" : addDays(ref, 1)}T06:00:00.000Z`,
  source: "bank",
  ...over,
});
const row = (bookingDate: string, amountCents: number, over: Partial<ReconcileRow> = {}): ReconcileRow => ({ bookingDate, amountCents, status: "booked", importedAt: `${bookingDate}T20:00:00.000Z`, ...over });
const run = (rows: ReconcileRow[], balances: ReconcileBalance[], over: { historyFrom?: string | null; foreignDays?: string[] } = {}) =>
  reconcile(ACCOUNT, rows, balances, { historyFrom: FROM, foreignDays: [], today: TODAY, ...over })!;

/** Case A: 1 200,00 on 30.9., 1 887,50 on 7.10.; money out, in and a refund between them. */
const A_ANCHORS = [bal("2026-09-30", 120000), bal("2026-10-07", 188750)];
const A_ROWS = [row("2026-10-02", -4550), row("2026-10-03", -12000), row("2026-10-04", 2500), row("2026-10-05", 90000), row("2026-10-06", -7200)];
/** Case B's rows after 7.10.: two coffees of the same sum, so the sum is -67,00. */
const B_ROWS = [row("2026-10-08", -1000), row("2026-10-09", -350), row("2026-10-09", -350), row("2026-10-12", -5000)];

describe("reconcile: the worked cases", () => {
  it("A: money in, out and a refund add up to the bank's change, so the stretch is proved", () => {
    const r = run(A_ROWS, A_ANCHORS);
    expect(r).toMatchObject({ type: "CLBD", status: "proved", reason: null, provedFrom: "2026-10-01", provedTo: "2026-10-07", lastMatchedTo: "2026-10-07" });
    expect(r.intervals).toEqual([{ fromDay: "2026-10-01", toDay: "2026-10-07", deltaCents: 68750, sumCents: 68750, diffCents: 0, state: "matched", mark: null, reason: null, hint: null }]);
  });

  it("B: one cent off is a difference, whichever way, and the stretch is empty", () => {
    const high = run([...A_ROWS, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 182051)]);
    expect(high).toMatchObject({ status: "differs", provedFrom: null, provedTo: null, lastMatchedTo: "2026-10-07" });
    expect(high.intervals.map((i) => [i.state, i.diffCents])).toEqual([["matched", 0], ["differs", 1]]);
    expect(high.intervals[1]).toMatchObject({ deltaCents: -6699, sumCents: -6700 });
    const low = run([...A_ROWS, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 182049)]);
    expect(low.intervals[1]).toMatchObject({ state: "differs", diffCents: -1 });
    const exact = run([...A_ROWS, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 182050)]);
    expect(exact).toMatchObject({ status: "proved", provedFrom: "2026-10-01", provedTo: "2026-10-14" });
  });

  it("C: a late booking is a difference until the next balance holds it, then the pair is one matched stretch marked late", () => {
    const late = row("2026-10-05", -3000, { importedAt: "2026-10-09T08:00:00.000Z" });
    const rows = [...A_ROWS, late, ...B_ROWS];
    const lone = run(rows, A_ANCHORS);
    expect(lone.intervals).toMatchObject([{ state: "differs", diffCents: 3000 }]);
    expect(lone).toMatchObject({ status: "differs", provedFrom: null });
    const pair = run(rows, [...A_ANCHORS, bal("2026-10-14", 179050)]);
    expect(pair).toMatchObject({ status: "proved", provedFrom: "2026-10-01", provedTo: "2026-10-14", lastMatchedTo: "2026-10-14" });
    expect(pair.intervals).toEqual([{ fromDay: "2026-10-01", toDay: "2026-10-14", deltaCents: 68750 - 9700, sumCents: 65750 - 6700, diffCents: 0, state: "matched", mark: "late", reason: null, hint: null }]);
  });

  it("C near misses: +30,00 against -29,99 does not merge; a cancelling pair with no late row is neutral", () => {
    const late = row("2026-10-05", -3000, { importedAt: "2026-10-09T08:00:00.000Z" });
    const off = run([...A_ROWS, late, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 179051)]);
    expect(off.status).toBe("differs");
    expect(off.intervals.map((i) => [i.state, i.diffCents])).toEqual([["differs", 3000], ["differs", -2999]]);
    // the row was there before the first balance was fetched, so nothing says it came late
    const early = run([...A_ROWS, row("2026-10-05", -3000), ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 179050)]);
    expect(early.intervals).toHaveLength(1);
    expect(early.intervals[0]).toMatchObject({ state: "matched", mark: "evens" });
    // a late row of another sum than the difference is no cause either
    const other = run([...A_ROWS, row("2026-10-05", -2000, { importedAt: "2026-10-09T08:00:00.000Z" }), ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 179050)]);
    expect(other.intervals[0]).toMatchObject({ state: "differs", diffCents: 2000 });
  });

  it("D: a balance of a day that was not over when fetched is no anchor; the next day's fetch matches", () => {
    const rows = [...A_ROWS, ...B_ROWS];
    const sameDay = run(rows, [...A_ANCHORS, bal("2026-10-14", 182050, { day: "2026-10-14", fetchedAt: "2026-10-14T09:00:00.000Z" })]);
    expect(sameDay.intervals).toHaveLength(1);
    expect(sameDay).toMatchObject({ status: "proved", provedTo: "2026-10-07" });
    const next = run([...rows, row("2026-10-14", -200)], [...A_ANCHORS, bal("2026-10-14", 181850)]);
    expect(next).toMatchObject({ status: "proved", provedTo: "2026-10-14" });
  });
});

describe("reconcile: which balances prove", () => {
  it("CLBD and ITBD of the fetch day never prove, OPBD of the fetch day does (its day is yesterday)", () => {
    const same = (type: string) => [bal("2026-09-30", 120000, { type }), bal("2026-10-07", 188750, { type, day: "2026-10-07", fetchedAt: "2026-10-07T09:00:00.000Z" })];
    expect(run(A_ROWS, same("CLBD"))).toMatchObject({ type: null, reason: "too_few" });
    expect(run(A_ROWS, same("ITBD"))).toMatchObject({ type: null, reason: "too_few" });
    // OPBD ref 1.10. is the end of 30.9.; ref 8.10. fetched that day is the end of 7.10.
    const opbd = [bal("2026-10-01", 120000, { type: "OPBD" }), bal("2026-10-08", 188750, { type: "OPBD", day: "2026-10-08", fetchedAt: "2026-10-08T05:00:00.000Z" })];
    expect(run(A_ROWS, opbd)).toMatchObject({ type: "OPBD", status: "proved", provedFrom: "2026-10-01", provedTo: "2026-10-07" });
  });

  it("an ITBD proves when it was fetched on a later day than its reference day", () => {
    expect(run(A_ROWS, A_ANCHORS.map((b) => ({ ...b, type: "ITBD" })))).toMatchObject({ type: "ITBD", status: "proved" });
  });

  it("two types on one day: the ITBD of the fetch day is no anchor, CLBD and OPBD are separate series", () => {
    const itbd = bal("2026-10-08", 187750, { type: "ITBD", day: "2026-10-08", fetchedAt: "2026-10-08T07:00:00.000Z" });
    const opbd = bal("2026-10-08", 188750, { type: "OPBD", day: "2026-10-08", fetchedAt: "2026-10-08T07:00:00.000Z" });
    const r = run(A_ROWS, [...A_ANCHORS, itbd, opbd]);
    expect(r).toMatchObject({ type: "CLBD", status: "proved", provedTo: "2026-10-07", reason: null });
    expect(r.intervals).toHaveLength(1);
    // the CLBD of 30.9. and the OPBD ending 7.10. are never joined into one interval
    const mixed = run(A_ROWS, [A_ANCHORS[0]!, opbd]);
    expect(mixed).toMatchObject({ type: null, reason: "type_changed", intervals: [] });
  });

  it("XPCD, CLAV and ITAV never prove: the reason says only the available balance is stored", () => {
    for (const type of ["ITAV", "XPCD", "CLAV", "OTHR"]) {
      const r = run(A_ROWS, A_ANCHORS.map((b) => ({ ...b, type })));
      expect(r).toMatchObject({ type: null, status: "unknown", reason: "only_available", intervals: [] });
    }
  });

  it("a seed balance never proves and is no reason of its own", () => {
    expect(run(A_ROWS, A_ANCHORS.map((b) => ({ ...b, source: "seed" })))).toMatchObject({ type: null, reason: "too_few" });
    // a demo balance does prove
    expect(run(A_ROWS, A_ANCHORS.map((b) => ({ ...b, source: "demo" })))).toMatchObject({ status: "proved" });
  });

  it("a balance with no usable reference day is no anchor; the reason is named when it would have made a pair", () => {
    const noDay = A_ANCHORS.map((b, i) => bal(null, b.cents, { day: i ? "2026-10-08" : "2026-10-01" }));
    expect(run(A_ROWS, noDay)).toMatchObject({ type: null, reason: "no_reference_day" });
    expect(run(A_ROWS, [A_ANCHORS[0]!, bal(null, 188750, { day: "2026-10-08" })])).toMatchObject({ reason: "no_reference_day" });
    // a reference day after the day it was fetched, or one that is no date, is no day either
    expect(run(A_ROWS, [A_ANCHORS[0]!, bal("2026-10-12", 188750, { day: "2026-10-08" })])).toMatchObject({ reason: "no_reference_day" });
    expect(run(A_ROWS, [A_ANCHORS[0]!, bal("2026-02-31", 188750, { day: "2026-10-08" })])).toMatchObject({ reason: "no_reference_day" });
    // near miss: a single balance without one could not have made a pair
    expect(run(A_ROWS, [bal(null, 188750)])).toMatchObject({ reason: "too_few" });
    // a missing day of another type does not make a pair with this type's anchor
    expect(run(A_ROWS, [A_ANCHORS[0]!, bal(null, 188750, { type: "ITBD" })])).toMatchObject({ reason: "too_few" });
  });

  it("an ITBD-only bank (interim balances dated the day they were fetched) gives too few balances, never a difference", () => {
    const interim = ["2026-10-02", "2026-10-03", "2026-10-04"].map((d) => bal(d, 150000, { type: "ITBD", day: d, fetchedAt: `${d}T09:00:00.000Z` }));
    expect(run(A_ROWS, interim)).toMatchObject({ type: null, status: "unknown", reason: "too_few" });
    expect(run(A_ROWS, [])).toMatchObject({ reason: "too_few" });
  });

  it("a booked balance dated the fetch day beside the available one gives too few balances, not only the available balance", () => {
    for (const type of ["ITBD", "CLBD"]) {
      const sameDay = (d: string, cents: number) => [bal(d, cents, { type, day: d, fetchedAt: `${d}T09:00:00.000Z` }), bal(d, cents, { type: "ITAV", day: d, fetchedAt: `${d}T09:00:00.000Z` })];
      expect(run(A_ROWS, [...sameDay("2026-10-04", 100), ...sameDay("2026-10-05", 90)])).toMatchObject({ type: null, status: "unknown", reason: "too_few" });
    }
    // near miss: the available balance alone is still only that
    expect(run(A_ROWS, [bal("2026-10-04", 100, { type: "ITAV", day: "2026-10-04" })])).toMatchObject({ reason: "only_available" });
  });

  it("anchors of two types with none of two of one: the type changed", () => {
    expect(run(A_ROWS, [A_ANCHORS[0]!, { ...A_ANCHORS[1]!, type: "ITBD" }])).toMatchObject({ type: null, reason: "type_changed", intervals: [] });
  });

  it("a bank that switches from CLBD to ITBD: the CLBD result stands, the days after say the type changed", () => {
    const r = run(A_ROWS, [...A_ANCHORS, bal("2026-10-14", 182050, { type: "ITBD" })]);
    expect(r).toMatchObject({ type: "CLBD", status: "proved", reason: "type_changed", provedTo: "2026-10-07" });
    expect(r.intervals).toHaveLength(1);
  });

  it("a CLBD series of two old anchors is chosen over a newer ITBD series, and says the type changed", () => {
    const itbd = [bal("2026-10-10", 170000, { type: "ITBD" }), bal("2026-10-14", 169000, { type: "ITBD" })];
    const r = run([...A_ROWS, row("2026-10-12", -1000)], [...A_ANCHORS, ...itbd]);
    expect(r).toMatchObject({ type: "CLBD", status: "proved", provedTo: "2026-10-07", reason: "type_changed" });
    expect(r.intervals).toHaveLength(1);
  });

  it("per type and reference day the bank's last word counts, and a balance with a later reference day is another anchor", () => {
    const first = bal("2026-10-07", 188700, { fetchedAt: "2026-10-08T06:00:00.000Z" });
    const last = bal("2026-10-07", 188750, { fetchedAt: "2026-10-09T06:00:00.000Z", day: "2026-10-09" });
    expect(run(A_ROWS, [A_ANCHORS[0]!, last, first])).toMatchObject({ status: "proved", provedTo: "2026-10-07" });
    expect(run(A_ROWS, [A_ANCHORS[0]!, first, last]).intervals[0]!.deltaCents).toBe(68750);
    // the one that was dropped for being same-day does not stand in for the closed one
    const sameDay = bal("2026-10-07", 111111, { day: "2026-10-07", fetchedAt: "2026-10-07T23:00:00.000Z" });
    expect(run(A_ROWS, [A_ANCHORS[0]!, sameDay, A_ANCHORS[1]!]).intervals[0]!.deltaCents).toBe(68750);
  });

  it("a balance fetched after today is no anchor", () => {
    const r = run(A_ROWS, [...A_ANCHORS, bal("2026-10-20", 1, { day: "2026-10-21", fetchedAt: "2026-10-21T06:00:00.000Z" })]);
    expect(r.intervals).toHaveLength(1);
  });
});

describe("reconcile: which rows count", () => {
  it("only the booking date counts: the day of an interval's end is in it, the day after is in the next", () => {
    const rows = [...A_ROWS.filter((r) => r.bookingDate !== "2026-10-06"), row("2026-10-07", -7200), row("2026-10-08", -1000)];
    const r = run(rows, [...A_ANCHORS, bal("2026-10-08", 187750)]);
    expect(r.intervals.map((i) => [i.state, i.sumCents])).toEqual([["matched", 68750], ["matched", -1000]]);
    // the day of the first anchor belongs to it, not to the interval after
    const before = run([...A_ROWS, row("2026-09-30", -9999)], A_ANCHORS);
    expect(before.status).toBe("proved");
  });

  it("twin rows of one sum both count; a missing twin is a difference of one row's sum with a hint, and nothing is added back", () => {
    const all = run([...A_ROWS, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 182050)]);
    expect(all.intervals[1]!.sumCents).toBe(-6700);
    const dropped = run([...A_ROWS, ...B_ROWS.slice(0, 2), B_ROWS[3]!], [...A_ANCHORS, bal("2026-10-14", 182050)]);
    expect(dropped.intervals[1]).toMatchObject({ state: "differs", diffCents: -350, sumCents: -6350, hint: "one_row" });
    // a difference that is no row's sum has no hint
    expect(run([...A_ROWS, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 182051)]).intervals[1]!.hint).toBeNull();
  });

  it("a pending row is ignored; booked in a later fetch it counts from then", () => {
    const pending = row("2026-10-06", -7200, { status: "pending" });
    const without = A_ROWS.filter((r) => r.bookingDate !== "2026-10-06");
    expect(run([...without, pending], A_ANCHORS)).toMatchObject({ status: "differs" });
    expect(run([...without, { ...pending, status: "booked" }], A_ANCHORS)).toMatchObject({ status: "proved" });
  });
});

describe("reconcile: coverage, foreign rows and the walk", () => {
  const three = [bal("2026-09-30", 120000), bal("2026-10-07", 188750), bal("2026-10-14", 182050)];
  const rows = [...A_ROWS, ...B_ROWS];

  it("an interval before the first day the rows were asked for is unknown, not a difference", () => {
    // Maija's copy of a joint account asked from 8.10. (the older interval is the rows it never asked for), Matti's from 1.9.
    const maija = run(A_ROWS.slice(0, 2), three, { historyFrom: "2026-10-08" });
    expect(maija.intervals.map((i) => [i.state, i.reason])).toEqual([["unknown", "rows_start_later"], ["differs", null]]);
    const matti = run(rows, three, { historyFrom: "2026-09-01" });
    expect(matti.status).toBe("proved");
    // the first day itself is covered: an interval starting on historyFrom counts
    expect(run(rows, three, { historyFrom: "2026-10-01" }).status).toBe("proved");
    expect(run(rows, three, { historyFrom: "2026-10-02" }).intervals[0]).toMatchObject({ state: "unknown", reason: "rows_start_later" });
    // a start that is not known leaves nothing to say
    expect(run(rows, three, { historyFrom: null })).toMatchObject({ status: "unknown", provedFrom: null });
  });

  it("a differing interval with a row in another currency inside is unknown; a matched one stays matched", () => {
    const withUsd = run([...A_ROWS, ...B_ROWS.slice(0, 3)], three, { foreignDays: ["2026-10-10"] });
    expect(withUsd.intervals[1]).toMatchObject({ state: "unknown", reason: "foreign_rows", hint: null });
    expect(withUsd.status).toBe("unknown");
    expect(run(rows, three, { foreignDays: ["2026-10-10"] })).toMatchObject({ status: "proved", provedFrom: "2026-10-01" });
    // a foreign day outside the interval changes nothing
    expect(run([...A_ROWS, ...B_ROWS.slice(0, 3)], three, { foreignDays: ["2026-10-15"] }).intervals[1]!.state).toBe("differs");
  });

  it("the walk stops at a gap: older matched intervals are listed but are not in the stretch", () => {
    const four = [bal("2026-09-23", 100000), bal("2026-09-30", 120000), bal("2026-10-07", 188750), bal("2026-10-14", 182050)];
    // 23.9.-30.9. holds 10,00 too little: a gap; then two matched intervals
    const gap = run([row("2026-09-25", 19000), ...rows], four);
    expect(gap.intervals.map((i) => i.state)).toEqual(["differs", "matched", "matched"]);
    expect(gap).toMatchObject({ status: "proved", provedFrom: "2026-10-01", provedTo: "2026-10-14" });
    // a gap in the middle leaves only the newest run
    const middle = run([...A_ROWS.slice(0, 4), ...B_ROWS], three);
    expect(middle.intervals.map((i) => i.state)).toEqual(["differs", "matched"]);
    expect(middle).toMatchObject({ status: "proved", provedFrom: "2026-10-08", provedTo: "2026-10-14", lastMatchedTo: "2026-10-14" });
    // the same rows with the missing 10,00 are matched all the way
    expect(run([row("2026-09-25", 20000), ...rows], four).provedFrom).toBe("2026-09-24");
  });

  it("the pair rule comes before the foreign rows: a late booking beside a row in another currency is still one matched stretch", () => {
    const late = row("2026-10-05", -3000, { importedAt: "2026-10-09T08:00:00.000Z" });
    const pair = run([...A_ROWS, late, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 179050)], { foreignDays: ["2026-10-03"] });
    expect(pair).toMatchObject({ status: "proved", provedFrom: "2026-10-01", provedTo: "2026-10-14" });
    expect(pair.intervals).toMatchObject([{ state: "matched", mark: "late", reason: null }]);
    // near miss: the same row in another currency inside a lone difference leaves it unknown
    const lone = run([...A_ROWS, late, ...B_ROWS], [...A_ANCHORS, bal("2026-10-14", 179051)], { foreignDays: ["2026-10-03"] });
    expect(lone.intervals.map((i) => [i.state, i.reason])).toEqual([["unknown", "foreign_rows"], ["differs", null]]);
  });

  it("sums the rows of each interval as a filter over them would, on many days and rows", () => {
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647);
    const days = Array.from({ length: 200 }, (_, i) => addDays("2026-01-01", i));
    const rows = days.flatMap((d) => Array.from({ length: next() % 5 }, () => row(d, (next() % 20001) - 10000)));
    let cents = 0;
    const anchors = days.map((d) => {
      cents += (next() % 3) - 1;
      return bal(d, cents);
    });
    const r = run(rows, anchors, { historyFrom: "2026-01-01" });
    for (const iv of r.intervals) {
      const expected = rows.filter((x) => x.bookingDate >= iv.fromDay && x.bookingDate <= iv.toDay).reduce((n, x) => n + x.amountCents, 0);
      expect(iv.sumCents).toBe(expected);
      expect(iv.diffCents).toBe(iv.deltaCents - iv.sumCents);
    }
  });

  it("matching pairs are taken from the newest back: +x, -x, +x leaves the oldest lone", () => {
    const anchors = [bal("2026-10-01", 100000), bal("2026-10-02", 100100), bal("2026-10-03", 100000), bal("2026-10-04", 100100)];
    const r = run([], anchors, { historyFrom: "2026-10-01" });
    expect(r.intervals.map((i) => [i.fromDay, i.state, i.mark])).toEqual([["2026-10-02", "differs", null], ["2026-10-03", "matched", "evens"]]);
    expect(r).toMatchObject({ status: "proved", provedFrom: "2026-10-03", provedTo: "2026-10-04" });
  });
});

describe("reconcile: a card's debt of either sign", () => {
  const CARD = { type: "credit_card", currency: "EUR" } as const;
  const card = (rows: ReconcileRow[], balances: ReconcileBalance[]) => reconcile(CARD, rows, balances, { historyFrom: FROM, foreignDays: [], today: TODAY })!;
  // purchases of 45,50 and 120,00, then a payment of 100,00 on the card
  const ROWS = [row("2026-10-02", -4550), row("2026-10-03", -12000), row("2026-10-05", 10000)];

  it("a debt told below zero adds up as told", () => {
    expect(card(ROWS, [bal("2026-09-30", -20000), bal("2026-10-07", -26550)])).toMatchObject({ sign: 1, status: "proved", provedFrom: "2026-10-01" });
  });

  it("a debt told as a plus adds up turned, and the sign is learned from the oldest interval that adds up", () => {
    const r = card([...ROWS, row("2026-10-09", -1000)], [bal("2026-09-30", 20000), bal("2026-10-07", 26550), bal("2026-10-10", 27550)]);
    expect(r).toMatchObject({ sign: -1, status: "proved", provedFrom: "2026-10-01", provedTo: "2026-10-10" });
    expect(r.intervals.map((iv) => iv.deltaCents)).toEqual([-6550, -1000]);
  });

  it("only available credit says nothing of the debt", () => {
    expect(card(ROWS, [bal("2026-09-30", 280000, { type: "CLAV" }), bal("2026-10-07", 273450, { type: "ITAV" })])).toMatchObject({ sign: 1, status: "unknown", reason: "only_available" });
  });

  it("intervals with no rows or rows not asked for teach no sign", () => {
    const r = reconcile(CARD, ROWS, [bal("2026-09-30", 20000), bal("2026-10-07", 26550)], { historyFrom: "2026-10-05", foreignDays: [], today: TODAY })!;
    expect(r.sign).toBe(1);
    expect(card([], [bal("2026-09-30", 20000), bal("2026-10-07", 20000)]).sign).toBe(1);
  });
});

describe("reconcile: not reconciled and compacted", () => {
  it("a loan and an account in another currency are not reconciled", () => {
    for (const account of [{ type: "loan", currency: "EUR" }, { type: "checking", currency: "USD" }] as const) {
      expect(reconcile(account, A_ROWS, A_ANCHORS, { historyFrom: FROM, foreignDays: [], today: TODAY })).toBeNull();
    }
    expect(reconcile({ type: "savings", currency: " eur " }, A_ROWS, A_ANCHORS, { historyFrom: FROM, foreignDays: [], today: TODAY })).toMatchObject({ status: "proved" });
    expect(reconcile({ type: "other", currency: "EUR" }, A_ROWS, A_ANCHORS, { historyFrom: FROM, foreignDays: [], today: TODAY })).toMatchObject({ status: "proved" });
  });

  it("compacting folds runs of unknown days for the same reason, whatever their difference", () => {
    // a copy of a joint account linked on 5.10.: every day before it is unknown, then a day that differs and a day that matches
    const anchors = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((d, i) => bal(d, 100000 + [0, 100, 250, 300, 300, 400, 400][i]!));
    const r = run([row("2026-10-07", 0)], anchors, { historyFrom: "2026-10-05" });
    expect(r.intervals.map((i) => i.state)).toEqual(["unknown", "unknown", "unknown", "matched", "differs", "matched"]);
    const compact = compactReconcile(r);
    expect(compact.intervals.map((i) => [i.fromDay, i.toDay, i.state, i.reason, i.deltaCents, i.sumCents, i.diffCents])).toEqual([
      ["2026-10-02", "2026-10-04", "unknown", "rows_start_later", 300, 0, 300],
      ["2026-10-05", "2026-10-05", "matched", null, 0, 0, 0],
      ["2026-10-06", "2026-10-06", "differs", null, 100, 0, 100],
      ["2026-10-07", "2026-10-07", "matched", null, 0, 0, 0],
    ]);
    // unknown for different reasons is not one run
    const mixed = run([row("2026-10-04", 50)], anchors.slice(0, 5), { historyFrom: "2026-10-03", foreignDays: ["2026-10-03"] });
    expect(compactReconcile(mixed).intervals.map((i) => [i.state, i.reason])).toEqual([["unknown", "rows_start_later"], ["unknown", "foreign_rows"], ["matched", null]]);
  });

  it("compacting folds a run of plain matched days into one that still adds up, and leaves marks and differences", () => {
    // 3.10., 4.10. and 7.10. are plain; 5.10. and 6.10. differ in opposite ways (a pair)
    const anchors = [0, 100, 200, 300, 500, 300, 400].map((c, i) => bal(`2026-10-0${i + 1}`, 100000 + c));
    const r = run([row("2026-10-02", 100), row("2026-10-03", 100), row("2026-10-04", 100), row("2026-10-07", 100)], anchors, { historyFrom: "2026-10-01" });
    expect(r.intervals).toHaveLength(5);
    const compact = compactReconcile(r);
    expect(compact.intervals.map((i) => [i.fromDay, i.toDay, i.deltaCents, i.sumCents, i.mark])).toEqual([
      ["2026-10-02", "2026-10-04", 300, 300, null],
      ["2026-10-05", "2026-10-06", 0, 0, "evens"],
      ["2026-10-07", "2026-10-07", 100, 100, null],
    ]);
    expect({ ...compact, intervals: [] }).toEqual({ ...r, intervals: [] });
    expect(compactReconcile(run(A_ROWS, A_ANCHORS)).intervals).toHaveLength(1);
  });
});
