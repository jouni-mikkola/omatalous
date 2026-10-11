/**
 * Three cash withdrawals of 100 € on the Gold card in the summer, each with its 3 € withdrawal fee on the card bill.
 * 0.8.0 review (Optimoi card interest and bank fees): a withdrawal fee is no purchase interest ("counts purchase
 * interest only, never withdrawal fees or late interest" in optimise/money.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const withdrawalFees: LifeEvent = {
  id: "withdrawal-fees",
  add: (f) => {
    const { out, add } = rows("withdrawal-fees", f.today);
    for (const m of [f.ago(4), f.ago(3), f.ago(1)]) {
      add({ date: f.on(m, 9), cents: -10_000, description: "OTTO KAMPPI HELSINKI", mcc: "6011", account: "card" });
      add({ date: f.on(m, 9), cents: -300, description: "NOSTOPALKKIO", account: "card" });
    }
    return out;
  },
  allows: [],
};
