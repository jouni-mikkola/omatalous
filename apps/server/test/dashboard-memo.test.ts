/** The kept dashboard answers: one per period and inputs for a context, rebuilt when an input moves, bounded per context. */
import { type BalanceInput, buildDashboard, type DateRange, type UserInputs } from "@banking/core";
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { dashboardOf } from "../src/services/dashboard-memo.ts";
import { stampOf } from "../src/services/request-inputs.ts";

const h = demoHousehold();
const ctx = contextOf(h);
const month = (m: number): DateRange => ({ from: `2025-${String(m).padStart(2, "0")}-01`, to: `2025-${String(m).padStart(2, "0")}-28` });
const read = (inputs: UserInputs, balances: BalanceInput[] = [...h.balances]) => ({ balances, inputs, stamp: stampOf([...h.balances], inputs) });
const answer = (range: DateRange, inputs = h.inputs, c = ctx) => dashboardOf(c, range, read(inputs), []);

describe("dashboard memo", () => {
  it("gives the same answer again for the same period and inputs, equal to a fresh build", () => {
    const first = answer(month(3));
    expect(answer(month(3))).toBe(first);
    expect(first).toEqual(buildDashboard(ctx, month(3), h.balances, h.inputs, []));
  });

  it("builds again when the period differs", () => {
    const first = answer(month(3));
    expect(answer(month(4))).not.toBe(first);
  });

  it("builds again when what the rows prove of a balance differs, which the stamp does not hold", () => {
    const first = answer(month(3));
    const differing = h.balances.map((b): BalanceInput => ({ ...b, proof: { status: "differs", reason: null } }));
    const built = dashboardOf(ctx, month(3), read(h.inputs, differing), []);
    expect(built).not.toBe(first);
    expect(dashboardOf(ctx, month(3), read(h.inputs, differing), [])).toBe(built);
  });

  it("keeps a few periods per context and lets the oldest go", () => {
    const own = contextOf(h);
    const first = answer(month(1), h.inputs, own);
    for (let m = 2; m <= 7; m++) answer(month(m), h.inputs, own);
    expect(answer(month(7), h.inputs, own)).toBe(answer(month(7), h.inputs, own));
    expect(answer(month(1), h.inputs, own)).not.toBe(first);
  });

  it("holds nothing across contexts", () => {
    const other = contextOf(h);
    expect(answer(month(3), h.inputs, other)).not.toBe(answer(month(3)));
  });
});
