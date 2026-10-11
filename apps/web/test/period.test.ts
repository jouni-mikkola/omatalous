import { describe, expect, it } from "vitest";
import { MONTH_PERIODS, pageOfPeriod, periodFor, periodRange, periodsOf, REPORT_PERIODS } from "../src/period.ts";

describe("periods belong to one page", () => {
  it("the month page offers this month and last month, Raportit the other five, and no id is on both", () => {
    expect(periodsOf("overview").map((p) => p.label)).toEqual(["Tämä kuu", "Viime kuu"]);
    expect(periodsOf("reports").map((p) => p.label)).toEqual(["3 kk", "6 kk", "12 kk", "Tämä vuosi", "Viime vuosi"]);
    const ids = [...MONTH_PERIODS, ...REPORT_PERIODS].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a page without a period switch has no presets", () => {
    for (const page of ["transactions", "optimise", "bills", "settings", "nonsense"]) expect(periodsOf(page)).toEqual([]);
  });

  it("names the page that offers a period", () => {
    for (const p of MONTH_PERIODS) expect(pageOfPeriod(p.id)).toBe("overview");
    for (const p of REPORT_PERIODS) expect(pageOfPeriod(p.id)).toBe("reports");
    expect(pageOfPeriod("nonsense")).toBeNull();
    expect(pageOfPeriod("constructor")).toBeNull();
  });

  it("shows the period of the address when the page offers it, else the page's own default", () => {
    expect(periodFor("overview", null)).toBe("month");
    expect(periodFor("overview", "last-month")).toBe("last-month");
    expect(periodFor("reports", null)).toBe("12m");
    expect(periodFor("reports", "last-year")).toBe("last-year");
    // a period of the other page is no period here: it would show a range with no button pressed
    expect(periodFor("overview", "3m")).toBe("month");
    expect(periodFor("reports", "last-month")).toBe("12m");
    expect(periodFor("reports", "nonsense")).toBe("12m");
  });

  it("every preset has a range of its own", () => {
    const ranges = [...MONTH_PERIODS, ...REPORT_PERIODS].map((p) => JSON.stringify(periodRange(p.id, "2026-10-11")));
    expect(new Set(ranges).size).toBe(ranges.length);
  });
});
