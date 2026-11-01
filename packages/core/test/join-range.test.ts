import { describe, expect, it } from "vitest";
import { formatEur, joinRange } from "../src/index.ts";

describe("joinRange", () => {
  it("writes the unit once in both languages", () => {
    expect(joinRange(formatEur(431_300, false, "en"), formatEur(465_500, false, "en"))).toBe("€4,313–4,655");
    expect(joinRange(formatEur(431_300, false, "fi"), formatEur(465_500, false, "fi")).replace(/\s/g, " ")).toBe("4 313–4 655 €");
  });

  it("keeps a single figure as it is", () => {
    expect(joinRange("€5", "€5")).toBe("€5");
  });
});
