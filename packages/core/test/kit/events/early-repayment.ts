/**
 * The household pays 5 000 € off the mortgage in August beside the instalment, which stays the same. 0.7.0 review
 * (insights debt share): an early repayment is no debt service and no rise of fixed costs ("an early repayment is no
 * debt service" in insights.test.ts).
 */
import { IBAN, type LifeEvent, rows } from "../frame.ts";

export const earlyRepayment: LifeEvent = {
  id: "early-repayment",
  add: (f) => {
    const { out, add } = rows("early-repayment", f.today);
    add({ date: f.on(f.ago(2), 14), cents: -500_000, counterparty: "NORDEA BANK ABP", description: "YLIMÄÄRÄINEN LYHENNYS 1234567", iban: IBAN.loan });
    return out;
  },
  allows: [],
};
