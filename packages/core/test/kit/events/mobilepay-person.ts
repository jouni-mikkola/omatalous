/**
 * Since June the household pays a babysitter 35 € by MobilePay every Friday, and splits restaurant bills with a
 * friend. 0.8.0 review (Optimoi food, habits and household deduction): MobilePay to a person is no restaurant, no
 * habit to cut and no work the deduction covers ("leaves MobilePay to a friend out of food" in
 * optimise/everyday.test.ts, "never counts a MobilePay payment to a person" in optimise/duties.test.ts).
 */
import { addDays, weekdayOf } from "../../../src/dates.ts";
import { type LifeEvent, rows } from "../frame.ts";

export const mobilepayPerson: LifeEvent = {
  id: "mobilepay-person",
  add: (f) => {
    const { out, add } = rows("mobilepay-person", f.today);
    let day = f.on(f.ago(4), 1);
    while (weekdayOf(day) !== 4) day = addDays(day, 1);
    for (; day <= f.today; day = addDays(day, 7)) add({ date: day, cents: -3500, counterparty: "EMMA KORHONEN", description: "MOBILEPAY" });
    for (const m of [f.ago(4), f.ago(2), f.ago(1)]) {
      add({ date: f.on(m, 13), cents: -4200, counterparty: "LIISA VIRTANEN", description: "MOBILEPAY" });
      add({ date: f.on(m, 22), cents: 2850, counterparty: "LIISA VIRTANEN", description: "MOBILEPAY" });
    }
    return out;
  },
  allows: [],
};
