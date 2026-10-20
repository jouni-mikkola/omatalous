/**
 * Delivery food (R1 §3.1): how often the household orders food home. An order is one row of `food_delivery` that cost
 * something in the end (`isPurchase`). Groceries brought home (Wolt Market, Foodora Market) are groceries, and a
 * recurring fee (a Wolt+ membership, a series of `ctx.recurring`) is no order. A refund lowers the cents, never the count.
 */
import type { AnalysisTx } from "../analysis/context.ts";
import { fold } from "../merchant.ts";
import { isDeliveryMarket } from "../wording-shops.ts";
import { type Counter, type Covers, type Tally, type Windows, p80, usualWeekly } from "./week.ts";

/** A delivery company's shop of groceries: the row is groceries for the counts. */
export const isMarket = (t: AnalysisTx): boolean => t.category === "food_delivery" && isDeliveryMarket(fold(t.merchant));

/** Orders above usual: by this many or more, and above the 80th percentile of the covered weeks. */
const ABOVE_BY = 2;

export interface DeliveryBehaviour {
  week: Tally;
  month: Tally;
  lastMonth: Tally;
  /** The median orders a week over the covered weeks before (see `usualWeekly`); null without it. */
  usual: number | null;
  /** The week's orders are above the usual level (see the head). */
  above: boolean;
  covered: boolean;
  confidence: "known" | "estimated";
  /** The orders of the told week. */
  evidenceIds: string[];
  /**
   * Is the row a purchase of the delivery category: a meal ordered or a delivery company's groceries, never a fee?
   * The one definition: an order is such a row that is no market (`isMarket`), and Raportit > Ruoka counts these in
   * its delivery line, where their cents are.
   */
  isDeliveryPurchase: (t: AnalysisTx) => boolean;
}

export function deliveryOf(c: Counter, w: Windows, covers: Covers, isDeliveryPurchase: (t: AnalysisTx) => boolean): DeliveryBehaviour {
  const week = c.tally("week", covers);
  const usual = usualWeekly(c.byWeek, w, covers);
  return {
    week,
    month: c.tally("month", covers),
    lastMonth: c.tally("lastMonth", covers),
    usual: usual?.usual ?? null,
    above: !!usual && week.count >= usual.usual + ABOVE_BY && week.count > p80(usual.values),
    covered: week.covered,
    confidence: week.covered ? "known" : "estimated",
    evidenceIds: c.ids,
    isDeliveryPurchase,
  };
}
