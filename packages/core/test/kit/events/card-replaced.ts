/**
 * The bank replaced the Gold card in mid-August with a new card account: the same purchases on a new account id. H4
 * review: a replaced card is no lag, so the change report keeps its views and stays quiet.
 */
import type { LifeEvent } from "../frame.ts";

export const cardReplaced: LifeEvent = {
  id: "card-replaced",
  add: () => [],
  move: (t, f) => (t.accountId === "card" && t.bookingDate >= f.on(f.ago(2), 15) ? { ...t, accountId: "card2" } : t),
  allows: [],
};
