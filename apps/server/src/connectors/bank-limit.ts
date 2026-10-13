/**
 * What the app remembers of the bank's rate limit, per member, in the settings store so that a restart keeps it.
 * A bank allows about four fetches a day made without the user present and answers a rate limit beyond that.
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
