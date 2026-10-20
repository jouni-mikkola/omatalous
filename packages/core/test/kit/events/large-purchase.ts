/**
 * A new television for 1 499 € on the Gold card in September. 0.7.0 review (month explanation and insights): one
 * large payment explains its month and is no habit, no new subscription and no trend ("A single month shows no swing
 * insights and no largest purchase" in the 0.7.0 changelog).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const largePurchase: LifeEvent = {
  id: "large-purchase",
  add: (f) => {
    const { out, add } = rows("large-purchase", f.today);
    add({ date: f.on(f.ago(1), 6), cents: -149_900, description: "GIGANTTI HELSINKI ITIS", mcc: "5732", account: "card" });
    return out;
  },
  allows: [
    // the television, named as a one-off
    /^change change:year:/,
  ],
};
