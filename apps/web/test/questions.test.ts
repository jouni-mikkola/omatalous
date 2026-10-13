import { describe, expect, it } from "vitest";
import { asks, classifiedPercent } from "../src/components/questions.ts";

describe("the percent of the money that is classified", () => {
  it("rounds down to a whole percent, never up to 100", () => {
    expect(classifiedPercent(0.996)).toBe(99);
    expect(classifiedPercent(0.99999)).toBe(99);
    expect(classifiedPercent(0.789)).toBe(78);
    expect(classifiedPercent(0)).toBe(0);
    expect(classifiedPercent(1)).toBe(100);
  });

  it("is not moved by the float's last digits", () => {
    // 0.29 * 100 is 28.999999999999996
    expect(classifiedPercent(0.29)).toBe(29);
    expect(classifiedPercent(1 - 22000 / 100000)).toBe(78);
    expect(classifiedPercent(1 - 35000 / 215000)).toBe(83);
  });
});

describe("when the block is drawn", () => {
  const item = { kind: "payee_out" };
  it("needs a share, and then something to ask or under 95 %", () => {
    expect(asks({ share: null, items: [item] })).toBe(false);
    expect(asks({ share: 0.99, items: [item] })).toBe(true);
    expect(asks({ share: 0.94, items: [] })).toBe(true);
    expect(asks({ share: 0.95, items: [] })).toBe(false);
    expect(asks({ share: 1, items: [] })).toBe(false);
  });
});
