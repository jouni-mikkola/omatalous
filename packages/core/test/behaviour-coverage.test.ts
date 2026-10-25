/**
 * The coverage gate of the behaviour counts (behaviour/week.ts): a week counts only when every account that paid the
 * line in the last 90 days covers it, and a usual level needs 8 covered weeks.
 */
import { describe, expect, it } from "vitest";
import { bestOfSync, calibrate, slowerNow } from "../../../tools/lib/timing.ts";
import { createContext } from "../src/analysis/context.ts";
import { behaviourOf } from "../src/behaviour/index.ts";
import { addDays, dateIn } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const TODAY = "2026-10-14";
const MONDAY = "2026-10-12";

const paid = (bookingDate: string, cents: number, merchant: string, category: string, accountId = "acc-1") =>
  tx({ bookingDate, amountCents: -cents, merchant, category, categorySource: "rule", accountId });
const rent = Array.from({ length: 10 }, (_, i) => paid(dateIn(`2026-${String(i + 1).padStart(2, "0")}`, 2), 45_000, "Asunto Oy Esimerkki", "housing"));
const order = (day: string, accountId = "acc-1") => paid(day, 2_500, "Esimerkkiruoka", "food_delivery", accountId);
const world = (rows: readonly Transaction[], accounts: Account[] = [checking], today = TODAY) => behaviourOf(createContext(rows, accounts, today));

describe("coverage", () => {
  it("5 covered weeks give the count and no usual level", () => {
    const rows = Array.from({ length: 5 }, (_, k) => order(addDays(MONDAY, -7 * (k + 1))));
    const d = world([...rows, order(MONDAY), order(MONDAY), order(TODAY), order(TODAY)]).delivery;
    expect(d.week).toMatchObject({ count: 4, covered: true });
    expect([d.usual, d.above]).toEqual([null, false]);
  });

  it("a card whose rows begin inside the week leaves the week uncovered", () => {
    // a Sunday; the card's first row is on Friday, past the three days of slack from Monday
    const d = world([...rent, order("2026-10-16", "card-1"), order("2026-10-17", "card-1")], [checking, card], "2026-10-18").delivery;
    expect(d.week).toMatchObject({ count: 2, covered: false });
    expect(d.month.covered).toBe(false);
    expect([d.usual, d.above, d.covered, d.confidence]).toEqual([null, false, false, "estimated"]);
  });

  it("a card that stopped two months before the newest row leaves the week uncovered", () => {
    const weekly = Array.from({ length: 12 }, (_, k) => order(addDays("2026-07-20", -7 * k), "card-1"));
    const d = world([...rent, ...weekly], [checking, card]).delivery;
    expect([d.week.count, d.week.covered, d.usual, d.confidence]).toEqual([0, false, null, "estimated"]);
  });

  it("a card that only paused for a few weeks still covers the week", () => {
    const weekly = Array.from({ length: 12 }, (_, k) => order(addDays("2026-09-20", -7 * k), "card-1"));
    const d = world([...rent, ...weekly], [checking, card]).delivery;
    expect([d.week.count, d.week.covered]).toEqual([0, true]);
  });

  it("an account that has not paid the line for 90 days is not asked", () => {
    const d = world([...rent, order("2026-06-01", "card-1"), order(MONDAY)], [checking, card]).delivery;
    expect(d.week.covered).toBe(true);
  });

  it("with no payer, the accounts with recent rows are asked", () => {
    const g = world(rent).gambling;
    expect(g.week).toMatchObject({ count: 0, covered: true });
    expect(g.usual).toBe(0);
  });
});

describe("gambling stakes", () => {
  it("counts and sums the rows going out, by week and month", () => {
    const g = world([...rent, paid(MONDAY, 1_000, "Esimerkkipelit", "gambling"), paid(TODAY, 500, "Esimerkkipelit", "gambling"), paid("2026-09-30", 2_000, "Esimerkkipelit", "gambling"), tx({ bookingDate: TODAY, amountCents: 3_000, merchant: "Esimerkkipelit", category: "gambling", categorySource: "rule" })]).gambling;
    expect([g.week.count, g.week.cents, g.month.count, g.month.cents, g.lastMonth.count, g.lastMonth.cents]).toEqual([2, 1_500, 2, 1_500, 1, 2_000]);
    expect(g.evidenceIds).toHaveLength(2);
  });
});

describe("cost", () => {
  it("counts a household of 100 000 rows in under 100 ms", () => {
    const merchants: [string, string][] = [["Esimerkkikauppa", "groceries"], ["Esimerkkiruoka", "food_delivery"], ["Esimerkkipelit", "gambling"], ["Kahvila", "restaurants"]];
    const rows = Array.from({ length: 100_000 }, (_, i) => {
      const [merchant, category] = merchants[i % 4]!;
      return paid(addDays("2023-10-01", Math.floor(i / 90)), 500 + (i % 3_000), merchant, category, i % 3 ? "acc-1" : "card-1");
    });
    const ctx = createContext(rows, [checking, card], TODAY);
    // the CPU time of the best of five runs, each on a fresh copy of the context (the result is cached per context): the
    // budget is for the counting. A loaded machine slows a single run several times over, and still makes the best one
    // cost more, so the budget stretches as the calibration runs slower than idle (tools/lib/timing.ts)
    let copy = { ...ctx };
    const before = calibrate();
    const { ms } = bestOfSync(5, () => behaviourOf(copy), () => void (copy = { ...ctx }));
    expect(ms).toBeLessThan(100 * slowerNow(before));
    expect(behaviourOf(ctx).groceries.week.visits).toBeGreaterThan(0);
  }, 60_000);
});
