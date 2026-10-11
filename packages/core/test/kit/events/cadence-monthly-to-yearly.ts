/**
 * The household pays Helsingin Sanomat for a year in July, 329 € once, instead of 32,90 € a month. 0.8.0 review
 * (Optimoi follow-up, insights): a monthly fee that became one yearly payment is no stopped subscription and no price
 * rise ("a monthly fee that became one yearly payment" in optimise/outcome.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const cadenceMonthlyToYearly: LifeEvent = {
  id: "cadence-monthly-to-yearly",
  add: (f) => {
    const { out, add } = rows("cadence-monthly-to-yearly", f.today);
    add({ date: f.on(f.ago(3), 18), cents: -32_900, counterparty: "SANOMA MEDIA FINLAND OY", description: "HELSINGIN SANOMAT DIGI 12 KK" });
    return out;
  },
  drop: (t, f) => t.description === "HELSINGIN SANOMAT DIGI" && t.bookingDate >= f.on(f.ago(3), 1),
  allows: [],
};
