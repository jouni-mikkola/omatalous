/**
 * Since May the other adult of the household sends her share of the shopping to the checking account each month, with
 * her bank's own word for a payment by phone number, and is paid back small sums by MobilePay, which the bank books as
 * card purchases. Her first name is the phone company's: read as a shop, her money was a phone bill paid back and the
 * money to her a second phone line. Nothing here is pay, a bill or a habit to cut.
 */
import { type LifeEvent, rows } from "../frame.ts";

const NAME = "KORHONEN ELISA MARIA";

export const coHolderTransfer: LifeEvent = {
  id: "co-holder-transfer",
  add: (f) => {
    const { out, add } = rows("co-holder-transfer", f.today);
    for (const m of f.months.slice(-6)) {
      add({ date: f.on(m, 3), cents: 15_000, counterparty: NAME, description: "SIIRTO-MAKSU" });
      add({ date: f.on(m, 17), cents: -2500, counterparty: "MOB.PAY*ELISA MARIA KORHO", description: "12345678 HELSINKI", account: "card" });
    }
    return out;
  },
  allows: [],
};
