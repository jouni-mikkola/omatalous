import { describe, expect, it } from "vitest";
import { printedEuroCents } from "../src/marks.ts";

describe("printedEuroCents", () => {
  it("rounds to the euro the page prints, halves away from zero, in both directions", () => {
    expect(printedEuroCents(1_249)).toBe(1_200);
    expect(printedEuroCents(1_250)).toBe(1_300);
    expect(printedEuroCents(-1_250)).toBe(-1_300);
    expect(printedEuroCents(0)).toBe(0);
  });
});
