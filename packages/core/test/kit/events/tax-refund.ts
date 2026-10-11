/**
 * Verohallinto pays a tax refund of 612,34 € in August, the first in the history. 0.7.0 review (income): a refund is a
 * one-off from Verohallinto, no raise, no new source and no income that outgrows spending ("takes a tax refund only from
 * Verohallinto as the payer" in income.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const taxRefund: LifeEvent = {
  id: "tax-refund",
  add: (f) => {
    const { out, add } = rows("tax-refund", f.today);
    add({ date: f.on(f.ago(2), 11), cents: 61_234, counterparty: "VEROHALLINTO", description: "VERONPALAUTUS" });
    return out;
  },
  allows: [],
};
