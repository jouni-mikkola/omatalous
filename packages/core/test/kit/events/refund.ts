/**
 * A winter coat of 249,90 € from Zalando in August, sent back and refunded in full two weeks later. 0.8.0 review list:
 * a full refund nets the purchase out, no income, no dear month and no cheaper one after it (returns.ts pairs them).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const refund: LifeEvent = {
  id: "refund",
  add: (f) => {
    const { out, add } = rows("refund", f.today);
    add({ date: f.on(f.ago(2), 3), cents: -24_990, description: "ZALANDO SE BERLIN DE", mcc: "5651", account: "card" });
    add({ date: f.on(f.ago(2), 19), cents: 24_990, description: "ZALANDO SE BERLIN DE", mcc: "5651", account: "card" });
    return out;
  },
  allows: [],
};
