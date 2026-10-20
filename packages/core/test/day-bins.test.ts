import { describe, expect, it } from "vitest";
import { accountDigits, calendarDays, merchantMonths, moneyBins } from "../src/day-bins.ts";

const day = (date: string, outCents: number, inCents = 0) => ({ date, count: 1, outCents, inCents });

describe("moneyBins", () => {
  it("keeps days up to three months, empty days included, and adds up to the days given", () => {
    const { unit, bins } = moneyBins([day("2026-09-02", 500), day("2026-09-04", 250, 1000)], "2026-09-01", "2026-09-05");
    expect(unit).toBe("day");
    expect(bins.map((b) => b.outCents)).toEqual([0, 500, 0, 250, 0]);
    expect(bins[3]!.inCents).toBe(1000);
  });

  it("goes to weeks starting on Monday, then to months, and leaves out days outside the span", () => {
    const weeks = moneyBins([day("2026-01-07", 100), day("2026-01-11", 200), day("2025-12-01", 999)], "2026-01-01", "2026-06-30");
    expect(weeks.unit).toBe("week");
    expect(weeks.bins[0]!.start).toBe("2025-12-29");
    expect(weeks.bins[1]).toMatchObject({ start: "2026-01-05", outCents: 300, count: 2 });
    expect(weeks.bins.reduce((n, b) => n + b.outCents, 0)).toBe(300);
    const months = moneyBins([day("2024-02-29", 100)], "2023-01-15", "2026-10-19");
    expect(months.unit).toBe("month");
    expect(months.bins[0]!.start).toBe("2023-01-01");
    expect(months.bins.find((b) => b.start === "2024-02-01")!.outCents).toBe(100);
  });
});

describe("moneyBins at the ends of the calendar", () => {
  const rows = [{ date: "2025-03-03", count: 2, inCents: 10, outCents: 700 }];
  const shape = (from: string, to: string) => {
    const { unit, bins } = moneyBins(rows, from, to);
    return [unit, bins.length, bins[0]!.start, bins.at(-1)!.start, bins.filter((b) => b.count).map((b) => b.start).join()];
  };

  // what the bins were before the loops stepped by number: a span a household uses gives the same bins
  it("gives the same bins as before for the spans a household uses", () => {
    expect(shape("2026-09-01", "2026-11-30")).toEqual(["day", 91, "2026-09-01", "2026-11-30", ""]);
    expect(shape("2025-01-01", "2026-12-31")).toEqual(["week", 105, "2024-12-30", "2026-12-28", "2025-03-03"]);
    expect(shape("2026-01-01", "2027-01-12")).toEqual(["week", 55, "2025-12-29", "2027-01-11", ""]);
    expect(shape("2019-05-17", "2026-10-19")).toEqual(["month", 90, "2019-05-01", "2026-10-01", "2025-03-01"]);
  });

  // "10000-01-01" sorts before "9999-12-31": a loop on string order never ended
  it("ends at the year 9999 in months, weeks and days", () => {
    expect(shape("2020-01-01", "9999-12-31")).toEqual(["month", 95_760, "2020-01-01", "9999-12-01", "2025-03-01"]);
    expect(shape("9998-06-01", "9999-12-31").slice(0, 2)).toEqual(["week", 83]);
    expect(shape("9999-10-01", "9999-12-31")).toEqual(["day", 92, "9999-10-01", "9999-12-31", ""]);
  });

  it("starts at the year 100", () => {
    expect(shape("0100-01-01", "2026-10-19")).toEqual(["month", 23_122, "0100-01-01", "2026-10-01", "2025-03-01"]);
  });
});

describe("merchantMonths", () => {
  it("gives the twelve months up to the newest row, oldest first, across a year's end, with their sums and means", () => {
    const { months, year } = merchantMonths({ "2026-01": 3000, "2025-03": 999 }, { "2026-01": 2, "2025-03": 1 }, "2026-02-14");
    expect(months.map((m) => m.month)).toEqual(["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(months[10]).toEqual({ month: "2026-01", count: 2, outCents: 3000, meanCents: 1500 });
    expect(months[1]!.meanCents).toBeNull();
    expect(year).toEqual({ count: 3, outCents: 3999, meanCents: 1333 });
  });

  it("leaves a month before the twelve out", () => {
    expect(merchantMonths({ "2025-02": 500 }, { "2025-02": 1 }, "2026-02-01").year).toEqual({ count: 0, outCents: 0, meanCents: null });
  });
});

describe("accountDigits", () => {
  it("takes the last four of the card mask, else of the IBAN, and nothing from fewer than four", () => {
    expect(accountDigits({ cardMask: "•••• 4242", iban: "FI2112345600000785" })).toBe("4242");
    expect(accountDigits({ cardMask: null, iban: "FI21 1234 5600 0007 85" })).toBe("0785");
    expect(accountDigits({ cardMask: "12", iban: null })).toBeNull();
    expect(accountDigits({})).toBeNull();
  });
});

describe("calendarDays", () => {
  it("fills every day of the span's last 53 weeks, shades money out or in, and keeps today out of the usual day", () => {
    const { days, usualCents } = calendarDays([day("2026-10-01", 1000, 500), day("2026-10-03", 3000), day("2026-10-05", 9999)], "2026-10-01", "2026-10-05", "2026-10-05", false);
    expect(days.map((d) => d.cents)).toEqual([1000, 0, 3000, 0, 9999]);
    expect(usualCents).toBe(2000);
    expect(days[1]!.heat).toBe(0);
    expect(days[2]!.heat).toBeGreaterThan(days[0]!.heat);
    expect(calendarDays([day("2026-10-01", 1000, 500)], "2026-10-01", "2026-10-01", "2026-10-05", true).days[0]!.cents).toBe(500);
    expect(calendarDays([], "2024-01-01", "2026-10-05", "2026-10-05", false).days).toHaveLength(371);
  });

  it("keeps the same 53 weeks as before, and ends at the year 9999", () => {
    const { days } = calendarDays([day("2025-03-03", 700)], "2024-02-01", "2025-03-10", "2025-03-10", false);
    expect([days.length, days[0]!.date, days.at(-1)!.date]).toEqual([371, "2024-03-05", "2025-03-10"]);
    const end = calendarDays([], "2020-01-01", "9999-12-31", "2026-10-19", false).days;
    expect([end.length, end.at(-1)!.date]).toEqual([371, "9999-12-31"]);
  });
});
