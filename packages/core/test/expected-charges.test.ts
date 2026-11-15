/**
 * The charges still to come this month, as the Toistuvat page and the overview's forecast count them. Imported from
 * the package index, as the web app does.
 */
import { describe, expect, it } from "vitest";
import { cancelledSubjects, detectRecurring, expectedCharges, NO_INPUTS } from "../src/index.ts";
import { series } from "./helpers.ts";

const today = "2026-10-09";

describe("expectedCharges", () => {
  it("counts every date of a weekly series in the month, not only the next one", () => {
    // every Friday since May; the last one on 2.10., so 9.10., 16.10., 23.10. and 30.10. are still to come
    const txs = series("2026-05-01", 7, 23, -1250, { merchant: "Viikkolehti", category: "subscriptions" });
    const [s] = detectRecurring(txs, today);
    expect(s).toMatchObject({ cadence: "weekly", active: true, overdue: false });
    expect(s!.kind === "subscription" || s!.kind === "bill").toBe(true);
    const coming = expectedCharges([s!], "2026-10-01", "2026-10-31");
    expect(coming.map((c) => c.date)).toEqual(["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    expect(coming.reduce((sum, c) => sum + c.amountCents, 0)).toBe(4 * 1250);
  });

  it("leaves out a merchant the household marked as cancelled", () => {
    const [s] = detectRecurring(series("2026-05-01", 7, 23, -1250, { merchant: "Viikkolehti", category: "subscriptions" }), today);
    const cancelled = cancelledSubjects({ ...NO_INPUTS, marks: [{ subject: "merchant:Viikkolehti", mark: "cancelled", markedAt: "2026-10-05T10:00:00+03:00" }] });
    expect(expectedCharges([s!], "2026-10-01", "2026-10-31", { cancelled })).toEqual([]);
  });
});
