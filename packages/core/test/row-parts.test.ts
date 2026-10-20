import { describe, expect, it } from "vitest";
import { demoHousehold, contextOf, seededHousehold } from "../../../tools/findings/households.ts";
import type { AnalysisContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { categoryParts, type RowParts } from "../src/analysis/row-parts.ts";

type RowPart = RowParts["parts"][number];
import { buildReports } from "../src/reports/index.ts";
import { rng } from "./gen.ts";

const IDS = ["fruit", "bread", "dairy", "meat", "fish", "ready", "dry", "frozen", "drinks", "sweets"];

/** Parts for the groceries rows of a context, as an extension would tell them: some that add up to the row, some to more (a bonus), some estimated. */
function partsFor(ctx: AnalysisContext, seed: number): Map<string, RowParts> {
  const r = rng(seed);
  const out = new Map<string, RowParts>();
  for (const t of ctx.txs) {
    if (t.category !== "groceries" || t.amountCents === 0 || r() < 0.2) continue;
    const whole = -t.amountCents + (r() < 0.2 ? Math.round(r() * 500) : 0);
    const n = 1 + Math.floor(r() * 9);
    const parts: RowPart[] = [];
    let left = whole;
    for (let i = 0; i < n; i++) {
      const cents = i === n - 1 ? left : Math.round(left * r() * 0.7);
      left -= cents;
      parts.push({ id: IDS[i]!, label: IDS[i]!, cents });
    }
    if (r() < 0.3) parts.push({ id: "deposits", label: "Pantit", cents: Math.round(r() * 80) - 40, kind: "apart" });
    if (r() < 0.2) parts.push({ id: "other", label: "Muut", cents: Math.round(r() * 300), kind: "rest" });
    out.set(t.id, { category: "groceries", parts, estimated: r() < 0.3 });
  }
  return out;
}

/** The answer with every `parts` of a category and `split` of a bar left out: what the shared build sends. */
const without = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (key === "parts" && Array.isArray(v) && v.some((p) => "estimated" in p)) || key === "split" ? undefined : v));

const households = [demoHousehold(), ...[1, 2, 3].flatMap((seed) => [seededHousehold(seed, false), seededHousehold(seed, true)])];

describe("parts a level under a category", () => {
  for (const h of households) {
    it(`change no flow or category total and add up to their category (${h.name})`, () => {
      const ctx = contextOf(h);
      const told = { ...ctx, rowParts: partsFor(ctx, 7) };
      const from = `${h.today.slice(0, 4)}-01-01`;
      const range = { from: from > (ctx.dataFrom ?? from) ? from : ctx.dataFrom!, to: h.today };
      const plain = buildReports({ ctx, range, balances: h.balances });
      const split = buildReports({ ctx: told, range, balances: h.balances });
      expect(without(split)).toEqual(without(plain));
      const dash = buildDashboard(told, { from: `${h.today.slice(0, 7)}-01`, to: h.today }, h.balances);
      expect(without(dash)).toEqual(without(buildDashboard(ctx, { from: `${h.today.slice(0, 7)}-01`, to: h.today }, h.balances)));

      const cats = split.categories.groups.flatMap((g) => g.categories);
      const groceries = cats.filter((c) => c.category === "groceries" && c.totalCents !== 0);
      expect(groceries.length).toBeGreaterThan(0);
      for (const c of cats) {
        if (c.category !== "groceries") expect(c.parts).toBeUndefined();
        if (!c.parts) continue;
        expect(c.parts.reduce((s, p) => s + p.cents, 0)).toBe(c.totalCents);
        expect(c.parts.filter((p) => p.id !== "rest").length).toBeLessThanOrEqual(7);
        expect(new Set(c.parts.map((p) => p.id)).size).toBe(c.parts.length);
      }
      for (const b of dash.waterfall?.bars ?? []) if (b.split) expect(b.split.reduce((s, p) => s + p.cents, 0)).toBe(-b.cents);
    });
  }

  it("leave a row the user moved out of the category in no part, and the rows with none as one", () => {
    const parts = new Map<string, RowParts>([
      ["a", { category: "groceries", parts: [{ id: "dairy", label: "Maito", cents: 600 }, { id: "meat", label: "Liha", cents: 400 }], estimated: false }],
      ["b", { category: "groceries", parts: [{ id: "dairy", label: "Maito", cents: 300 }], estimated: true }],
    ]);
    const rows = [
      { id: "a", category: "groceries", spend: 500 },
      { id: "b", category: "restaurants", spend: 300 },
      { id: "c", category: "groceries", spend: 250 },
    ];
    expect(categoryParts(rows.filter((t) => t.category === "groceries"), parts, "groceries")).toEqual([
      { id: "dairy", label: "Maito", cents: 300, estimated: false },
      { id: "meat", label: "Liha", cents: 200, estimated: false },
      { id: "unsplit", label: "Erittelemättä", cents: 250, estimated: false },
    ]);
    expect(categoryParts(rows.filter((t) => t.category === "restaurants"), parts, "restaurants")).toBeNull();
    expect(categoryParts(rows, undefined, "groceries")).toBeNull();
  });

  it("fold the smallest into Muut past seven and Muut, the parts kept apart after them", () => {
    const many: RowPart[] = IDS.map((id, i) => ({ id, label: id, cents: 1000 - i * 50 }));
    const parts = new Map<string, RowParts>([["a", { category: "groceries", parts: [...many, { id: "deposits", label: "Pantit", cents: -40, kind: "apart" }], estimated: true }]]);
    const total = many.reduce((s, p) => s + p.cents, -40);
    const out = categoryParts([{ id: "a", category: "groceries", spend: total }], parts, "groceries")!;
    expect(out.map((p) => p.id)).toEqual(["fruit", "bread", "dairy", "meat", "fish", "ready", "rest", "deposits"]);
    expect(out.every((p) => p.estimated)).toBe(true);
    expect(out.reduce((s, p) => s + p.cents, 0)).toBe(total);
  });
});
