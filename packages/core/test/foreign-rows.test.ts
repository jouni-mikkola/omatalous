/**
 * Rows in another currency: which currency a row is in, how the bank's decimal text is read, and the per-currency
 * totals. Made-up sums.
 */
import { describe, expect, it } from "vitest";
import { foreignCurrencyOf, foreignTotals, formatForeignAmount, parseForeignAmount } from "../src/foreign-rows.ts";

describe("foreignCurrencyOf", () => {
  it("reads three letters, trimmed and in capitals", () => {
    expect(foreignCurrencyOf("USD")).toBe("USD");
    expect(foreignCurrencyOf(" usd ")).toBe("USD");
    expect(foreignCurrencyOf("Usd")).toBe("USD");
    expect(foreignCurrencyOf(" eur ")).toBe("EUR");
  });

  it("gives XXX for anything else, never the euro", () => {
    for (const bad of ["EURO", "", "  ", "12", "US", "US1", null, undefined, 3]) expect(foreignCurrencyOf(bad)).toBe("XXX");
  });
});

describe("parseForeignAmount", () => {
  it("keeps the scale as sent: no decimals, two or three", () => {
    expect(parseForeignAmount("1500", "DBIT")).toEqual({ minor: -1500, scale: 0 });
    expect(parseForeignAmount("100.00", "CRDT")).toEqual({ minor: 10000, scale: 2 });
    expect(parseForeignAmount("1.234", "DBIT")).toEqual({ minor: -1234, scale: 3 });
  });

  it("takes the sign from the bank's direction, and from the text only when there is no direction", () => {
    expect(parseForeignAmount("30.00", "DBIT")).toEqual({ minor: -3000, scale: 2 });
    expect(parseForeignAmount("-30.00", "CRDT")).toEqual({ minor: 3000, scale: 2 });
    expect(parseForeignAmount("-30.00", undefined)).toEqual({ minor: -3000, scale: 2 });
    expect(parseForeignAmount("30.00", undefined)).toEqual({ minor: 3000, scale: 2 });
  });

  it("refuses what is not a plain decimal with at most three decimals", () => {
    for (const bad of ["1.2345", "abc", "", "1,50", "1e3", ".5", "12.", "1234567890123456", null, undefined]) expect(parseForeignAmount(bad, "DBIT")).toBeNull();
  });
});

describe("foreignTotals", () => {
  it("adds a currency's rows with their signs: a refund is a row with a plus", () => {
    const rows = [
      { currency: "USD", amountMinor: 10000, scale: 2 },
      { currency: "USD", amountMinor: -3000, scale: 2 },
      { currency: "USD", amountMinor: 3000, scale: 2 },
    ];
    expect(foreignTotals(rows)).toEqual([{ currency: "USD", count: 3, totalMinor: 10000, scale: 2 }]);
  });

  it("never adds across currencies", () => {
    const rows = [
      { currency: "USD", amountMinor: -2000, scale: 2 },
      { currency: "SEK", amountMinor: -50000, scale: 2 },
    ];
    expect(foreignTotals(rows)).toEqual([
      { currency: "SEK", count: 1, totalMinor: -50000, scale: 2 },
      { currency: "USD", count: 1, totalMinor: -2000, scale: 2 },
    ]);
  });

  it("adds rows that differ in decimals at the most decimals: 12.10 and 12 give 24.10", () => {
    const rows = ["12.10", "12"].map((text) => {
      const a = parseForeignAmount(text, "CRDT")!;
      return { currency: "USD", amountMinor: a.minor, scale: a.scale };
    });
    const totals = foreignTotals(rows);
    expect(totals).toEqual([{ currency: "USD", count: 2, totalMinor: 2410, scale: 2 }]);
    expect(formatForeignAmount(totals[0]!.totalMinor!, totals[0]!.scale!, false, "en")).toBe("24.10");
  });

  it("keeps the total when a sum came as a number and lost its last zero (12.10 as 12.1)", () => {
    const a = parseForeignAmount(12.1, "DBIT")!;
    const rows = [
      { currency: "USD", amountMinor: a.minor, scale: a.scale },
      { currency: "USD", amountMinor: -500, scale: 2 },
      { currency: "USD", amountMinor: 5, scale: 3 },
    ];
    expect(foreignTotals(rows)).toEqual([{ currency: "USD", count: 3, totalMinor: -17095, scale: 3 }]);
  });

  it("never adds one currency's total to another's, also when the decimals differ", () => {
    const rows = [
      { currency: "USD", amountMinor: 1210, scale: 2 },
      { currency: "JPY", amountMinor: 500, scale: 0 },
      { currency: "USD", amountMinor: 12, scale: 0 },
      { currency: "JPY", amountMinor: 15, scale: 1 },
    ];
    expect(foreignTotals(rows)).toEqual([
      { currency: "JPY", count: 2, totalMinor: 5015, scale: 1 },
      { currency: "USD", count: 2, totalMinor: 2410, scale: 2 },
    ]);
  });

  it("gives no total, and keeps the count, when the sum does not fit a whole number", () => {
    const rows = [
      { currency: "USD", amountMinor: Number.MAX_SAFE_INTEGER, scale: 0 },
      { currency: "USD", amountMinor: 1, scale: 3 },
    ];
    expect(foreignTotals(rows)).toEqual([{ currency: "USD", count: 2, totalMinor: null, scale: null }]);
  });

  it("gives no total, and does not throw, for a row that is not a whole number", () => {
    for (const bad of [{ amountMinor: 12.5, scale: 2 }, { amountMinor: Number.NaN, scale: 2 }, { amountMinor: 5, scale: 1.5 }, { amountMinor: 5, scale: Number.NaN }]) {
      const rows = [{ currency: "USD", amountMinor: 1000, scale: 2 }, { currency: "USD", ...bad }];
      expect(foreignTotals(rows)).toEqual([{ currency: "USD", count: 2, totalMinor: null, scale: null }]);
    }
  });

  it("adds a very large number of rows of one currency", () => {
    const rows = Array.from({ length: 300_000 }, (_, i) => ({ currency: "USD", amountMinor: 1, scale: i % 2 ? 2 : 0 }));
    expect(foreignTotals(rows)).toEqual([{ currency: "USD", count: 300_000, totalMinor: 15_150_000, scale: 2 }]);
  });
});

describe("formatForeignAmount", () => {
  it("writes the bank's own figure with a decimal comma and a sign", () => {
    expect(formatForeignAmount(10000, 2, true)).toBe("+100,00");
    expect(formatForeignAmount(-3000, 2, true)).toBe("−30,00");
    expect(formatForeignAmount(-1500, 0)).toBe("−1 500");
    expect(formatForeignAmount(-1234, 3)).toBe("−1,234");
    expect(formatForeignAmount(5, 2)).toBe("0,05");
  });
});
