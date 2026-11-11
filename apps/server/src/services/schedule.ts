/**
 * The hourly tick (croner in entry/node.ts): the daily database copy, bank
 * fetches in the sync hours chosen in the browser, trade register lookups for
 * new merchants, and cleanup of expired sessions and abandoned bank
 * authorisations.
 */
import { hourIn, todayIn } from "../platform/config.ts";
import { optimizeDatabase } from "../db/pragmas.ts";
import { LINK_STATE_PREFIX } from "../connectors/link-state.ts";
import { type SyncSummary, syncEveryone } from "../connectors/sync.ts";
import type { Services } from "./context.ts";
import { watchCopies } from "./db-health.ts";
import { keepReserve } from "./disk.ts";
import { drainLookups, type LookupResult } from "./industry.ts";
import { expireStale } from "./ops.ts";
import { finishPendingReprocess } from "./recovery.ts";
import { upgradeAndLog } from "./upgrade.ts";
import { queueOffsiteDaily } from "./offsite.ts";
import { sweepOffsiteRequest } from "./offsite-request.ts";
import { deliverNotices } from "./outside-notices.ts";
import { pruneEvents } from "./security.ts";
import { isSyncHour } from "./instance.ts";
import { remoteAccessState } from "./remote-access.ts";
import { revertUnconfirmed } from "./remote-access-trial.ts";
import { EXTENSIONS } from "../extensions.ts";
import { recheckModule } from "./modules.ts";

export interface TickResult {
  /** Path of the copy written by this tick, once a day. */
  backup: string | null;
  synced: Record<string, SyncSummary> | null;
  lookup: LookupResult | null;
}

/** A bank authorisation not finished within a day is abandoned. */
const STATE_TTL_MS = 24 * 3600_000;

/** Batches of register names one tick may work through (30 names each, about a minute per batch). */
const MAX_LOOKUP_BATCHES = 10;

/** The first tick of a local day writes that day's copy; a failed one is released so the next tick tries again. */
async function backupToday(s: Services, day: string): Promise<string | null> {
  if (!s.backup || !(await s.settings.claim("backup_day", day))) return null;
  try {
    return s.backup(day);
  } catch (err) {
    console.error("backup failed:", err);
    await s.settings.delete("backup_day");
    return null;
  }
}

/**
 * Work a restart could not finish or a failure left undone: the upgrade tasks of a build that differs from the
 * stored one, and categorisation of rows that were stored but not processed. Both are idempotent.
 */
async function finishLeftovers(s: Services): Promise<void> {
  await upgradeAndLog(s);
  await finishPendingReprocess(s);
  for (const user of await s.users.list()) await s.finance(user.id).pruneSyncRuns();
}

/** A chore that fails is logged by name only, so the rest of the tick still runs. */
async function chore(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    console.error(`hourly chore failed: ${name}`);
  }
}

export async function hourlyTick(s: Services): Promise<TickResult> {
  keepReserve(s); // first: a write below that fails on a full disk ends the tick, and the reserve is what gives room back
  const settings = await s.instance.load(true);
  const hour = hourIn(settings.timezone, s.now());
  const today = todayIn(settings.timezone, s.now());
  const backup = await backupToday(s, today);
  keepReserve(s); // and again after the copy, which is what takes the space
  await watchCopies(s, today, backup !== null); // the weekly check of the newest copy, in a tick that wrote none
  await optimizeDatabase(s.db);
  await queueOffsiteDaily(s, today); // off unless an admin gave a target and turned it on
  await chore("sweeping the offsite request", () => sweepOffsiteRequest(s)); // the target and its key leave the volume when no request waits for them
  await deliverNotices(s); // off unless an admin turned it on; each event once
  try {
    await finishLeftovers(s);
  } catch (err) {
    console.error("finishing leftover work failed:", err);
  }
  try {
    // the add-on code's check, at most once a day and only with a code (modules.ts)
    await recheckModule(s);
  } catch (err) {
    console.error("add-on module check failed:", (err as Error).name);
  }
  for (const e of EXTENSIONS) {
    if (!e.hourly) continue;
    try {
      await e.hourly(s);
    } catch (err) {
      console.error(`hourly work of ${e.id} failed:`, (err as Error).name);
    }
  }
  try {
    // takes back a remote access nobody got in through, ends a change nobody was looking at and finishes a removal
    // from Cloudflare that waits
    await revertUnconfirmed(s);
    await remoteAccessState(s);
  } catch (err) {
    console.error("settling remote access failed:", err);
  }
  let synced: TickResult["synced"] = null;
  // when clocks go forward an hour does not exist: a fetch chosen for it happens in the hour that follows
  const previousHour = hourIn(settings.timezone, new Date(s.now().getTime() - 3600_000));
  const skippedHour = (previousHour + 2) % 24 === hour ? (previousHour + 1) % 24 : null;
  const due = isSyncHour(settings, hour) || (skippedHour !== null && isSyncHour(settings, skippedHour));
  // when clocks go back an hour repeats; the slot keeps it to one fetch (PSD2 allows four a day)
  if (due && (await s.settings.claim("sync_slot", `${today} ${hour}`))) {
    try {
      synced = await syncEveryone(s, "schedule");
    } catch (err) {
      console.error("scheduled fetch failed:", err);
    }
  }

  let lookup: LookupResult | null = null;
  try {
    lookup = await drainLookups(s, { maxBatches: MAX_LOOKUP_BATCHES });
  } catch (err) {
    console.error("industry lookup failed:", err);
  }

  await chore("deleting expired sessions", () => s.users.deleteExpiredSessions(s.now()));
  await chore("pruning events", () => pruneEvents(s));
  await chore("expiring stale requests", () => expireStale(s)); // a queued request nobody collected (no helper at all) ends as expired
  try {
    s.pruneBackups?.(s.now());
  } catch (err) {
    console.error("pruning backups failed:", err);
  }
  await chore("cleaning bank link states", () => s.settings.deleteOlder(LINK_STATE_PREFIX, new Date(s.now().getTime() - STATE_TTL_MS)));
  return { backup, synced, lookup };
}
