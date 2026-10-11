/**
 * A dentist's bill of 89 € was forgotten and went to collection: one payment to Intrum in August holds the bill and
 * 35,50 € of collection costs. 0.8.0 review (Optimoi bank and the late fee alert): only the fee is a fee, never the
 * bill inside the same payment ("LASKU 4471 JA PERINTAKULU" in optimise/contracts.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const debtCollector: LifeEvent = {
  id: "debt-collector",
  add: (f) => {
    const { out, add } = rows("debt-collector", f.today);
    add({ date: f.on(f.ago(2), 20), cents: -12_450, counterparty: "INTRUM OY", description: "LASKU 88123 JA PERINTAKULU" });
    return out;
  },
  allows: [],
};
