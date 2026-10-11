import { describe, expect, it } from "vitest";
import { monthSpan } from "../src/format.ts";

describe("monthSpan", () => {
  it("names the months a usual level is the median of, the last one in full", () => {
    expect(monthSpan(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"])).toBe("maalis–elokuu 2026");
    expect(monthSpan(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"])).toBe("huhti–syyskuu 2026");
  });

  it("shows both years across a year change, and handles one month and none", () => {
    expect(monthSpan(["2025-11", "2025-12", "2026-01"])).toBe("marraskuu 2025–tammikuu 2026");
    expect(monthSpan(["2026-09"])).toBe("syyskuu 2026");
    expect(monthSpan([])).toBe("");
  });
});
