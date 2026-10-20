/**
 * What the app remembers of the bank's limits. The rate limit answer is kept per member, in the settings store so that
 * a restart keeps it. The fetches made without the user present are counted per account, from the calls noted in
 * `account_fetch`: a bank allows about four a day and answers a rate limit beyond that.
 */
import type { Services } from "../services/context.ts";

/** After the bank answers its rate limit, opening the app starts no fetch for this member for this long. */
const RATE_LIMIT_HOURS = 6;

const limitKey = (userId: string) => `bank_rate_limited:${userId}`;

/** A fetch of this member got the rate limit answer: the time until which opens start none. */
export async function markRateLimited(s: Services, userId: string): Promise<void> {
  await s.settings.set(limitKey(userId), new Date(Date.now() + RATE_LIMIT_HOURS * 3600_000).toISOString());
}

/** The time the limit ends, or null when there is none (or it has passed). */
export async function rateLimitedUntil(s: Services, userId: string): Promise<string | null> {
  const until = await s.settings.get(limitKey(userId));
  return until && until > new Date().toISOString() ? until : null;
}

/** A bank allows about this many fetches a day made without the user present, for one account. */
const UNATTENDED_PER_DAY = 4;
const DAY_MS = 86_400_000;
/**
 * The scheduled fetch of the day before is left out of the count one hour early: it ran a little after its hour, so at
 * the same hour today it would still count and take the place of today's.
 */
const SCHEDULE_WINDOW_MS = DAY_MS - 3600_000;

/** The fetches that are left out at the limit: the schedule, and an open that could not give the member's headers. */
const LIMITED = new Set(["schedule", "open-bare"]);

/**
 * The accounts (by key) that this kind of fetch leaves out now. The day is the 24 hours before now, counted over the
 * calls of every member, so a joint account fetched by two members has one count. A scheduled fetch is left out at four
 * unattended fetches of the account. An open without headers is left out at four less the sync hours, which keeps the
 * scheduled fetches of the day their room. A manual or connect fetch without the member's headers is counted like an open
 * without them, but never left out: the user asked for it. One with the headers is not counted.
 */
export async function accountsAtLimit(s: Services, keys: readonly string[], trigger: string): Promise<Set<string>> {
  if (!LIMITED.has(trigger)) return new Set();
  const now = s.now().getTime();
  const unique = [...new Set(keys)];
  const notes = await s.household.unattendedFetches(unique, new Date(now - DAY_MS).toISOString());
  const hours = new Set(s.instance.current.syncHours).size;
  const full = new Set<string>();
  for (const key of unique) {
    const own = notes.filter((n) => n.accountKey === key);
    const bare = own.filter((n) => n.trigger !== "schedule").length;
    const scheduled = own.filter((n) => n.trigger === "schedule" && (trigger === "open-bare" || Date.parse(n.at) > now - SCHEDULE_WINDOW_MS)).length;
    const limit = trigger === "schedule" ? UNATTENDED_PER_DAY : Math.max(0, UNATTENDED_PER_DAY - hours);
    if (trigger === "schedule" ? bare + scheduled >= limit : bare >= limit || bare + scheduled >= UNATTENDED_PER_DAY) full.add(key);
  }
  return full;
}
