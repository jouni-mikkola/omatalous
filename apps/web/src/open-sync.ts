import { dateTime, localDay } from "./format.ts";
import { t } from "./text.ts";

/** What `POST /api/sync/open` answers: whether rows were fetched when the app was opened, and when. */
export type OpenSync = {
  state: "none" | "fresh" | "partial" | "running" | "limited" | "failed";
  lastAt: string | null;
  inserted: number;
  nextAt: string | null;
};

/** A time as the page reads it: "23.10. klo 18.02", with the year when it is not this year. */
const stamp = (iso: string, now: Date): string => dateTime(iso, localDay(now.toISOString()));

/**
 * What the foot of the page says about the fetch, or null when the rows are current: that a fetch is running, that the
 * bank holds the next one back, or that some accounts were left out. The last two are the states where the figures are
 * older than the reader expects, so they carry the time of the last fetch. A fetch that went well says nothing, as its
 * time is in Asetukset > Pankit ja tilit. A failed fetch is not here: it rises to the top of the page (`failureText`).
 */
export function footText(answer: OpenSync | null, now: Date): string | null {
  if (!answer) return null;
  const { state, lastAt, nextAt } = answer;
  switch (state) {
    case "partial":
      return lastAt ? t("sync.partial", { updated: t("sync.updated", { stamp: stamp(lastAt, now) }) }) : null;
    case "running":
      return t("sync.running");
    case "limited": {
      const limit = nextAt ? t("sync.next", { stamp: stamp(nextAt, now) }) : t("sync.no_next");
      return lastAt ? t("sync.limited", { updated: t("sync.updated", { stamp: stamp(lastAt, now) }), limit }) : limit;
    }
    default:
      return null;
  }
}

/** The exception that rises to the top of the page: the fetch failed. Everything else is quiet. */
export function failureText(answer: OpenSync | null, now: Date): string | null {
  if (answer?.state !== "failed") return null;
  const failed = t("sync.failed");
  return answer.lastAt ? t("sync.failed_last", { failed, stamp: stamp(answer.lastAt, now) }) : failed;
}

/** The page asks when it was never asked, or the last question is a minute old. */
export function shouldAsk(lastAskedMs: number | null, nowMs: number): boolean {
  return lastAskedMs === null || nowMs - lastAskedMs >= 60_000;
}

export const RUNNING_RETRY_MS = 3000;
export const RUNNING_RETRIES = 40;
