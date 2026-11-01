import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addMonths, monthRange } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import { type Account, type PriceIndex, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// the price-change comparison (docs/ROADMAP.md, Longer forecasts, part 3): the household's own series divided by the
// published index series. The index here is invented; nothing reads the network.
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

/** A made-up index: 100 in 2025-09, up 0.4 points a month, and no figure for the month the publisher has not reached. */
function indexOf(through = "2026-09", extra: Record<string, number> = {}): PriceIndex {
  const months: Record<string, number> = {};
  for (const [i, m] of monthRange("2025-01", through).entries()) months[m] = 98 + i * 0.4;
  return { source: "Tilastokeskus", table: "11xs", fetchedAt: "2026-10-20", months: { ...months, ...extra } };
}

function charges(merchant: string, from: string, to: string, cents: (month: string) => number): Transaction[] {
  return monthRange(from, to).map((m) => tx({ bookingDate: `${m}-05`, amountCents: -cents(m), category: "subscriptions", merchant, accountId: "acc-1" }));
}

const rows = (): Transaction[] => [
  // 12,99 € until March 2026, then 14,99 €
  ...charges("Striimi", "2025-03", "2026-09", (m) => (m < "2026-03" ? 1299 : 1499)),
  // never moves
  ...charges("Pilvitila", "2025-03", "2026-09", () => 299),
  // started inside the window: not in the basket
  ...charges("Uusi Lehti", "2026-04", "2026-09", () => 1000),
];
const ctx = createContext(rows(), [checking], today);
const priceChange = (priceIndex?: PriceIndex | null) => buildReports({ ctx, range: { from: "2026-01-01", to: today }, balances: [], inputs: { marks: [], expectedBills: [], priceIndex } }).priceChange;

describe("price change against the consumer price index", () => {
  const r = priceChange(indexOf());

  it("is the household's own series divided by the published series, month by month", () => {
    expect(r.status).toBe("ok");
    expect(r.baseMonth).toBe("2025-09");
    expect(r.lastMonth).toBe("2026-09");
    expect(r.months.map((m) => m.month)).toEqual(monthRange("2025-09", "2026-09"));
    const index = indexOf().months;
    for (const m of r.months) {
      expect(m.indexPoints).toBe(index[m.month]);
      expect(m.relative).toBeCloseTo(m.ownRatio / (index[m.month]! / index["2025-09"]!), 12);
    }
    expect(r.months[0]!.relative).toBe(1);
    // one month by hand: the basket rose from 1598 to 1798 cents while the index went from its September to its March figure
    const march = r.months.find((m) => m.month === "2026-03")!;
    expect(march.relative).toBeCloseTo(1798 / 1598 / (index["2026-03"]! / index["2025-09"]!), 12);
  });

  it("costs the basket at the price in force each month, with quantities unchanged", () => {
    // Striimi and Pilvitila monthly: 1299 + 299 before the rise, 1499 + 299 from March
    expect(r.months.find((m) => m.month === "2026-02")!.ownCents).toBe(1598);
    expect(r.months.find((m) => m.month === "2026-03")!.ownCents).toBe(1798);
    expect(r.ownChange).toBeCloseTo(1798 / 1598 - 1, 12);
    expect(r.services.map((s) => s.merchant)).toEqual(["Striimi", "Pilvitila"]);
  });

  it("does not depend on the base of the index", () => {
    const scaled = indexOf();
    const doubled = { ...scaled, months: Object.fromEntries(Object.entries(scaled.months).map(([m, v]) => [m, v * 7.5])) };
    const other = priceChange(doubled);
    expect(other.relativeChange).toBeCloseTo(r.relativeChange!, 12);
    for (const [i, m] of other.months.entries()) expect(m.relative).toBeCloseTo(r.months[i]!.relative, 12);
  });

  it("ends at the last complete month the index has a figure for", () => {
    const behind = priceChange(indexOf("2026-08"));
    expect(behind.lastMonth).toBe("2026-08");
    expect(behind.baseMonth).toBe(addMonths("2026-08", -12));
  });

  it("says why there is no comparison", () => {
    expect(priceChange(null).status).toBe("no_index");
    expect(priceChange(undefined).status).toBe("no_index");
    const gap = indexOf();
    const { ["2026-01"]: _gone, ...months } = gap.months;
    expect(priceChange({ ...gap, months }).status).toBe("short_index");
    expect(priceChange(indexOf("2025-12")).status).toBe("short_index");
    expect(priceChange(indexOf("2025-12")).baseMonth).not.toBeNull();
    const young = createContext(charges("Striimi", "2026-05", "2026-09", () => 1299), [checking], today);
    expect(buildReports({ ctx: young, range: { from: "2026-01-01", to: today }, balances: [], inputs: { marks: [], expectedBills: [], priceIndex: indexOf() } }).priceChange.status).toBe("no_basket");
  });

  it("leaves a service the household marked as cancelled out of the basket", () => {
    const cancelled = buildReports({
      ctx,
      range: { from: "2026-01-01", to: today },
      balances: [],
      inputs: { marks: [{ subject: `merchant:Striimi`, mark: "cancelled", markedAt: "2026-09-20T10:00:00Z" }], expectedBills: [], priceIndex: indexOf() },
    }).priceChange;
    expect(cancelled.services.map((s) => s.merchant)).toEqual(["Pilvitila"]);
    expect(cancelled.ownChange).toBe(0);
  });
});
