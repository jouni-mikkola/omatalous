/**
 * The hourly tick (croner in entry/node.ts): the daily database copy, bank
 * fetches in the sync hours chosen in the browser, trade register lookups for
 * new merchants, and cleanup of expired sessions and abandoned bank
 * authorisations.
 */
import { hourIn, todayIn } from "../config.ts";
import { type SyncSummary, syncEveryone } from "./bank.ts";
import type { Services } from "./context.ts";
import { drainLookups, type LookupResult } from "./industry.ts";
import { expireStale } from "./ops.ts";
import { pruneEvents } from "./security.ts";
import { isSyncHour } from "./instance.ts";

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

export async function hourlyTick(s: Services): Promise<TickResult> {
  const settings = await s.instance.load(true);
  const hour = hourIn(settings.timezone, s.now());
  const today = todayIn(settings.timezone, s.now());
  const backup = await backupToday(s, today);
  let synced: TickResult["synced"] = null;
  // when clocks go forward an hour does not exist: a fetch chosen for it happens in the hour that follows
  const previousHour = hourIn(settings.timezone, new Date(s.now().getTime() - 3600_000));
  const skippedHour = (previousHour + 2) % 24 === hour ? (previousHour + 1) % 24 : null;
  const due = isSyncHour(settings, hour) || (skippedHour !== null && isSyncHour(settings, skippedHour));
  // when clocks go back an hour repeats; the slot keeps it to one fetch (PSD2 allows four a day)
  if (due && (await s.settings.claim("sync_slot", `${today} ${hour}`))) {
    synced = await syncEveryone(s, "schedule");
  }

  let lookup: LookupResult | null = null;
  try {
    lookup = await drainLookups(s, { maxBatches: MAX_LOOKUP_BATCHES });
  } catch (err) {
    console.error("industry lookup failed:", err);
  }

  await s.users.deleteExpiredSessions();
  await pruneEvents(s);
  await expireStale(s); // a queued request nobody collected (no helper at all) ends as expired
  try {
    s.pruneBackups?.(s.now());
  } catch (err) {
    console.error("pruning backups failed:", err);
  }
  await s.settings.deleteOlder("auth_state:", new Date(s.now().getTime() - STATE_TTL_MS));
  return { backup, synced, lookup };
}
