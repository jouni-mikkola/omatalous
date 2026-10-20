/** The opened row's twelve months on a phone: which months keep their name under the bar. */
import { describe, expect, it } from "vitest";
import { phoneMonthLabels } from "../src/pages/transactions/MerchantDrill.tsx";

const kept = (count: number, peak: number) => phoneMonthLabels(count, peak).flatMap((on, i) => (on ? [i] : []));

describe("phoneMonthLabels", () => {
  it("keeps every third month counted back from the newest, and the peak", () => {
    expect(kept(12, -1)).toEqual([2, 5, 8, 11]);
    expect(kept(12, 0)).toEqual([0, 2, 5, 8, 11]);
    expect(kept(12, 5)).toEqual([2, 5, 8, 11]);
  });

  it("near misses: a month beside the peak gives its name up, so no two kept names stand side by side", () => {
    expect(kept(12, 10)).toEqual([2, 5, 8, 10]);
    expect(kept(12, 3)).toEqual([3, 5, 8, 11]);
    for (let peak = -1; peak < 12; peak++) {
      const at = kept(12, peak);
      for (let j = 1; j < at.length; j++) expect(at[j]! - at[j - 1]!, `peak ${peak}: ${at}`).toBeGreaterThan(1);
      if (peak >= 0) expect(at).toContain(peak);
    }
  });
});
