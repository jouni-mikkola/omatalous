/**
 * The household buys a car on finance in May: from then on 289 € leaves on the 15th of every month to the car maker's
 * finance company, with the contract's number in the text. Since 0.8.7 the instalments are debt whoever the lender
 * is, the series is proposed as a loan (loan-detect.test.ts), and a loan that starts is no subscription to ask about
 * and no price that rose.
 */
import { type LifeEvent, rows } from "../frame.ts";

export const carLoan: LifeEvent = {
  id: "car-loan",
  add: (f) => {
    const { out, add } = rows("car-loan", f.today);
    for (const m of f.months.slice(-6)) add({ date: f.on(m, 15), cents: -28_900, counterparty: "TOYOTA FINANCE FINLAND OY", description: "AUTORAHOITUS 44512" });
    return out;
  },
  allows: [
    // the instalments, 289 € a month that were not there a year ago: named as loan payments, with no cause made up
    /^change change:season:/,
    /^change change:year:/,
    // fixed costs take a larger share of income than a year ago, by the instalment
    /^insights commitments-share$/,
  ],
};
