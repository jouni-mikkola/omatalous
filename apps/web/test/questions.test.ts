import { describe, expect, it } from "vitest";
import { classifiedPercent, percentText } from "../src/components/questions.ts";

describe("a share as the page says it", () => {
  it("is a whole percent rounded down, and alle 1 % for a share above 0 that rounds to nothing", () => {
    expect(percentText(0.874)).toBe("87 %");
    expect(percentText(0.999)).toBe("99 %");
    expect(percentText(1)).toBe("100 %");
    expect(percentText(0.004)).toBe("alle 1 %");
    expect(percentText(0.0099)).toBe("alle 1 %");
    expect(percentText(0.01)).toBe("1 %");
    expect(percentText(0)).toBe("0 %");
  });
});

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
