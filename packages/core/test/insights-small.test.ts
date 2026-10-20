import { describe, expect, it } from "vitest";
import type { AnalysisContext } from "../src/analysis/context.ts";
import { insightInputOf, rankInsights } from "../src/analysis/insights/index.ts";
import { NO_INPUTS } from "../src/types.ts";
import type { RowSpec } from "./kit/frame.ts";
import { frame, monthly, TODAY, withRows } from "./behaviour-model/household.ts";

const running = { from: `${TODAY.slice(0, 7)}-01`, to: TODAY };
const small = (ctx: AnalysisContext) => rankInsights(insightInputOf(ctx, running, NO_INPUTS)).find((i) => i.id === "small-purchases");
const DAYS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26];

/** A kiosk purchase of 7 € on each of `DAYS` from `fromAgo` months back to `toAgo`. */
const kiosk = (fromAgo: number, toAgo: number, description = "R-KIOSKI HELSINKI", cents = -700): RowSpec[] =>
  DAYS.flatMap((day) => monthly(fromAgo, toAgo, day, { cents, description, mcc: "5499", account: "card" }));

describe("small purchases insight", () => {
  it("hit: purchases under 10 € that grew over the same months a year ago, with the payees and the working", () => {
    const i = small(withRows(kiosk(6, 1)).ctx)!;
    expect(i).toBeDefined();
    expect(i.direction).toBe(1);
    expect(i.tone).toBe("info");
    expect(i.title.replace(/\s/g, " ")).toMatch(/^Alle 10 € ostokset [\d ]+ € kuussa, vuosi sitten [\d ]+ €$/);
    expect(i.detail).toMatch(/R-Kioski/i);
    for (const n of i.title.replace(/ /g, " ").match(/\d+(?: \d{3})*/g)!) expect(i.calc!.some((c) => c.value.replace(/ /g, " ").includes(n))).toBe(true);
  });

  it("hit: a fall is told too, with its sign", () => {
    const i = small(withRows(kiosk(18, 7)).ctx)!;
    expect(i).toBeDefined();
    expect(i.direction).toBe(-1);
  });

  it("near miss: a steady household is quiet", () => {
    expect(small(withRows([]).ctx)).toBeUndefined();
  });

  it("near miss: a rise of 14 € a month is under the gate", () => {
    expect(small(withRows(DAYS.slice(0, 2).flatMap((day) => monthly(6, 1, day, { cents: -700, description: "R-KIOSKI HELSINKI", mcc: "5499", account: "card" }))).ctx)).toBeUndefined();
  });

  it("near miss: a card connected in the middle has no year to compare with", () => {
    const { ctx } = withRows(kiosk(6, 1), { drop: (t) => t.accountId === "card" && t.bookingDate < frame.on(frame.ago(9), 1) });
    expect(small(ctx)).toBeUndefined();
  });

  it("near miss: a move from one kiosk to another with no rise in the total is quiet", () => {
    expect(small(withRows([...kiosk(18, 7, "ALEPA KALLIO HELSINKI"), ...kiosk(6, 1)]).ctx)).toBeUndefined();
  });

  it("near miss: one dear month of small purchases is no change of habit", () => {
    expect(small(withRows([...kiosk(3, 3, "R-KIOSKI HELSINKI", -900), ...kiosk(3, 3, "JÄÄTELÖKIOSKI HELSINKI", -950)]).ctx)).toBeUndefined();
  });
});
