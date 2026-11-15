/**
 * The checking account is the couple's joint account, and the mortgage instalment leaves it on the 5th as it always
 * has. Since April each of them pays a fixed sum into it on the 1st from an own account at another bank, by name:
 * 600 € from him and 400 € from her. The money the two pay in is no pay and no income, and nothing here is a contract
 * to ask about. A member's own view counts their part of the instalment and of the loan, and the sums the two pay in
 * are what the weights of the account are proposed from (account-use-debts.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

/** The two users of the account as their banks name them, and what each pays in a month. */
export const JOINT_PAYERS = [
  { name: "MEIKÄLÄINEN MATTI JUHANI", cents: 60_000 },
  { name: "MEIKÄLÄINEN MAIJA KAARINA", cents: 40_000 },
] as const;

export const jointMortgage: LifeEvent = {
  id: "joint-mortgage",
  add: (f) => {
    const { out, add } = rows("joint-mortgage", f.today);
    for (const m of f.months.slice(-7)) for (const payer of JOINT_PAYERS) add({ date: f.on(m, 1), cents: payer.cents, counterparty: payer.name, description: "SIIRTO-MAKSU" });
    return out;
  },
  allows: [],
};
