/**
 * The household draws 4 000 € in February from a finance company that is on no list of lenders, and pays 152 € on the
 * 4th of every month since with only the contract's number in the text. No row says loan or credit: the payee's name
 * does, a limited company with the word for finance in it. The money in is borrowed and no income, and the payments
 * are debt and no shopping.
 */
import { type LifeEvent, rows } from "../frame.ts";

const LENDER = "ESIMERKKIRAHOITUS OY";

export const unknownLender: LifeEvent = {
  id: "unknown-lender",
  add: (f) => {
    const { out, add } = rows("unknown-lender", f.today);
    add({ date: f.on(f.ago(8), 2), cents: 400_000, counterparty: LENDER, description: "SOPIMUS 880123" });
    for (const m of f.months.slice(-8)) add({ date: f.on(m, 4), cents: -15_200, counterparty: LENDER, description: "880123" });
    return out;
  },
  allows: [
    // the instalments, 152 € a month that were not there a year ago: named as loan payments (Kulutusluotot), with no cause made up
    /^change change:season:/,
    /^change change:year:/,
    // fixed costs take a larger share of income than a year ago, by the instalment
    /^insights commitments-share$/,
  ],
};
