/**
 * The household pays the Gold card by bank transfer to the bank's collection account, and the only text of a payment
 * is a reference number: nothing in it says "card". The card was connected 18 months ago, so its rows before are not
 * in the history. The payments since then pair with the card's incoming rows. The 12 before have no pair. They pay
 * purchases the data does not hold, so each is the card's bill and the card spending of its month, not "Muut menot" and
 * not the largest row of spending (card-channel.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

const CONNECTED_MONTHS_AGO = 18;
/** Where the bank collects the card's payments, and the reference the household pays with. */
const COLLECTION = { counterparty: "NORDEA BANK ABP", iban: "FI8212345600001234", description: "10016 20028" } as const;

export const cardChannel: LifeEvent = {
  id: "card-channel",
  add: (f) => {
    const { out, add } = rows("card-channel", f.today);
    for (const [i, m] of f.months.entries()) {
      // a made-up bill near the household's card spending of a month, since the kit's own bills are dropped
      const cents = 115_000 + 5_000 * (i % 4);
      add({ date: f.on(m, 10), cents: -cents, ...COLLECTION });
      if (m >= f.ago(CONNECTED_MONTHS_AGO)) add({ date: f.on(m, 11), cents, description: `SUORITUS 10.${m.slice(5)}`, account: "card" });
    }
    return out;
  },
  // the kit's worded bills and their card legs, and the card's rows from before it was connected
  drop: (t, f) => t.id.startsWith("bill-") || (t.accountId === "card" && t.bookingDate < f.on(f.ago(CONNECTED_MONTHS_AGO), 1)),
  allows: [],
};
