/**
 * One payer, two regular incomes: a benefits office pays a housing allowance of one sum each month and an unemployment
 * benefit every second week whose sum moves with the days of the period. Each is its own series, so the pay the
 * household waits for is whichever comes next. Made-up sums only.
 */
import { describe, expect, it } from "vitest";
import { detectRecurring } from "../src/recurring.ts";
import { series, tx } from "./helpers.ts";

const today = "2026-10-09";
const payer = { merchant: "Kansanelakelaitos", category: "benefits" } as const;
/** 412,50 € on the first of each month, ten months. */
const allowance = Array.from({ length: 10 }, (_, i) => tx({ ...payer, bookingDate: `2026-${String(i + 1).padStart(2, "0")}-01`, amountCents: 41_250, description: "YLEINEN ASUMISTUKI" }));
/** Every second Monday from 5.1.2026, 520 to 560 euros. */
const benefit = series("2026-01-05", 14, 20, (i) => 52_000 + ((i * 7) % 5) * 1_000, { ...payer, description: "TYÖMARKKINATUKI" });

describe("two incomes of one payer", () => {
  it("are two series: the monthly one of one sum and the biweekly one whose sum moves", () => {
    const found = detectRecurring([...allowance, ...benefit], today).filter((s) => s.kind === "income");
    expect(found.map((s) => s.cadence).sort()).toEqual(["biweekly", "monthly"]);
    const biweekly = found.find((s) => s.cadence === "biweekly")!;
    expect(biweekly.transactionIds).toHaveLength(benefit.length);
    expect(biweekly.nextDate).toBe("2026-10-12");
  });

  it("leaves a payer with one income of a moving sum one series, as before", () => {
    const found = detectRecurring(benefit, today);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).not.toContain("#");
  });
});
