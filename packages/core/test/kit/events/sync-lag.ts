/**
 * The Gold card has not synced for twelve days (the consent waits for renewal); checking is up to date. 0.7.0 review
 * (insights): a sync that lags is no stop of the card's subscriptions and no drop in spending ("stopped: a sync that
 * lags is no stop" in insights.test.ts).
 */
import { addDays } from "../../../src/dates.ts";
import type { LifeEvent } from "../frame.ts";

export const syncLag: LifeEvent = {
  id: "sync-lag",
  add: () => [],
  drop: (t, f) => t.accountId === "card" && t.bookingDate > addDays(f.today, -12),
  allows: [],
};
