import { S } from "./ops-strings.ts";
import type { OpsState } from "./types.ts";

/** `34 s` under a minute, `1 min 12 s` from a minute on. A clock that is behind gives `0 s`. */
export function elapsed(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A helper that waits for the app's wake polled again within this, or is still in its wait, so a request starts in seconds. */
const WAKE_FRESH_MS = 50_000;

/**
 * The helper asks for work once a minute; the wait is named while the next look is still ahead, rounded up to 5 s.
 * A helper that wakes (`wakes`) and polled under 50 s ago starts a request within seconds instead.
 */
export function queuedSentence(seenAt: number | null, now: number, wakes = false): string {
  if (seenAt === null || Number.isNaN(seenAt)) return S.queued;
  if (wakes && now - seenAt < WAKE_FRESH_MS) return S.queuedWake;
  const left = seenAt + 60_000 - now;
  return left > 0 ? S.queuedNext(elapsed(Math.ceil(left / 5000) * 5000)) : S.queued;
}

/** Calls `onTick` once a second until the returned function is called. */
export function startTicker(onTick: () => void): () => void {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}

/** While an update runs the app restarts: ask again soon, so the page sees the new version within seconds. */
export const restartWait = (last: OpsState | null, failures: number) => (last?.active ? (failures <= 3 ? 2000 : 5000) : undefined);
