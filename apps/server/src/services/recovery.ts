/**
 * What a restart repairs after a process was killed (power loss, an out-of-memory kill, a stop timeout):
 * locks the dead process still holds, bank fetches left as "running", and imports whose categories were
 * never computed. The hourly tick repeats the last part, so a failure here is not final.
 */
import type { Services } from "./context.ts";
import { reprocess } from "./enrich.ts";
import { NEEDS_REPROCESS } from "../db/settings-repo.ts";

/** Call once at server start, before the first request is served. `startedAt` is when this process began. */
export async function recoverAfterCrash(s: Services, startedAt: Date): Promise<void> {
  const cleared = await s.settings.clearLocksBefore(startedAt);
  if (cleared.length) console.log(`recovery: cleared ${cleared.length} lock(s) left by a process that stopped (${cleared.map((k) => k.replace(/:.*/, "")).join(", ")})`);
  let failed = 0;
  for (const user of await s.users.list()) failed += await s.finance(user.id).failInterruptedSyncRuns();
  if (failed) console.log(`recovery: marked ${failed} bank fetch(es) as interrupted`);
}

/** Runs reprocess for every user whose import or fetch was stored but not yet categorised. Returns the users done. */
export async function finishPendingReprocess(s: Services): Promise<number> {
  const keys = await s.settings.keysWithPrefix(NEEDS_REPROCESS);
  if (!keys.length) return 0;
  const known = new Set((await s.users.list()).map((u) => u.id));
  let done = 0;
  for (const key of keys) {
    const userId = key.slice(NEEDS_REPROCESS.length);
    if (!known.has(userId)) {
      await s.settings.delete(key);
      continue;
    }
    try {
      const changed = await reprocess(s.finance(userId), s.settings);
      console.log(`recovery: categorised the rows of ${userId.slice(0, 8)} that an earlier import left unfinished (${changed} changed)`);
      done++;
    } catch (err) {
      console.error(`recovery: finishing the categorisation of ${userId.slice(0, 8)} failed, the hourly tick tries again:`, err);
    }
  }
  return done;
}
