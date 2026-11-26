import { describe, expect, it } from "vitest";
import { datumOf } from "../src/pages/reports/sections/YearOverYear.tsx";
import { t } from "../src/text.ts";

describe("the figure beside the title of the year comparison", () => {
  const months = (n: number) => Array.from({ length: 12 }, (_, i) => (i < n ? 1 : null));
  it("names the months it sums when only some are compared, never the whole year", () => {
    const datum = datumOf({ year: 2026, current: months(11), comparedMonths: [4, 5, 6, 7], ytdCents: 12_345_00 }, false);
    expect(datum).toContain("huhti–heinäkuu 2026");
    expect(datum).not.toContain(t("period.year"));
  });
  it("says so far when every month of the year so far is compared, and the year for a whole past year", () => {
    expect(datumOf({ year: 2026, current: months(10), comparedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ytdCents: 100_00 }, false)).toContain("2026 tähän asti");
    expect(datumOf({ year: 2025, current: months(12), comparedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ytdCents: 100_00 }, true)).toMatch(/, 2025$/);
  });
});
