import { S } from "./ops-strings.ts";
import type { OpsRequestView, OpsState } from "./types.ts";

/** `34 s` under a minute, `1 min 12 s` from a minute on. A clock that is behind gives `0 s`. */
export function elapsed(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The server's clock minus the browser's, in ms, when the server said its time (`serverNow`) as `receivedAt` (the browser's) came; 0 where it did not say. */
export function clockGap(serverNow: string | null | undefined, receivedAt: number): number {
  const at = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isNaN(at) ? 0 : at - receivedAt;
}

/**
 * How long a request has waited, in ms: the server's time when its answer came (`serverNow`) plus the browser's time since
 * (`now` less `receivedAt`), less the time the server wrote on the request. The browser's own clock is never compared with
 * the server's, so a gap between them shows no false wait.
 */
export const waitedMs = (requestedAt: string, serverNow: string | null | undefined, receivedAt: number, now: number): number => now + clockGap(serverNow, receivedAt) - Date.parse(requestedAt);

/**
 * How long step `i` took (it is over), or has been going (it is the last one of a request that runs), in ms. A step
 * ends where the next begins; the last one of a finished request ends with the request. Null where the host gave no
 * `at`, or for the last step of a finished request when it lasted under a second (the closing "Valmis" step).
 */
export function stepTime(request: OpsRequestView, i: number, now: number): number | null {
  const at = request.steps[i]?.at;
  if (at === undefined) return null;
  const next = request.steps[i + 1];
  if (next) return next.at === undefined ? null : Math.max(0, next.at - at) * 1000;
  const began = request.startedAt ? Date.parse(request.startedAt) : NaN;
  if (Number.isNaN(began)) return null;
  if (request.status === "running") return Math.max(0, now - began - at * 1000);
  const ms = (request.finishedAt ? Date.parse(request.finishedAt) : NaN) - began - at * 1000;
  return Number.isNaN(ms) || ms < 1000 ? null : ms;
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
