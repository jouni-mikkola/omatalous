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

  it("makes no series of a piece of a salary whose sum moves a lot", () => {
    // the 25th of each month from 10.2025: nine months near 2 500 € and four between 3 000 and 3 600 €, then a bonus and three small sums
    const sums = [250_000, 300_000, 248_000, 252_000, 330_000, 251_000, 249_000, 360_000, 250_000, 253_000, 310_000, 247_000, 250_000];
    const salary = sums.map((cents, i) => tx({ merchant: "Esimerkki Oy", category: "salary", bookingDate: `${2025 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, "0")}-25`, amountCents: cents }));
    const odd = [["2026-03-10", 150_000], ["2026-04-03", 2_300], ["2026-06-17", 4_100], ["2026-08-08", 3_200]].map(([bookingDate, amountCents]) =>
      tx({ merchant: "Esimerkki Oy", category: "salary", bookingDate: bookingDate as string, amountCents: amountCents as number }),
    );
    const found = detectRecurring([...salary, ...odd], today).filter((s) => s.kind === "income");
    expect(found.filter((s) => s.transactionIds.length < salary.length)).toEqual([]);
  });

  it("keeps one salary one income beside the employer's refunds: a larger sum every third month, a raise", () => {
    // the 25th of each month from 11.2025, overtime every third month, and six refunds of costs on other days
    const sums = [250_000, 248_000, 310_000, 255_000, 251_000, 320_000, 249_000, 252_000, 305_000, 254_000, 250_000, 315_000];
    const salary = sums.map((cents, i) => tx({ merchant: "Esimerkki Oy", category: "salary", bookingDate: `${2025 + Math.floor((10 + i) / 12)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}-25`, amountCents: cents }));
    const refunds = [["2025-12-08", 4_500], ["2026-01-19", 12_000], ["2026-03-03", 6_100], ["2026-04-14", 30_000], ["2026-06-09", 2_400], ["2026-08-12", 8_800]].map(([bookingDate, amountCents]) =>
      tx({ merchant: "Esimerkki Oy", category: "salary", bookingDate: bookingDate as string, amountCents: amountCents as number }),
    );
    const found = detectRecurring([...salary, ...refunds], today).filter((s) => s.kind === "income");
    // the larger sums are no quarterly income of their own: the next pay is one salary on the 25th
    expect(found.filter((s) => s.cadence !== "monthly")).toEqual([]);
    expect(found.map((s) => s.nextDate)).toEqual(["2026-10-25"]);
    // a salary whose sum moves every month too: one income on the 25th, of the usual sum, and still no quarterly one
    const moving = salary.map((t, i) => ({ ...t, amountCents: t.amountCents + ((i * 37) % 9) * 2_500 }));
    const one = detectRecurring([...moving, ...refunds], today).filter((s) => s.kind === "income");
    expect(one.map((s) => [s.cadence, s.nextDate])).toEqual([["monthly", "2026-10-25"]]);
    expect(one[0]!.typicalAmountCents).toBeLessThan(300_000);
    // a raise of a fifth after half a year, a sum that moves by 5 % every month: the sums before and after are two
    // clusters with a cadence each, and one salary
    const raisedSums = [250_000, 262_000, 251_000, 263_000, 250_500, 262_500, 300_000, 314_000, 301_000, 315_000, 300_500, 314_500];
    const raised = salary.map((t, i) => ({ ...t, amountCents: raisedSums[i]! }));
    const after = detectRecurring([...raised, ...refunds], today).filter((s) => s.kind === "income");
    expect(after.map((s) => [s.cadence, s.transactionIds.length, s.nextDate])).toEqual([["monthly", 11, "2026-10-25"]]);
    expect(after[0]!.typicalAmountCents).toBeGreaterThan(300_000);
  });

  it("makes no income of a shop's refunds that come a month apart", () => {
    const shop = { merchant: "Esimerkkikauppa", category: "reimbursements" } as const;
    const rows = [["2026-01-10", 1_990], ["2026-02-09", 2_190], ["2026-03-11", 2_090], ["2026-03-15", 899], ["2026-06-01", 4_999]].map(([bookingDate, amountCents]) =>
      tx({ ...shop, bookingDate: bookingDate as string, amountCents: amountCents as number }),
    );
    expect(detectRecurring(rows, today)).toEqual([]);
  });

  it("leaves a payer with one income of a moving sum one series, as before", () => {
    const found = detectRecurring(benefit, today);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).not.toContain("#");
  });
});
