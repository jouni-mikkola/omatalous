/**
 * The Gold card was connected in May, months after checking: its purchases before are not in the history. H4 review:
 * months before a paying account's first row are not compared, so its purchases do not read as more spending.
 */
import type { LifeEvent } from "../frame.ts";

export const cardConnectedLate: LifeEvent = {
  id: "card-connected-late",
  add: () => [],
  drop: (t, f) => t.accountId === "card" && t.bookingDate < f.on(f.ago(5), 1),
  allows: [],
};
