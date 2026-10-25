/**
 * The household draws a consumer credit of 8 000 € in August, buys a used car for 6 500 € two days later and pays the
 * first instalments in September and October. 0.8.7 review (Tulos and the bridge): money a lender pays out is
 * borrowed and no income, it is in Tulos, and the month of the car is covered with credit and is no loss the size of
 * the car (ADR 0014). No other household of the kit, the demo or the seeds has a borrowed row.
 */
import { type LifeEvent, rows } from "../frame.ts";

export const CREDIT_DRAWN_CENTS = 800_000;

export const creditDrawn: LifeEvent = {
  id: "credit-drawn",
  add: (f) => {
    const { out, add } = rows("credit-drawn", f.today);
    add({ date: f.on(f.ago(2), 10), cents: CREDIT_DRAWN_CENTS, counterparty: "SANTANDER CONSUMER FINANCE OY", description: "LUOTON NOSTO 55512345" });
    add({ date: f.on(f.ago(2), 12), cents: -650_000, counterparty: "AUTOLIIKE ESIMERKKI OY", description: "AUTOKAUPPA ABC-123" });
    for (const back of [1, 0]) add({ date: f.on(f.ago(back), 10), cents: -21_500, counterparty: "SANTANDER CONSUMER FINANCE OY", description: "KULUTUSLUOTTO 55512345 LYHENNYS" });
    return out;
  },
  allows: [
    // the car, named as a one-off
    /^change change:year:/,
  ],
};
