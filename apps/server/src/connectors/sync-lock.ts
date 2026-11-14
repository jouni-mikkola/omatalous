/**
 * The lock of one user's fetch. A fetch of a bank with many accounts can run longer than the lock lives, so the holder
 * renews it while it works, and releases only a lock that is still its own: a lock that did expire and was taken over
 * belongs to the new run and must outlast the old one.
 */
import { randomUUID } from "node:crypto";
import type { SettingsRepo } from "../db/settings-repo.ts";

export const LOCK_TTL_MS = 15 * 60_000;

export interface SyncLock {
  release(): Promise<void>;
}

/** The lock of `key`, or null while another run holds it. `renewMs` is how often the holder says it still works. */
export async function takeSyncLock(settings: SettingsRepo, key: string, ttlMs = LOCK_TTL_MS, renewMs = ttlMs / 3): Promise<SyncLock | null> {
  const owner = randomUUID();
  if (!(await settings.tryLockAs(key, ttlMs, owner))) return null;
  const timer = setInterval(() => {
    settings.renewLock(key, owner).then(
      (held) => {
        if (held) return;
        // another run has taken the lock over: there is nothing left to renew
        clearInterval(timer);
        console.error(`${key} was taken over by another run`);
      },
      (err) => console.error(`renewing ${key} failed:`, err),
    );
  }, renewMs);
  timer.unref();
  return {
    async release() {
      clearInterval(timer);
      await settings.releaseLock(key, owner);
    },
  };
}
