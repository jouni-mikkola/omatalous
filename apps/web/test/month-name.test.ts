/**
 * A month the average leaves out says why. A month that had ended was called "kesken" when an account was linked in
 * the middle of it.
 */
import { describe, expect, it } from "vitest";
import { monthName } from "../src/pages/reports/month-name.ts";

describe("the name of a month in a table of months", () => {
  it("a complete month is its name alone", () => {
    expect(monthName({ month: "2026-08", complete: true }, "2026-11")).toBe("elokuu 2026");
  });
  it("the month that has not ended is in progress, on its last day too", () => {
    expect(monthName({ month: "2026-11", complete: false }, "2026-11")).toBe("marraskuu 2026, kesken");
  });
  it("an ended month the accounts do not cover is partial, not in progress", () => {
    expect(monthName({ month: "2026-09", complete: false }, "2026-11")).toBe("syyskuu 2026, vajaa");
    // last year: no month is running
    expect(monthName({ month: "2025-12", complete: false }, null)).toBe("joulukuu 2025, vajaa");
  });
});
