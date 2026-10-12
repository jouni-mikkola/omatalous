/**
 * The safety net, watched: the weekly deep check of the newest database copy, and what an admin is told while a hole
 * in the net can still be mended. Four conditions, each one notice: no intact copy for 36 hours, a copy that failed
 * its check, a disk that fills, a host helper that stopped. They are worked out when the notice list is read
 * (services/security.ts); nothing here has a table, and nothing watches row counts or the database's size, which
 * every normal import changes.
 */
import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { deepFileCheck, quickFileCheck } from "../db/backup-check.ts";
import { type CopyFile, copiesNewestFirst, MB, type Statfs } from "../db/backup-keep.ts";
import { findMigrationsDir } from "../db/open.ts";
import { foreignKeyFaults } from "../db/pragmas.ts";
import { type IntactCopy, newestIntactCopy } from "../db/restore.ts";
import { fsyncDir } from "../platform/durable.ts";
import type { Services } from "./context.ts";
import { diskState, RESERVE_WRITE_ABOVE } from "./disk.ts";
import { HELPER_SEEN_KEY, helperStatus } from "./ops-validate.ts";
import type { Notice } from "./security.ts";

/** A copy older than this is no longer "the copy of today": the daily one is a day apart, and half a day is its slack. */
const COPY_MAX_AGE_MS = 36 * 3600_000;
/** A copy whose file changed within this is left alone by the weekly check: it may still be written or copied in. */
const SETTLE_MS = 2 * 60_000;
/** The result of the last weekly check, as JSON: `{ at, file, ok, reason }`. */
export const COPY_CHECK_KEY = "copy_check";
const WEEK_KEY = "copy_check_week";
/** When the conditions without a time of their own began (JSON by kind); gone while they do not hold. */
const SINCE_KEY = "health_since";
const seenKey = (userId: string) => `notice_health_seen:${userId}`;
const WHERE = "Asetukset > Ylläpito";

export interface CopyCheck {
  /** When the check ran (ISO). */
  at: string;
  /** The copy's name in <data>/backups as it was when checked; a failed one is now `<file>.damaged`. */
  file: string;
  ok: boolean;
  reason: string | null;
}

/** Tests put a made disk in place of the real one. */
export interface HealthProbes {
  statfs?: Statfs;
}

