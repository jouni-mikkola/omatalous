/**
 * If moves the home insurance from 142,30 € a quarter to 47,43 € a month in April: the same premium a year. 0.8.0
 * review (Optimoi follow-up and insurance): a quarterly charge that became a monthly one of the same total is no
 * saving and no rise ("a quarterly charge that became a monthly one" in optimise/outcome.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const cadenceQuarterlyToMonthly: LifeEvent = {
  id: "cadence-quarterly-to-monthly",
  add: (f) => {
    const { out, add } = rows("cadence-quarterly-to-monthly", f.today);
    for (const m of f.months.filter((x) => x >= f.ago(6))) add({ date: f.on(m, 5), cents: -4743, counterparty: "IF VAHINKOVAKUUTUS OY", description: "VAKUUTUSMAKSU" });
    return out;
  },
  drop: (t, f) => t.counterparty === "IF VAHINKOVAKUUTUS OY" && t.bookingDate >= f.on(f.ago(6), 1),
  allows: [
    // October pays 47,43 € instead of a quarter's 142,30 €, told as an amount without a cause
    /^change change:season:/,
  ],
};
