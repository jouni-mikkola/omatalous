import { describe, expect, it } from "vitest";
import { eurosText, parseEuros, parseRate, rateText } from "../src/format.ts";

describe("the texts of amount and rate inputs", () => {
  it("writes cents and hundredths of a percent as the household types them, with plain spaces", () => {
    expect(eurosText(12_345_678)).toBe("123 456,78");
    expect(eurosText(50)).toBe("0,50");
    expect(rateText(325)).toBe("3,25");
    expect(rateText(5)).toBe("0,05");
    expect(rateText(1000)).toBe("10,00");
  });

  it("reads what it wrote, and rounds a rate to hundredths, a half up", () => {
    for (const cents of [0, 1, 99_999, 12_345_678]) expect(parseEuros(eurosText(cents))).toBe(cents);
    for (const bp of [0, 5, 325, 5000]) expect(parseRate(rateText(bp))).toBe(bp);
    expect(parseRate("3.255 %")).toBe(326);
    expect(parseRate("3,254")).toBe(325);
    expect(parseRate("3,25 %")).toBe(325);
    expect(parseRate("neljä")).toBeNull();
    expect(parseRate("")).toBeNull();
  });
});
