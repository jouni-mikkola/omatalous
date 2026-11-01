/** The check compares the lines with the report's own figure: a select that loses a row shows the difference. */
import { describe, expect, it, vi } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { monthEnd } from "../src/dates.ts";
import { explain } from "../src/explain/explain.ts";

const state = vi.hoisted(() => ({ dropped: null as number | null, drop: false }));

// the report keeps the select as it is; the explanation's own call loses its first row
vi.mock("../src/analysis/counted.ts", async (original) => {
  const real = await original<typeof import("../src/analysis/counted.ts")>();
  return {
    ...real,
    spendSelect: (ctx: Parameters<typeof real.spendSelect>[0], r: Parameters<typeof real.spendSelect>[1]) => {
      const s = real.spendSelect(ctx, r);
      if (!state.drop || new Error().stack!.includes("categories.ts")) return s;
      state.dropped = s.counted[0]!.spend;
      return { rows: s.rows, counted: s.counted.slice(1) };
    },
  };
});

describe("explain: the zero-difference check is against the report's figure", () => {
  const ctx = contextOf(demoHousehold());
  const args = { view: "own" as const, range: { from: "2026-08-01", to: monthEnd("2026-08") } };

  it("says 0 when the lines are the figure's rows and the difference when one is lost", () => {
    state.drop = false;
    expect(explain("spend.month", ctx, args).check).toEqual({ kind: "sum", diffCents: 0 });
    state.drop = true;
    const broken = explain("spend.month", ctx, args);
    expect(state.dropped).not.toBeNull();
    expect(broken.check).toEqual({ kind: "sum", diffCents: state.dropped });
    expect(broken.check).not.toEqual({ kind: "sum", diffCents: 0 });
    state.drop = false;
  });
});