const readJson = <T extends object>(text: string | null): T | null => {
  try {
    const value: unknown = text ? JSON.parse(text) : null;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
};

// ── the weekly check ─────────────────────────────────────

/** The Monday (YYYY-MM-DD) of the week a local day is in: it names the week as the day names the daily copy. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Takes a failed copy out of the copies by its name: `<name>.damaged` is no copy's name, and no pruning rule matches it. */
function setAside(dir: string, copy: CopyFile, stamp: string): void {
  const taken = new Set(readdirSync(dir));
  const name = taken.has(`${copy.name}.damaged`) ? `${copy.name}.${stamp.replace(/[^0-9T]/g, "").slice(0, 15)}.damaged` : `${copy.name}.damaged`;
  renameSync(copy.file, join(dir, name));
  fsyncDir(dir);
}

/**
 * Once in a local week: the newest copy that passes the header check gets integrity_check and foreign_key_check, and
 * the result goes to the setting `copy_check`. A copy that fails is renamed `<name>.damaged`, never deleted, and from
 * then on it is no copy to restore from or to protect. Returns null when the week has its check already, and when
 * there is no copy: that week stays open, so the first copy that comes is checked. It stays open too while any copy's
 * file changed in the last two minutes (SETTLE_MS): a file that is still being written, or copied into the folder by
 * hand, reads as damaged, and a rename would take a good copy out of the net. The next tick looks again.
 */
export async function checkNewestCopy(s: Services, today: string): Promise<CopyCheck | null> {
  if (!s.backupDir) return null;
  const week = weekOf(today);
  if ((await s.settings.get(WEEK_KEY)) === week) return null;
  const copies = copiesNewestFirst(s.backupDir);
  const now = s.now().getTime();
  if (copies.some((c) => Math.abs(now - c.t) < SETTLE_MS)) return null;
  const copy = copies.find((c) => quickFileCheck(c.file) === null);
  if (!copy || !(await s.settings.claim(WEEK_KEY, week))) return null;
  try {
    const { broken, orphans } = deepFileCheck(copy.file);
    // Rows that break a foreign key in the database itself are in every copy of it: such a copy is a true copy, and
    // setting it aside each week would empty the net.
    const own = broken || !orphans ? 0 : await foreignKeyFaults(s.db);
    const reason = broken ?? (orphans > own ? `foreign_key_check: ${orphans} rows point at a row that is not there (${own} in the database itself)` : null);
    const result: CopyCheck = { at: s.now().toISOString(), file: copy.name, ok: reason === null, reason };
    if (reason) {
      console.error(`database copy ${copy.file} failed its weekly check (${reason}). It is renamed ${copy.name}.damaged and no longer counts as a copy.`);
      setAside(s.backupDir, copy, result.at);
    }
    await s.settings.set(COPY_CHECK_KEY, JSON.stringify(result));
    return result;
  } catch (err) {
    await s.settings.delete(WEEK_KEY); // the next tick tries again, as with the daily copy
    throw err;
  }
}

/**
 * The hourly tick's one call. `copiedNow`: this tick wrote the daily copy. The weekly check then waits for the next
 * tick, so it never runs at the copy's moment, and what it checks an hour later is the copy of that day. Each tick
 * also notes when the disk filled or the copies stopped, which is what brings a read notice back. Never throws.
 */
export async function watchCopies(s: Services, today: string, copiedNow: boolean): Promise<CopyCheck | null> {
  try {
    await conditions(s);
    return copiedNow ? null : await checkNewestCopy(s, today);
  } catch (err) {
    console.error("watching the database copies failed:", (err as Error).message);
    return null;
  }
}

// ── the notices ──────────────────────────────────────────

type Kind = "copy_missing" | "copy_check_failed" | "disk_low" | "helper_silent";

interface Condition {
  kind: Kind;
  /** What makes this time this one: a notice marked as read stays away while the key is the same. */
  key: string;
  text: string;
}

/** The answer of newestIntactCopy for a folder, kept while the folder's copies are the same files: the full check opens the copy. */
const lastGood = new Map<string, { print: string; copy: IntactCopy | null | undefined }>();

/**
 * The copy a restore would take, null when there is none, and undefined when that cannot be judged: newestIntactCopy
 * compares a copy's migrations with this build's, and a server started with MIGRATIONS_DIR has them in a folder this
 * module is not told (Services do not carry it). Saying nothing then is better than a false alarm on every page.
 */
function newestGoodCopy(dir: string): IntactCopy | null | undefined {
  const print = copiesNewestFirst(dir)
    .map((c) => `${c.name}:${c.t}:${c.size}`)
    .join("|");
  const kept = lastGood.get(dir);
  if (kept?.print === print) return kept.copy;
  let copy: IntactCopy | null | undefined = null;
  try {
    findMigrationsDir();
    if (print) copy = newestIntactCopy(dir);
  } catch {
    copy = undefined;
  }
  lastGood.set(dir, { print, copy });
  return copy;
}

type Since = { copy_missing?: string; disk_low?: string };

/**
 * When each of the two conditions began, stored once and dropped when the condition ends. A disk that filled, was
 * emptied and fills again thus has a new time, and the notice an admin marked as read is shown again.
 */
async function began(s: Services, holds: { copy_missing: boolean; disk_low: boolean }): Promise<Since> {
  const raw = await s.settings.get(SINCE_KEY);
  const was = readJson<Since>(raw) ?? {};
  const now = s.now().toISOString();
  const next: Since = {};
  if (holds.copy_missing) next.copy_missing = typeof was.copy_missing === "string" ? was.copy_missing : now;
  if (holds.disk_low) next.disk_low = typeof was.disk_low === "string" ? was.disk_low : now;
  const text = JSON.stringify(next);
  if (text !== (raw ?? "{}")) {
    try {
      if (text === "{}") await s.settings.delete(SINCE_KEY);
      else await s.settings.set(SINCE_KEY, text);
    } catch {
      // a full disk refuses the write, and that is when the notice below matters most
    }
  }
  return next;
}

/** What is wrong with the safety net now. Reads files and settings; writes only the two beginnings above. */
async function conditions(s: Services, probes: HealthProbes = {}): Promise<Condition[]> {
  const now = s.now().getTime();
  // a new install has no copy before its first night: the first 36 hours after the first user are left alone
  const installed = Date.parse((await s.users.list())[0]?.createdAt ?? "");
  const good = s.backupDir ? newestGoodCopy(s.backupDir) : undefined;
  const copyMissing = good !== undefined && now - installed > COPY_MAX_AGE_MS && now - (good ? Date.parse(good.at) : 0) > COPY_MAX_AGE_MS;
  const disk = diskState(s, probes.statfs);
  const diskLow = (disk.freeBytes !== null && disk.freeBytes < RESERVE_WRITE_ABOVE) || disk.reserve === "released";
  const since = await began(s, { copy_missing: copyMissing, disk_low: diskLow });
  const check = readJson<CopyCheck>(await s.settings.get(COPY_CHECK_KEY));
  const helperSeen = await s.settings.get(HELPER_SEEN_KEY);

  const out: Condition[] = [];
  if (copyMissing) out.push({ kind: "copy_missing", key: since.copy_missing!, text: `Ehjää varmuuskopiota ei ole tehty 36 tuntiin. Ota varmuuskopio kohdassa ${WHERE}.` });
  if (check && check.ok === false) {
    out.push({ kind: "copy_check_failed", key: String(check.at), text: `Varmuuskopio ${check.file} ei läpäissyt tarkistusta eikä sitä enää käytetä palautukseen. Ota uusi varmuuskopio kohdassa ${WHERE}.` });
  }
  if (diskLow) out.push({ kind: "disk_low", key: since.disk_low!, text: `Palvelimen levyllä on enää ${Math.floor((disk.freeBytes ?? 0) / MB)} Mt vapaata tilaa. Siivoa levy kohdassa ${WHERE}.` });
  // "stale" is the helper's own word for it (ops-validate.ts): seen once, and not for 24 hours
  if (helperSeen && helperStatus(helperSeen, s.now()).reason === "stale") {
    out.push({ kind: "helper_silent", key: helperSeen, text: `Ylläpitoapurista ei ole kuulunut vuorokauteen. Käynnistä se palvelimella uudelleen: ohje on kohdassa ${WHERE}.` });
  }
  return out;
}

/** The notices of an admin about the safety net, without the ones marked as read. Others get none. */
export async function healthNotices(s: Services, user: { id: string; role: string }, probes?: HealthProbes): Promise<Notice[]> {
  if (user.role !== "admin") return [];
  const seen = readJson<Record<string, string>>(await s.settings.get(seenKey(user.id))) ?? {};
  return (await conditions(s, probes)).filter((c) => seen[c.kind] !== c.key).map((c) => ({ id: c.kind, kind: c.kind, at: null, text: c.text }));
}

/**
 * Marks what holds now as read by this admin: each kind with its key, so the notice stays away until the condition
 * ends and begins again (or another copy fails, or the helper is seen and stops again). Each admin has their own mark.
 */
export async function markHealthSeen(s: Services, user: { id: string; role: string }, probes?: HealthProbes): Promise<void> {
  if (user.role !== "admin") return;
  const holds = await conditions(s, probes);
  if (!holds.length) return s.settings.delete(seenKey(user.id));
  await s.settings.set(seenKey(user.id), JSON.stringify(Object.fromEntries(holds.map((c) => [c.kind, c.key]))));
}
