/**
 * From March to August the household pays 600 € of each Gold bill and leaves the rest on the card. The bank charges
 * interest on what is carried on the 1st of the next month, April to September: 6 € on the first 418 € and 54 € on the
 * last 3 600 €, 209 € in all. LN7 (0.8.7): the interest is a cost of its own and is told once; a bill paid in part is
 * no change of spending and no contract that ended.
 */
import { type LifeEvent, rows } from "../frame.ts";

/** What the bank charged for the balance carried from the bill before, oldest first. */
const INTEREST = [600, 2400, 3200, 4300, 5000, 5400];

export const balanceCarried: LifeEvent = {
  id: "balance-carried",
  add: (f) => {
    const { out, add } = rows("balance-carried", f.today);
    INTEREST.forEach((cents, i) => {
      const billed = f.ago(7 - i);
      add({ date: f.on(billed, 10), cents: -60_000, counterparty: "NORDEA RAHOITUS SUOMI OY", description: "NORDEA GOLD LASKU" });
      add({ date: f.on(billed, 10), cents: 60_000, counterparty: "NORDEA RAHOITUS SUOMI OY", description: "MAKSU, KIITOS", account: "card" });
      add({ date: f.on(f.ago(6 - i), 1), cents: -cents, description: "KORKO", account: "card" });
    });
    return out;
  },
  // the bills of March to August in full give way to the 600 € above
  drop: (t, f) => t.id.startsWith("bill-") && t.bookingDate >= f.on(f.ago(7), 1) && t.bookingDate <= f.on(f.ago(2), 28),
  allows: [
    // the 209 € of interest, charged in six of the last twelve months
    /^insights card-interest$/,
    // the interest of the months when checking held enough to pay the card's debt
    /^optimise loans:card_interest$/,
  ],
};
