/**
 * The child's care hours go up in August, when the new fee decision applies: 279,90 € to 335,00 € a month. 0.8.0
 * review (Optimoi kids): more care hours is no fee rise to contest ("makes no finding for more care hours or a fee at the
 * maximum" in optimise/duties.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const daycareHours: LifeEvent = {
  id: "daycare-hours",
  add: (f) => {
    const { out, add } = rows("daycare-hours", f.today);
    for (const m of f.months.filter((x) => x >= f.ago(2))) add({ date: f.on(m, 8), cents: -33_500, counterparty: "HELSINGIN KAUPUNKI", description: "VARHAISKASVATUSMAKSU" });
    return out;
  },
  drop: (t, f) => t.description === "VARHAISKASVATUSMAKSU" && t.bookingDate >= f.on(f.ago(2), 1),
  allows: [],
};
