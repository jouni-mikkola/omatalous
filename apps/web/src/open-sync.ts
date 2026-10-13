import { clockTime } from "./pages/settings/remote-access-model.ts";

/** What `POST /api/sync/open` answers: whether rows were fetched when the app was opened, and when. */
export type OpenSync = {
  state: "none" | "fresh" | "running" | "limited" | "failed";
  lastAt: string | null;
  inserted: number;
  nextAt: string | null;
};

/** A time as the page reads it: "klo 18.02", and with the date in front when it is not today, "12.10. klo 18.02". */
function stamp(iso: string, now: Date): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === now.toDateString();
  return `${sameDay ? "" : `${at.getDate()}.${at.getMonth() + 1}. `}klo ${clockTime(iso)}`;
}

/** The one line at the top of the page, or null when there is nothing to say. */
export function lineText(answer: OpenSync | null, now: Date): string | null {
  if (!answer) return null;
  const { state, lastAt, nextAt } = answer;
  switch (state) {
    case "fresh":
      return lastAt ? `Tapahtumat päivitetty ${stamp(lastAt, now)}` : null;
    case "running":
      return "Haetaan tapahtumia pankista…";
    case "limited": {
      const limit = `Pankki rajoittaa hakukertoja${nextAt ? `, seuraava haku ${stamp(nextAt, now)}` : ""}.`;
      return lastAt ? `Tapahtumat päivitetty ${stamp(lastAt, now)}. ${limit}` : limit;
    }
    case "failed":
      return `Tapahtumien haku pankista epäonnistui.${lastAt ? ` Edellinen haku ${stamp(lastAt, now)}.` : ""}`;
    default:
      return null;
  }
}

/** The page asks when it was never asked, or the last question is a minute old. */
export function shouldAsk(lastAskedMs: number | null, nowMs: number): boolean {
  return lastAskedMs === null || nowMs - lastAskedMs >= 60_000;
}

export const RUNNING_RETRY_MS = 3000;
export const RUNNING_RETRIES = 40;
