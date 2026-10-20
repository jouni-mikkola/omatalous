import { describe, expect, it } from "vitest";
import { insightInputOf, rankInsights } from "../src/analysis/insights/index.ts";
import { addDays } from "../src/dates.ts";
import { NO_INPUTS } from "../src/types.ts";
import type { AnalysisContext } from "../src/analysis/context.ts";
import { banking, type RowSpec } from "./kit/frame.ts";
import { frame, TODAY, withRows } from "./behaviour-model/household.ts";

/** `count` extra purchases in the four days from each pay day of the last `cycles` months. */
function afterPay(count: number, cycles: number, spec: Partial<RowSpec> = {}): RowSpec[] {
  const out: RowSpec[] = [];
  for (let back = cycles; back >= 1; back--) {
    const pay = banking(frame.on(frame.ago(back), 25), addDays);
    for (let k = 0; k < count; k++) out.push({ date: addDays(pay, k % 4), cents: -(4_000 + ((k * 1_300 + back * 700) % 3_000)), description: "RAVINTOLA KUUSI HELSINKI", mcc: "5812", account: "card", ...spec });
  }
  return out;
}

const running = { from: `${TODAY.slice(0, 7)}-01`, to: TODAY };
const payday = (ctx: AnalysisContext, range = running) => rankInsights(insightInputOf(ctx, range, NO_INPUTS)).find((i) => i.id === "payday");

describe("payday insight", () => {
  it("hit: tells the days after pay with the figure of D6 over a year of pays, its rows and its working", () => {
    const { ctx } = withRows(afterPay(8, 12));
    const i = payday(ctx)!;
    expect(i).toBeDefined();
    expect(i.tone).toBe("info");
    expect(i.direction).toBe(1);
    expect(i.title).toMatch(/^Palkan jälkeen rahaa menee \d,\d kertaa nopeammin$/);
    expect(i.rows!.length).toBeGreaterThan(0);
    expect(i.rows!.length).toBeLessThanOrEqual(60);
    const cycle = Number(i.calc!.find((c) => c.label.startsWith("Palkkoja vuodessa"))!.value);
    expect(cycle).toBeGreaterThanOrEqual(11);
    expect(i.calc!.map((c) => c.value)).toContain(i.title.match(/\d,\d/)![0]);
  });

  it("near miss: a steady household is quiet", () => {
    expect(payday(withRows([]).ctx)).toBeUndefined();
  });

  it("near miss: bills with a reference number after pay day are no spending of pay", () => {
    const bills = afterPay(3, 12, { description: "LASKU", counterparty: "HAMMASLAAKARIASEMA ESIMERKKI OY", account: "chk", mcc: null });
    const { ctx } = withRows(bills.map((b) => ({ ...b, cents: -12_000 })));
    for (const t of ctx.txs) if (t.merchant.startsWith("Hammas")) (t as { reference?: string }).reference = "RF1853901";
    expect(payday(ctx)).toBeUndefined();
  });

  it("near miss: one dear purchase on each pay day is no habit", () => {
    expect(payday(withRows(afterPay(1, 12, { cents: -60_000, description: "STOCKMANN HELSINKI", mcc: "5311" })).ctx)).toBeUndefined();
  });

  it("near miss: five covered cycles are too few", () => {
    const { ctx } = withRows(afterPay(8, 5), { drop: (t) => t.accountId === "card" && t.bookingDate < frame.on(frame.ago(5), 1) });
    expect(payday(ctx)).toBeUndefined();
  });

  it("near miss: a period that ended before today is quiet, the detector judges on today", () => {
    const { ctx } = withRows(afterPay(8, 12));
    expect(payday(ctx, { from: frame.on(frame.ago(2), 1), to: addDays(frame.on(frame.ago(1), 1), -1) })).toBeUndefined();
  });
});
