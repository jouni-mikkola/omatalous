import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SurplusBridge } from "../src/components/SurplusBridge.tsx";
import type { BridgeTotals } from "../src/components/month-parts.ts";

const html = (totals: Partial<BridgeTotals>) =>
  renderToStaticMarkup(
    createElement(SurplusBridge, { totals: { incomeCents: 1_000_00, consumptionCents: 0, debtCents: 0, savedCents: 0, borrowedCents: 0, leftCents: 0, ...totals } }),
  ).replace(/[  ]/g, " ");
/** The shares under the bar, in the order of the legend. */
const legendShares = (out: string) => [...out.matchAll(/<small>(\d+ %) tuloista<\/small>/g)].map((m) => m[1]);

describe("SurplusBridge: the shares of the income", () => {
  it("add up to 100 as printed: 47,6 / 37,8 / 14,6 print 48, 38 and 14, not 48, 38 and 15", () => {
    // consumption, debt, saved (none) and what stayed
    expect(legendShares(html({ consumptionCents: 476_00, debtCents: 378_00, leftCents: 146_00 }))).toEqual(["48 %", "38 %", "0 %", "14 %"]);
  });

  it("add up to 100 for three equal thirds, the first row taking the extra unit", () => {
    expect(legendShares(html({ incomeCents: 3_00, consumptionCents: 1_00, debtCents: 1_00, leftCents: 1_00 }))).toEqual(["34 %", "33 %", "0 %", "33 %"]);
  });
});
