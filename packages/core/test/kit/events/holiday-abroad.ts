/**
 * Two weeks in Spain in July: flights and a hotel booked in March, then groceries, restaurants and a car abroad on the
 * Gold card. 0.7.0 and 0.8.0 reviews (spending change, Optimoi habits and seasons): a holiday is one dear month, no
 * habit that grew and no season to plan for unless it repeats ("prices July by the extra interest after it in both
 * years" in optimise/everyday.test.ts needs two years).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const holidayAbroad: LifeEvent = {
  id: "holiday-abroad",
  add: (f) => {
    const { out, add } = rows("holiday-abroad", f.today);
    const july = f.ago(3);
    add({ date: f.on(f.ago(7), 9), cents: -124_000, description: "FINNAIR OYJ HELSINKI-VANTAA", mcc: "3005", account: "card" });
    add({ date: f.on(f.ago(7), 9), cents: -89_000, description: "BOOKING.COM AMSTERDAM NL", mcc: "7011", account: "card" });
    add({ date: f.on(july, 6), cents: -31_500, description: "GOLDCAR MALAGA ES", mcc: "7512", account: "card" });
    for (let d = 6; d <= 19; d++) {
      add({ date: f.on(july, d), cents: -(2600 + ((d * 37) % 23) * 100), description: "MERCADONA MALAGA ES", mcc: "5411", account: "card" });
      if (d % 2 === 0) add({ date: f.on(july, d), cents: -(4800 + ((d * 53) % 31) * 100), description: "RESTAURANTE EL PIMPI MALAGA ES", mcc: "5812", account: "card" });
    }
    return out;
  },
  allows: [
    // the trip cost about 3 500 € the year before did not have, named as one-off travel
    /^change change:year:/,
  ],
};
