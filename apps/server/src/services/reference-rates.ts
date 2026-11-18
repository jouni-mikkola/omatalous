/**
 * The daily fetch of the published euribor fixings (providers/reference-rates), kept in `reference_rates` for
 * `requestInputs`. Every loan that follows a euribor rate counts from these. The request carries nothing of the
 * household, and fixings are public data of the whole install.
 *
 * A failure, including a report whose shape changed, stores nothing: the loans keep counting at the fixings stored
 * before, and with none at their typed rate.
 */
import { daysBetween } from "@banking/core";
import { hourIn, todayIn } from "../platform/config.ts";
import { fetchFixings, type Report } from "../providers/reference-rates/client.ts";
import type { Services } from "./context.ts";

/** The fixing of a day is published in the afternoon of the next TARGET day; the zone is the publisher's, not the instance's. */
const PUBLISHER_ZONE = "Europe/Helsinki";
const FROM_HOUR = 18;
/** The day a fetch last stored fixings in. */
const DONE_KEY = "reference_rates_done";
/** The day a failure was last logged in, so the log holds one line a day. */
const FAILED_KEY = "reference_rates_failed";
/** The last-fixing report holds one day: more than this many days since the newest stored one, the daily report fills the gap. */
const GAP_DAYS = 10;

export interface ReferenceRatesResult {
  /** The report fetched, or null when nothing was asked. */
  report: Report | null;
  /** Rows of fixings that were new (one per rate and day). */
  added: number;
  skipped?: "off" | "early" | "done";
  failed?: true;
}

export async function fetchReferenceRates(s: Services): Promise<ReferenceRatesResult> {
  const none: ReferenceRatesResult = { report: null, added: 0 };
  if (!s.config.referenceRates) return { ...none, skipped: "off" };
  const now = s.now();
  if (hourIn(PUBLISHER_ZONE, now) < FROM_HOUR) return { ...none, skipped: "early" };
  const today = todayIn(PUBLISHER_ZONE, now);
  if ((await s.settings.get(DONE_KEY)) === today) return { ...none, skipped: "done" };
  const newest = await s.referenceRates.newestDay();
  const report: Report = newest === null || daysBetween(newest, today) > GAP_DAYS ? "history" : "today";
  try {
    const added = await s.referenceRates.upsert(await fetchFixings(s.fetch ?? fetch, report));
    await s.settings.set(DONE_KEY, today);
    return { report, added };
  } catch (err) {
    if (await s.settings.claim(FAILED_KEY, today)) console.error(`euribor fixings not fetched: ${(err as Error).message}`);
    return { report, added: 0, failed: true };
  }
}
