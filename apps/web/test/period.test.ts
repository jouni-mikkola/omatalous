import { describe, expect, it } from "vitest";
import { pageOfPeriod, periodFor, periodRange, periodsOf, REPORT_PERIODS, shellPeriodsOf } from "../src/period.ts";

const TODAY = "2026-10-11";
const labels = (page: string, today: string) => periodsOf(page, today).map((p) => p.label);

describe("periods belong to one page", () => {
  it("Yhteenveto offers this month and the one before it, Raportit the other five, and no id is on both", () => {
    expect(labels("overview", TODAY)).toEqual(["Lokakuu 2026", "Syyskuu 2026"]);
    expect(labels("reports", TODAY)).toEqual(["3 kk", "6 kk", "12 kk", "Tämä vuosi", "Viime vuosi"]);
    const ids = [...periodsOf("overview", TODAY), ...REPORT_PERIODS].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the ids of the two months stay, so that a bookmark holds, whatever the month is called", () => {
    for (const today of [TODAY, "2027-01-01"]) expect(periodsOf("overview", today).map((p) => p.id)).toEqual(["month", "last-month"]);
  });

  it("names the month by the day's own month, the first day of it and the last alike", () => {
    expect(labels("overview", "2026-10-01")).toEqual(["Lokakuu 2026", "Syyskuu 2026"]);
    expect(labels("overview", "2026-10-31")).toEqual(["Lokakuu 2026", "Syyskuu 2026"]);
    expect(labels("overview", "2026-03-31")).toEqual(["Maaliskuu 2026", "Helmikuu 2026"]);
  });

  it("in January the month before is December of the year before, and in December both are the one year", () => {
    expect(labels("overview", "2027-01-05")).toEqual(["Tammikuu 2027", "Joulukuu 2026"]);
    expect(labels("overview", "2026-12-31")).toEqual(["Joulukuu 2026", "Marraskuu 2026"]);
  });

  it("the labels of Raportit do not depend on the day", () => {
    expect(periodsOf("reports", "2027-01-05")).toEqual(periodsOf("reports", TODAY));
  });

  it("a page without a period switch has no presets", () => {
    for (const page of ["transactions", "optimise", "bills", "settings", "nonsense"]) expect(periodsOf(page, TODAY)).toEqual([]);
  });

  it("the shell draws the switch of Raportit and none for Yhteenveto, which draws its own two months in the block they change", () => {
    expect(shellPeriodsOf("overview", TODAY)).toEqual([]);
    expect(periodsOf("overview", TODAY)).toHaveLength(2);
    expect(shellPeriodsOf("reports", TODAY)).toEqual(REPORT_PERIODS);
    expect(shellPeriodsOf("bills", TODAY)).toEqual([]);
  });

  it("names the page that offers a period", () => {
    for (const p of periodsOf("overview", TODAY)) expect(pageOfPeriod(p.id)).toBe("overview");
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
    // a page without a switch has no period of its own, and a name the page does not own is none either
    expect(periodFor("bills", "last-month")).toBe("month");
    expect(periodFor("overview", "constructor")).toBe("month");
  });

  it("every preset has a range of its own", () => {
    const ranges = [...periodsOf("overview", TODAY), ...REPORT_PERIODS].map((p) => JSON.stringify(periodRange(p.id, TODAY)));
    expect(new Set(ranges).size).toBe(ranges.length);
  });

  it("the range of each month button is the month its label names", () => {
    expect(periodRange("month", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(periodRange("last-month", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // in January the button before it is December of the year before
    expect(periodRange("last-month", "2027-01-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
