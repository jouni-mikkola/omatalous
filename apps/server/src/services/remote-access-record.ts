/**
 * What Asetukset > Palvelin > Etäkäyttö has done and waits for (services/remote-access.ts): one JSON record in the
 * settings, with the rules for changing it and for reading the helper's report of the host beside it.
 *
 * The record is changed by more than one process: the server, and the `ops` CLI when the helper reports
 * (cli-ops.ts). Every change reads it again under a lock kept in the settings, so the one that comes second sees what
 * the first one stored.
 */
import { HttpUserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import type { opsState } from "./ops.ts";
import { readJson } from "./remote-access-cloudflare.ts";

const RECORD_KEY = "remote_access";
const LOCK_KEY = "remote_access_lock";
/** Far longer than a read and a write of the record take. A process that died with the lock is waited out. */
const LOCK_MS = 5000;
const LOCK_TRIES = 400;
export const IN_PROGRESS = "Etäkäytön muutos on jo kesken. Odota, että se valmistuu.";
/** How long a new address may stay up before somebody has got in through it (remote-access-trial.ts). */
export const TRIAL_MS = 15 * 60_000;
export const WAITING: readonly string[] = ["queued", "running"];

type Want = "tunnel" | "lan";
/**
 * How far the last removal of Cloudflare's side got (removeFromCloudflare in remote-access-settle.ts). "installer":
 * the host was made by the installer on the server, so this page left Cloudflare's side as it was.
 */
export type Removal = "removed" | "waiting" | "kept" | "failed" | "installer";
export interface Pending {
  want: Want;
  requestId: string;
  hostname: string | null;
  by: string;
  at: string;
  /** Queued by the server itself, to take back an address nobody got in through. */
  revert?: true;
}
/**
 * A turning on that waits for its proof. `aud` is the audience tag of the Access application it made: a request that
 * passes the check for that tag came in through the new address. `appliedAt`: when the host went behind the tunnel.
 */
export interface Trial {
  aud: string;
  by: string;
  appliedAt: string | null;
  confirmedAt: string | null;
}
/** What this page has done: Cloudflare's side as this copy made it, the change that waits and how the last one ended. */
export interface Made {
  /** The host this copy has written something for in Cloudflare. Null when nothing of it is there. */
  hostname: string | null;
  /** The Cloudflare account it was written in: a token of another account does not inherit the host. */
  account: string | null;
  /** The addresses of the last finished `up` for that host. Empty when a run stopped half way. */
  emails: string[];
  removal: Removal | null;
  /** The admin who asked for the removal, for the event of a later try. */
  removalBy: string | null;
  pending: Pending | null;
  trial: Trial | null;
  last: { want: Want; hostname: string | null; applied: boolean; reverted?: true; summary: string; at: string } | null;
}
const NOTHING: Made = { hostname: null, account: null, emails: [], removal: null, removalBy: null, pending: null, trial: null, last: null };

export const load = async (s: Services): Promise<Made> => ({ ...NOTHING, ...(await readJson<Partial<Made>>(s, RECORD_KEY)) });

const tails = new WeakMap<Services, Promise<unknown>>();
/** One at a time in this process, then one process at a time. */
function alone<T>(s: Services, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(s) ?? Promise.resolve()).then(async () => {
    for (let tries = 0; !(await s.settings.tryLock(LOCK_KEY, LOCK_MS)); tries++) {
      if (tries >= LOCK_TRIES) throw new HttpUserError(IN_PROGRESS, 409);
      await new Promise((done) => setTimeout(done, 20));
    }
    try {
      return await fn();
    } finally {
      await s.settings.delete(LOCK_KEY);
    }
  });
  tails.set(s, run.catch(() => undefined));
  return run;
}

/**
 * Changes the record from what is stored now. `fn` may answer null to leave it as it is, and may be async to record
 * the event of the change it alone got to make.
 */
export const change = (s: Services, fn: (r: Made) => Made | null | Promise<Made | null>): Promise<Made> =>
  alone(s, async () => {
    const before = await load(s);
    const next = await fn(before);
    if (next) await s.settings.set(RECORD_KEY, JSON.stringify(next));
    return next ?? before;
  });

const working = new WeakSet<Services>();
/** A change that asks Cloudflare is under way in this process. */
export const busy = (s: Services) => working.has(s);
/** One change at a time: a second one while Cloudflare is being asked is refused, not queued behind it. */
export async function exclusive<T>(s: Services, fn: () => Promise<T>): Promise<T> {
  if (working.has(s)) throw new HttpUserError(IN_PROGRESS, 409);
  working.add(s);
  try {
    return await fn();
  } finally {
    working.delete(s);
  }
}

/** The copy's name (INSTANCE_NAME, "banking-app" without one). The config keeps it only inside the session cookie's name. */
export const copyName = (s: Services) => s.config.sessionCookie.replace(/^talous_/, "");

// ── the helper's report of the host ──────────────────────

export type Ops = Awaited<ReturnType<typeof opsState>>;
export const onTunnel = (ops: Ops) => ops.state.mode === "tunnel";
export const hostOf = (address: string | undefined): string | null => /^https:\/\/([a-z0-9.-]{1,253})\/?$/.exec(address ?? "")?.[1] ?? null;
/** Does the host run the way this change asked for, by the helper's own report? */
export function inForce(ops: Ops, want: Want, hostname: string | null): boolean {
  if (want === "tunnel") return onTunnel(ops) && hostOf(ops.state.address) === hostname;
  return ops.state.mode !== undefined && !onTunnel(ops);
}

/** The trial that still waits for somebody to get in, or null. */
export const openTrial = (rec: Made): Trial | null => (rec.trial && !rec.trial.confirmedAt ? rec.trial : null);
