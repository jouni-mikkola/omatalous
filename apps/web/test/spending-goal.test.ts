import type { SpendingGoal } from "@banking/core";
import { describe, expect, it } from "vitest";
import { goalAnswer } from "../src/components/overview/SpendingGoal.tsx";

const goal = (g: Partial<SpendingGoal>): SpendingGoal => ({ cents: 250_000, leftCents: 100_000, end: { low: 200_000, high: 230_000 }, perDayCents: 4_000, state: "within", ...g });
const text = (g: Partial<SpendingGoal>) => goalAnswer(goal(g)).replace(/[\u00a0\u202f]/g, " ");

describe("the sentence under the goal", () => {
  it("names what is left, how the month ends and what a day may cost", () => {
    expect(text({})).toBe("Tavoitteesta 2 500 € on jäljellä 1 000 €. Kuukausi päättyy ≈ 2 000–2 300 €, tavoitteen sisällä. Päivässä voi kuluttaa enintään 40 €.");
  });

  it("says where the goal stands in the estimate", () => {
    expect(text({ state: "near" })).toContain("tavoite on tällä välillä");
    expect(text({ state: "above", end: { low: 260_000, high: 300_000 } })).toContain("tavoitteen yli");
  });

  it("tells an excess alone, and a month with no estimate by what is left", () => {
    expect(text({ leftCents: -12_000, state: "over", perDayCents: null })).toBe("Tavoite 2 500 € on ylittynyt: menoja on 120 € yli.");
    expect(text({ end: null, state: "open" })).toBe("Tavoitteesta 2 500 € on jäljellä 1 000 €. Päivässä voi kuluttaa enintään 40 €.");
  });

  it("gives the month's total once, not as a range, on its last day", () => {
    expect(text({ end: { low: 240_000, high: 240_000 }, perDayCents: null })).toBe("Tavoitteesta 2 500 € on jäljellä 1 000 €. Kuukausi päättyy 2 400 €, tavoitteen sisällä.");
  });
});
