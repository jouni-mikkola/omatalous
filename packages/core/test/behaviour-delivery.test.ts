/**
 * Delivery food (behaviour/delivery.ts): an order is a delivery row that cost something in the end, counted by ISO
 * week from the third day of the running week, and told above usual against 8 covered weeks or more.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { foodReport } from "../src/analysis/food.ts";
import { behaviourOf } from "../src/behaviour/index.ts";
import { addDays, dateIn } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
/** A Wednesday: the told week is 12.10. to 14.10. */
const TODAY = "2026-10-14";
const MONDAY = "2026-10-12";

const paid = (bookingDate: string, cents: number, merchant: string, category: string, more: Partial<Transaction> = {}) =>
  tx({ bookingDate, amountCents: -cents, merchant, category, categorySource: "rule", ...more });
/** Rent each month of 2026: the account is in the data from January on. */
const rent = Array.from({ length: 10 }, (_, i) => paid(dateIn(`2026-${String(i + 1).padStart(2, "0")}`, 2), 45_000, "Asunto Oy Esimerkki", "housing"));
const order = (day: string, cents = 2_500, merchant = "Esimerkkiruoka") => paid(day, cents, merchant, "food_delivery");
/** One or two orders in each of the `weeks` weeks before the told one, on the Tuesday (and the Friday of every other week). */
const usualWeeks = (weeks: number) =>
  Array.from({ length: weeks }, (_, k) => {
    const monday = addDays(MONDAY, -7 * (k + 1));
    return k % 2 ? [order(addDays(monday, 1)), order(addDays(monday, 4))] : [order(addDays(monday, 1))];
  }).flat();
const contextOf = (rows: readonly Transaction[], today = TODAY) => createContext([...rent, ...rows], [checking], today);
const world = (rows: readonly Transaction[], today = TODAY) => behaviourOf(contextOf(rows, today));

describe("delivery orders", () => {
  it("4 orders this week against 26 weeks of 1 to 2 is above usual", () => {
    const d = world([...usualWeeks(26), order(MONDAY), order(MONDAY), order("2026-10-13"), order(TODAY)]).delivery;
    expect(d.week).toMatchObject({ from: MONDAY, to: TODAY, count: 4, cents: 10_000, covered: true });
    expect(d.usual).toBe(1.5);
    expect(d.above).toBe(true);
    expect(d.confidence).toBe("known");
    expect(d.evidenceIds).toHaveLength(4);
  });

  it("2 orders against the same weeks is no change", () => {
    const d = world([...usualWeeks(26), order(MONDAY), order(TODAY)]).delivery;
    expect([d.week.count, d.usual, d.above]).toEqual([2, 1.5, false]);
  });

  it("on a Tuesday the week before is told", () => {
    const d = world([...usualWeeks(26), order(MONDAY)], "2026-10-13").delivery;
    expect(d.week).toMatchObject({ from: "2026-10-05", to: "2026-10-11", count: 1 });
  });

  it("counts the month so far and the month before", () => {
    const d = world([order("2026-09-03"), order("2026-09-20", 3_000), order("2026-10-01")]).delivery;
    expect([d.month.count, d.month.cents, d.lastMonth.count, d.lastMonth.cents]).toEqual([1, 2_500, 2, 5_500]);
  });

  it("a recurring membership fee is no order", () => {
    const fees = Array.from({ length: 8 }, (_, i) => paid(dateIn(`2026-${String(i + 2).padStart(2, "0")}`, 5), 799, "Wolt+", "food_delivery"));
    const ctx = contextOf([...fees, order("2026-10-05")]);
    const b = behaviourOf(ctx);
    expect(ctx.txs.filter((t) => t.merchant === "Wolt+").some(b.delivery.isDeliveryPurchase)).toBe(false);
    expect(b.delivery.month.count).toBe(1);
  });

  it("Wolt Market is groceries, not an order", () => {
    const market = order(MONDAY, 4_200, "Wolt Market Kallio");
    const ctx = contextOf([market]);
    const b = behaviourOf(ctx);
    expect(b.delivery.week.count).toBe(0);
    expect(b.groceries.isGroceryPurchase(ctx.txs.find((t) => t.id === market.id)!)).toBe(true);
    expect(b.groceries.week).toMatchObject({ visits: 1 });
  });

  it("money back on an order is no order of its own and does not count as one", () => {
    const b = world([order(MONDAY, 3_000), tx({ bookingDate: TODAY, amountCents: 1_000, merchant: "Esimerkkiruoka", category: "food_delivery", categorySource: "rule" })]);
    expect(b.delivery.week.count).toBe(1);
  });

  it("Raportit > Ruoka counts a Wolt Market purchase in its delivery line, where its cents are", () => {
    const rows = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m, i) => [order(dateIn(m, 5), [2_300, 3_100, 2_700, 1_900, 3_500, 1_500][i]!), order(dateIn(m, 12), [4_100, 5_300, 3_300, 4_700, 2_900, 4_900][i]!, "Wolt Market Kallio")]);
    const report = foodReport(contextOf(rows))!;
    if ("gap" in report) throw new Error("expected food figures");
    const line = report.lines.find((l) => l.id === "food_delivery")!;
    expect([line.purchases, line.meanCents]).toEqual([12, 3_350]);
  });
});
