import { describe, expect, it } from "vitest";
import { addDays } from "../../src/dates.ts";
import { paydayEffect } from "../../src/behaviour/payday.ts";
import { banking, type RowSpec } from "../kit/frame.ts";
import { frame, withRows } from "./household.ts";

/** `count` extra purchases in the four days from each pay day of the last `cycles` months. */
function afterPay(count: number, cycles: number, spec: Partial<RowSpec> = {}): RowSpec[] {
  const out: RowSpec[] = [];
  for (let back = cycles; back >= 1; back--) {
    const pay = banking(frame.on(frame.ago(back), 25), addDays);
    for (let k = 0; k < count; k++) out.push({ date: addDays(pay, k % 4), cents: -(4_000 + ((k * 1_300 + back * 700) % 3_000)), description: "RAVINTOLA KUUSI HELSINKI", mcc: "5812", account: "card", ...spec });
  }
  return out;
}

describe("D6 payday effect", () => {
  it("tells a strong spike in the four days from pay day, as an estimate with its rows", () => {
    const { ctx, ids } = withRows(afterPay(8, 12));
    const p = paydayEffect(ctx);
    expect(p.told).toBe(true);
    expect(p.ratio!.value).toBeGreaterThanOrEqual(2);
    expect(p.ratio!.confidence).toBe("estimated");
    expect(p.chance).toBe(0.001);
    // the last cycle is still open on the judging day: the spike of the one before is the newest evidence
    expect(p.ratio!.evidence).toEqual(expect.arrayContaining(ids.slice(-16, -8)));
  });

  it("is quiet on a steady household", () => {
    const p = paydayEffect(withRows([]).ctx);
    expect(p.cycles).toHaveLength(12);
    expect(p.told).toBe(false);
  });

  it("does not count bills with a reference number that fall after pay day", () => {
    const bills = afterPay(3, 12, { description: "LASKU", counterparty: "HAMMASLAAKARIASEMA ESIMERKKI OY", account: "chk", mcc: null });
    const { ctx } = withRows(bills.map((b) => ({ ...b, cents: -12_000 })));
    // the reference is a field of the stored row, which RowSpec does not carry: set it on the context's rows
    for (const t of ctx.txs) if (t.merchant.startsWith("Hammas")) (t as { reference?: string }).reference = "RF1853901";
    expect(paydayEffect(ctx).told).toBe(false);
  });

  it("counts one dear purchase on pay day at three times the median purchase", () => {
    const { ctx } = withRows(afterPay(1, 12, { cents: -60_000, description: "STOCKMANN HELSINKI", mcc: "5311" }));
    expect(paydayEffect(ctx).told).toBe(false);
  });

  it("gives no figure under six covered cycles", () => {
    const { ctx } = withRows(afterPay(8, 5), { drop: (t) => t.accountId === "card" && t.bookingDate < frame.on(frame.ago(5), 1) });
    const p = paydayEffect(ctx);
    expect(p.ratio).toBeNull();
    expect(p.told).toBe(false);
  });

  it("skips a cycle whose purchases the bill of a card that is not connected hides", () => {
    const bills = Array.from({ length: 14 }, (_, k): RowSpec => ({ date: frame.on(frame.ago(14 - k), 22), cents: -150_000, counterparty: "MORROW BANK ASA", description: "KORTTILASKU" }));
    const { ctx } = withRows([...afterPay(8, 12), ...bills]);
    const p = paydayEffect(ctx);
    expect(p.skipped.some((s) => s.reason === "card_bill")).toBe(true);
    expect(p.told).toBe(false);
  });
});
