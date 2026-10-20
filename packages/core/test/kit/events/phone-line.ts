/**
 * The child gets a phone in May: a second line on the family's Elisa bill, 19,90 € to 39,80 €. 0.8.0 review
 * (Optimoi subscriptions): a step that doubles a phone bill is a new line, no price rise (the "sub-line" near miss in
 * optimise/parts/subscriptions.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const phoneLine: LifeEvent = {
  id: "phone-line",
  add: (f) => {
    const { out, add } = rows("phone-line", f.today);
    for (const m of f.months.filter((x) => x >= f.ago(5))) add({ date: f.on(m, 20), cents: -3980, counterparty: "ELISA OYJ", description: "E-LASKU" });
    return out;
  },
  drop: (t, f) => t.counterparty === "ELISA OYJ" && t.bookingDate >= f.on(f.ago(5), 1),
  allows: [],
};
