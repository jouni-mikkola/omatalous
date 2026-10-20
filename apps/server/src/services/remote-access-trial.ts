/**
 * A remote access that was just turned on is on trial (services/remote-access.ts). A wrong address, a domain that is
 * not ready or a sign-in list without the admin's own address leaves a copy nobody can reach, and the admin cannot get
 * in to turn it off. So the first request that comes in through Cloudflare Access is the proof that the address works,
 * and without one in 15 minutes the server takes the copy back to the local network by itself.
 */
import type { Services } from "./context.ts";
import { queueOwnLan } from "./ops.ts";
import { busy, change, exclusive, load, onTunnel, openTrial, type Pending, TRIAL_MS } from "./remote-access-record.ts";
import { settle } from "./remote-access-settle.ts";
import { recordEvent } from "./security.ts";

/** Apps in this process with nothing left to confirm: no request reads the record for them. */
const confirmed = new WeakSet<Services>();

/**
 * For every request that passed the Access check (security/cf-access.ts, hooked up in app.ts). The first one under the
 * trial's audience tag is the proof: one write to the record, and after it this reads and writes nothing.
 */
export async function confirmAccess(s: Services): Promise<void> {
  if (confirmed.has(s)) return;
  const aud = s.config.access?.aud;
  if (openTrial(await load(s))?.aud === aud) {
    const at = s.now().toISOString();
    await change(s, (r) => (openTrial(r)?.aud === aud ? { ...r, trial: { ...r.trial!, confirmedAt: at } } : null));
  }
  confirmed.add(s);
}

/**
 * Takes back an address nobody got in through. This is the one change that runs with no admin's password: it is called
 * from the timer below and from the hourly tick (schedule.ts) and from nowhere else, and all it can queue is `lan`
 * (queueOwnLan in ops.ts). Cloudflare's side then goes as after any off. Answers in how many milliseconds to look
 * again, or null when no trial is open.
 */
export async function revertUnconfirmed(s: Services): Promise<number | null> {
  const { ops, rec } = await settle(s);
  const trial = openTrial(rec);
  if (!trial) return null;
  const left = trial.appliedAt && !rec.pending ? Date.parse(trial.appliedAt) + TRIAL_MS - s.now().getTime() : TRIAL_MS;
  if (left > 0) return left;
  if (!onTunnel(ops) || busy(s)) return TRIAL_MS;
  await exclusive(s, async () => {
    const now = await load(s);
    if (now.pending || !openTrial(now)) return;
    // null: the helper is away or another maintenance action runs, and the next look tries again
    const requestId = await queueOwnLan(s, trial.by);
    if (!requestId) return;
    const pending: Pending = { want: "lan", requestId, hostname: null, by: trial.by, at: s.now().toISOString(), revert: true };
    await change(s, (r) => (r.hostname ? { ...r, pending, removal: "waiting", removalBy: trial.by } : { ...r, pending }));
    await recordEvent(s, { kind: "remote_access_reverted", userId: trial.by, detail: `${rec.hostname}: kukaan ei päässyt sisään ${TRIAL_MS / 60_000} minuutissa` });
  });
  return TRIAL_MS;
}

/** How soon after its start a process reads how much of the trial is left. */
const FIRST_LOOK_MS = 10_000;

/**
 * Looks when the trial runs out, without waiting for the hourly tick. Armed where the app runs behind Access (app.ts).
 * The first look comes soon after the start and reads from the record how long is left, so a process started in the
 * middle of a trial ends it on time. The timer keeps no process alive and stops once no trial is open.
 */
export function watchTrial(s: Services, wait = FIRST_LOOK_MS): void {
  const timer = setTimeout(() => {
    void revertUnconfirmed(s).then(
      (next) => void (next !== null && watchTrial(s, next + 1000)),
      () => watchTrial(s, TRIAL_MS),
    );
  }, wait);
  if (typeof timer === "object") timer.unref();
}
