/**
 * The household closed the Gold card in mid-August and pays with the debit card of checking since: the same purchases
 * on another account. H4 review: a closed card is no lag, so the change report keeps its views and stays quiet.
 */
import type { LifeEvent } from "../frame.ts";

export const cardClosed: LifeEvent = {
  id: "card-closed",
  add: () => [],
  move: (t, f) => (t.accountId === "card" && t.bookingDate >= f.on(f.ago(2), 15) ? { ...t, accountId: "chk" } : t),
  allows: [],
};
