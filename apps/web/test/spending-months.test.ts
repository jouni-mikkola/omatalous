import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { rowsHref } from "../src/pages/reports/sections/SpendingMonths.tsx";
import { page } from "../src/pages/reports/pages/Spending.tsx";

describe("Rahankäyttö: every figure opens the rows it is the sum of", () => {
  const ctx = { range: { from: "2026-01-15", to: "2026-03-20" } };
  it("a category opens its rows of the period", () => {
    expect(rowsHref(ctx, "groceries")).toBe("#/transactions?category=groceries&from=2026-01-15&to=2026-03-20");
  });
  it("a month of a category opens that month, cut to the days the period holds", () => {
    expect(rowsHref(ctx, "groceries", "2026-02")).toBe("#/transactions?category=groceries&from=2026-02-01&to=2026-02-28");
    expect(rowsHref(ctx, "groceries", "2026-01")).toBe("#/transactions?category=groceries&from=2026-01-15&to=2026-01-31");
    expect(rowsHref(ctx, "groceries", "2026-03")).toBe("#/transactions?category=groceries&from=2026-03-01&to=2026-03-20");
  });
  it("a link starts where the sums start when the period is longer than what was counted", () => {
    expect(rowsHref(ctx, "groceries", undefined, undefined, "2026-02-01")).toBe("#/transactions?category=groceries&from=2026-02-01&to=2026-03-20");
    expect(rowsHref(ctx, "groceries", undefined, undefined, "2025-12-01")).toBe("#/transactions?category=groceries&from=2026-01-15&to=2026-03-20");
  });
  it("a payee of a category opens its rows", () => {
    expect(rowsHref(ctx, "groceries", undefined, "K-Market")).toBe("#/transactions?category=groceries&merchant=K-Market&from=2026-01-15&to=2026-03-20");
  });
  // main's Rahankäyttö had no section a household without credit draws or an add-on would see
  it("the page starts with the categories", () => {
    expect(page.sections[0]!.id).toBe("kategoriat");
  });
});
