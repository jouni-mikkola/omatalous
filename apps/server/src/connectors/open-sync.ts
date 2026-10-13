/**
 * A member opens the app: if their rows are older than half an hour, a fetch of their own connections starts in
 * the background, inside what the bank allows. The answer is at once and never waits for the bank.
 */
import { hourIn } from "../platform/config.ts";
import type { Services } from "../services/context.ts";
import { rateLimitedUntil } from "./bank-limit.ts";
import { LOCK_TTL_MS, syncUser } from "./sync.ts";

const FRESH_MINUTES = 30;

/** The trigger of an open that carried the member's headers; any other trigger is a fetch without them. */
const WITH_HEADERS = "open";
const WITHOUT_HEADERS = "open-bare";

/** A bank allows about this many fetches a day made without the user present. */
const UNATTENDED_PER_DAY = 4;

interface OpenAnswer {
  state: "none" | "fresh" | "running" | "limited" | "failed";
  lastAt: string | null;
  inserted: number;
  nextAt: string | null;
}

/** The start of the next sync hour as an ISO time, or null when there is none. Looked for on a quarter-hour grid, which every time zone's hours fall on. */
function nextSyncHour(s: Services, now: Date): string | null {
  const { timezone, syncHours } = s.instance.current;
  if (!syncHours.length) return null;
  const step = 15 * 60_000;
  let t = Math.floor(now.getTime() / step) * step + step;
  for (let i = 0; i < 24 * 4 + 1; i++, t += step) {
    const hour = hourIn(timezone, new Date(t));
    if (syncHours.includes(hour) && hourIn(timezone, new Date(t - step)) !== hour) return new Date(t).toISOString();
  }
  return null;
}

/**
 * `userHeaders` are the member's Psu headers (psu.ts), or null when they cannot be given. A fetch with them counts as
 * made with the user present: only the half hour limits it. One without them is started only while the member's runs of
 * the last 24 hours that were neither scheduled nor carried headers are fewer than 4 less the sync hours: any 24 hours
 * then hold the scheduled runs and at most that many others, never over four.
 */
export async function openSync(s: Services, userId: string, userHeaders: Readonly<Record<string, string>> | null): Promise<OpenAnswer> {
  const repo = s.finance(userId);
  if (!(await repo.listConnections()).some((c) => c.status === "active")) return { state: "none", lastAt: null, inserted: 0, nextAt: null };

  // the stored times are the machine's clock, so ages are too (s.now() is the household's clock and can be a test's)
  const now = Date.now();
  const runs = await repo.listSyncRuns(200);
  const finished = runs.filter((r) => r.status !== "running" && r.finishedAt);
  const newest = finished[0];
  const lastAt = finished.find((r) => r.status !== "failed")?.finishedAt ?? null;
  const answer = (state: OpenAnswer["state"], extra: Partial<OpenAnswer> = {}): OpenAnswer => ({ state, lastAt, inserted: 0, nextAt: null, ...extra });
  const limited = () => answer("limited", { nextAt: nextSyncHour(s, s.now()) });

  if (runs.some((r) => r.status === "running" && now - Date.parse(r.startedAt) < LOCK_TTL_MS)) return answer("running");
  const recent = newest && now - Date.parse(newest.finishedAt!) < FRESH_MINUTES * 60_000 ? newest : null;
  if (recent && recent.status !== "failed") return answer("fresh", { lastAt: recent.finishedAt, inserted: recent.inserted });
  if (await rateLimitedUntil(s, userId)) return limited();
  if (recent) return answer("failed");

  if (!userHeaders) {
    const day = now - 24 * 3600_000;
    const others = runs.filter((r) => r.trigger !== WITH_HEADERS && r.trigger !== "schedule" && Date.parse(r.startedAt) > day).length;
    const scheduledToCome = new Set(s.instance.current.syncHours).size;
    if (others >= UNATTENDED_PER_DAY - scheduledToCome) return limited();
  }

  syncUser(s, userId, userHeaders ? WITH_HEADERS : WITHOUT_HEADERS, userHeaders ?? undefined).catch((err) => console.error("fetch at open failed:", err));
  return answer("running");
}
