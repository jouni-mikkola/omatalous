/**
 * A member opens the app: if their rows are older than the gap between the scheduled fetches (the sync hours of the
 * instance settings), a fetch of their own connections starts in the background, inside what the bank allows. The
 * answer is at once and never waits for the bank, and the app shows what it has stored before any fetch ends.
 */
import { hourIn } from "../platform/config.ts";
import type { Services } from "../services/context.ts";
import { accountKey } from "../db/household-repo.ts";
import { accountsAtLimit, rateLimitedUntil } from "./bank-limit.ts";
import { LOCK_TTL_MS, syncUser } from "./sync.ts";
import type { UserHeaders } from "./types.ts";

const HOUR_MS = 3600_000;
const DAY_HOURS = 24;

/**
 * How old the newest fetch may be before an open starts another: the longest gap between two sync hours, round the
 * clock. While the schedule runs the rows are never older, so an open fetches only when a scheduled fetch was missed.
 * With no sync hours the schedule is off and the gap is a day.
 */
function freshMs(syncHours: readonly number[]): number {
  const hours = [...new Set(syncHours)].sort((a, b) => a - b);
  if (hours.length < 2) return DAY_HOURS * HOUR_MS;
  const gaps = hours.map((h, i) => hours[(i + 1) % hours.length]! - h + (i === hours.length - 1 ? DAY_HOURS : 0));
  return Math.max(...gaps) * HOUR_MS;
}

/** The trigger of an open that carried the member's headers; any other trigger is a fetch without them. */
const WITH_HEADERS = "open";
const WITHOUT_HEADERS = "open-bare";

interface OpenAnswer {
  state: "none" | "fresh" | "partial" | "running" | "limited" | "failed";
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
 * `userHeaders` give the member's Psu headers (psu.ts), or are null when the request cannot give the default pair. A fetch
 * with them counts as made with the user present: only the half hour limits it; an account whose bank asks for more than
 * the request can give is counted as one without (sync.ts). One without them is started only while one of the member's
 * accounts has room for it (bank-limit.ts counts per account); the fetch itself leaves out the ones that have none.
 */
export async function openSync(s: Services, userId: string, userHeaders: UserHeaders | null): Promise<OpenAnswer> {
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
  const fresh = freshMs(s.instance.current.syncHours);
  const age = newest ? now - Date.parse(newest.finishedAt!) : Infinity;
  const recent = newest && age < fresh ? newest : null;
  if (recent && recent.status !== "failed") return answer(recent.status === "partial" ? "partial" : "fresh", { lastAt: recent.finishedAt, inserted: recent.inserted });
  if (await rateLimitedUntil(s, userId)) return limited();
  if (recent) return answer("failed");

  if (!userHeaders) {
    const live = new Set((await repo.listConnections()).filter((c) => c.status === "active").map((c) => c.id));
    const keys = (await repo.listAccounts()).filter((a) => a.externalId && a.connectionId !== null && live.has(a.connectionId)).map(accountKey);
    if (keys.length && (await accountsAtLimit(s, keys, WITHOUT_HEADERS)).size === new Set(keys).size) return limited();
  }

  syncUser(s, userId, userHeaders ? WITH_HEADERS : WITHOUT_HEADERS, userHeaders ?? undefined).catch((err) => console.error("fetch at open failed:", err));
  return answer("running");
}
