/**
 * The Gold card's consent ran out in August and nobody renewed it: its rows end there, while checking keeps paying its
 * bill. 0.7.0 review (insights): one account that stopped syncing is no stop of the payments on it ("stopped: one
 * account that stopped syncing is no stop" in insights.test.ts).
 */
import type { LifeEvent } from "../frame.ts";

export const stoppedAccount: LifeEvent = {
  id: "stopped-account",
  add: () => [],
  drop: (t, f) => t.accountId === "card" && t.bookingDate >= f.on(f.ago(2), 1),
  allows: [],
};
