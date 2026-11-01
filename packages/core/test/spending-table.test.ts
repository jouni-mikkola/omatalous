import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { RowParts } from "../src/analysis/row-parts.ts";
import type { Account } from "../src/types.ts";
import { series, tx } from "./helpers.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("the spending table", () => {
  const ctx = createContext(dataset(), [checking], today);
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const r = buildReports({ ctx, range, balances: [] });

  it("the spending table adds up: rows to the figure of the question, fixed and variable to the rows, twelve months to the column", () => {
    const t = r.spendingTable;
    const sum = (pick: (x: (typeof t.rows)[number]) => number) => t.rows.reduce((s, x) => s + pick(x), 0);
    expect(t.totalCents).toBe(r.categories.totalCents);
    expect(t.totalCents).toBe(r.conclusions.menot!.verdict.figure.cents);
    expect(sum((x) => x.totalCents)).toBe(t.totalCents);
    for (const x of t.rows) expect(x.fixedCents + x.variableCents, x.key).toBe(x.totalCents);
    expect(t.fixedCents).toBeGreaterThan(0);
    expect(t.fixedCents + t.variableCents).toBe(t.totalCents);
    // twelve whole months ending with September 2026, named by their days
    expect(t.year).toMatchObject({ from: "2025-10-01", to: "2026-09-30", months: 12 });
    expect(sum((x) => x.yearCents ?? 0)).toBe(t.year!.totalCents);
    // each category's cell is the sum of the rows the drill lists for it
    for (const x of t.rows) {
      const rows = ctx.txs.filter((tx) => tx.category === x.category && tx.bookingDate >= range.from && tx.bookingDate <= range.to);
      expect(rows.reduce((s, tx) => s + tx.spend, 0), x.key).toBe(x.totalCents);
      expect(rows.filter((tx) => tx.spend !== 0).length, x.key).toBe(x.count);
    }
    // the one-offs are named and sit inside the rows' sums
    expect(t.oneOffs.reduce((s, o) => s + o.cents, 0)).toBe(t.oneOffCents);
    expect(sum((x) => x.oneOffCents)).toBe(t.oneOffCents);
    // the comparison rows add up to the periods' spending on the same accounts
    for (const kind of ["previous", "yearAgo"] as const) {
      if (!t.periods[kind]) continue;
      expect(t.totals[kind]!.deltaCents, kind).toBe(r.conclusions.menot!.compare[kind]!.deltaCents);
      expect(sum((x) => x[kind]?.deltaCents ?? 0), kind).toBe(t.totals[kind]!.deltaCents);
    }
  });

  it("a large purchase is named in the spending table and counted once, in its category's variable costs", () => {
    const rows = [
      ...series("2025-09-01", 30.44, 13, -90000, { category: "housing", merchant: "Sato Oyj" }),
      ...series("2025-09-03", 3.5, 115, -4000, { category: "groceries", merchant: "K-Market" }),
      tx({ bookingDate: "2026-08-12", amountCents: -240000, category: "home", merchant: "Sohvakauppa" }),
    ].filter((x) => x.bookingDate <= today);
    const t = buildReports({ ctx: createContext(rows, [checking], today), range, balances: [] }).spendingTable;
    expect(t.oneOffs).toMatchObject([{ merchant: "Sohvakauppa", cents: 240000, date: "2026-08-12" }]);
    expect(t.oneOffCents).toBe(240000);
    const home = t.rows.find((x) => x.category === "home")!;
    expect(home).toMatchObject({ totalCents: 240000, oneOffCents: 240000, variableCents: 240000, fixedCents: 0 });
    expect(t.totalCents).toBe(t.rows.reduce((s, x) => s + x.totalCents, 0));
  });

  it("a row's parts add up to its spending when a build's extension told some of its rows, and the shared build has none", () => {
    const rows = [
      tx({ id: "a", bookingDate: "2026-08-12", amountCents: -1000, category: "groceries", merchant: "K-Market" }),
      tx({ id: "b", bookingDate: "2026-08-13", amountCents: -500, category: "groceries", merchant: "K-Market" }),
      tx({ id: "c", bookingDate: "2026-08-14", amountCents: -700, category: "transport", merchant: "VR" }),
    ];
    const rowParts = new Map<string, RowParts>([["a", { category: "groceries", parts: [{ id: "dairy", label: "Maito", cents: 600 }, { id: "meat", label: "Liha", cents: 400 }], estimated: true }]]);
    const base = createContext(rows, [checking], today);
    expect(buildReports({ ctx: base, range, balances: [] }).spendingTable.rows.some((x) => x.parts)).toBe(false);
    const t = buildReports({ ctx: { ...base, rowParts }, range, balances: [] }).spendingTable;
    const groceries = t.rows.find((x) => x.category === "groceries")!;
    expect(groceries.parts!.map((p) => [p.id, p.cents])).toEqual([["dairy", 600], ["meat", 400], ["unsplit", 500]]);
    expect(groceries.parts!.reduce((s, p) => s + p.cents, 0)).toBe(groceries.totalCents);
    expect(t.rows.find((x) => x.category === "transport")!.parts).toBeUndefined();
  });
});
