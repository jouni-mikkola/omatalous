import { describe, expect, it } from "vitest";
import { addDays, weekdayOf } from "../src/dates.ts";

describe("weekdayOf", () => {
  it("handles days before the epoch", () => {
    expect(weekdayOf("1969-12-28")).toBe(6);
    expect(weekdayOf("1969-12-29")).toBe(0);
    expect(weekdayOf("1970-01-01")).toBe(3);
  });

  it("matches Date for every day 1960-1980", () => {
    for (let day = "1960-01-01"; day <= "1980-12-31"; day = addDays(day, 1)) {
      expect(weekdayOf(day)).toBe((new Date(day).getUTCDay() + 6) % 7);
    }
  });
});
