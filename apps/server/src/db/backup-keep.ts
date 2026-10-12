/**
 * What keeps a household's database copies safe: the copies no pruning path may delete, the check that stops
 * pruning over a damaged live database, and the room a disk must have before a copy starts.
 *
 * scripts/lib/dbcopy.sh (DBCOPY_JS: `keep:` and its space check) follows the same rules inline. It runs inside old
 * and new images, so it cannot import this file. A change to a rule here is a change there.
 */
import { existsSync, lstatSync, readdirSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { verifyDatabaseFile } from "./backup-check.ts";

/** The file name of a database copy in <data>/backups: a plain name, never a path. */
export const COPY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.db$/;
/** What a restore saved of the database it replaced, `pre-restore-<time>.db`. Taking it back would undo that restore. */
export const REPLACED_LABEL = "pre-restore";
/**
 * What the reset saved before it emptied the data, `pre-reset-<time>.db`. A start never takes it alone, pruning
 * spares it for 14 days, and restoring it undoes the reset.
 */
export const RESET_LABEL = "pre-reset";
/** This many intact copies always stay, whatever their age and whatever a keep count says. */
const PROTECTED_COPIES = 3;
export const MB = 1_048_576;

/** 20261010T031500: the time in the name of a file the copy code, the restore or the startup gate writes. UTC. */
export function fileStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
}

/** The file name of the copy taken at `at` under a label: `pre-reset-20261010T031500.db`. Who writes it and who looks for it both ask here. */
export const snapshotName = (label: string, at: Date): string => `${label}-${fileStamp(at)}.db`;

/**
 * Whether a file of this name in <data>/backups is a copy a start may restore from on its own. The one meaning of
 * "can be restored" by name: the protected copies below are counted with it, so the three that pruning never
 * deletes are three a restore would take. DBCOPY_JS has the same two patterns.
 */
export function restorableCopyName(name: string): boolean {
  return COPY_NAME.test(name) && !name.startsWith(`${REPLACED_LABEL}-`);
}

export type CopyKind = "daily" | "pre-update" | "pre-reset" | "manual";
/** What a copy is, read from its file name here and nowhere else: the list and the restore card of Asetukset > Ylläpito label this. */
export function copyKind(name: string): CopyKind {
  if (name.startsWith("auto-")) return "daily";
  if (name.startsWith("pre-update-")) return "pre-update";
  return name.startsWith(`${RESET_LABEL}-`) ? "pre-reset" : "manual";
}

export const sizeOf = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};
const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

/** A file in the copies folder: its name there, its path, when it was written (ISO, and `t` in milliseconds) and its size in bytes. */
export interface CopyFile {
  name: string;
  file: string;
  at: string;
  t: number;
  size: number;
}

/**
 * The regular files in `dir` whose name passes `wanted`, newest first by the time written; of two written in the same
 * millisecond the later name comes first. The one listing of "copies, newest first": the protected copies, both
 * pruning rules, the copy a restore takes, the weekly check and the list of Asetukset > Ylläpito read it, so they
 * agree on the order. A folder or a link is no copy, and a folder that is not there has none.
 */
export function copiesNewestFirst(dir: string, wanted: (name: string) => boolean = restorableCopyName): CopyFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CopyFile[] = [];
  for (const name of names) {
    if (!wanted(name)) continue;
    try {
      const st = lstatSync(join(dir, name));
      if (st.isFile()) out.push({ name, file: join(dir, name), at: st.mtime.toISOString(), t: st.mtimeMs, size: st.size });
    } catch {
      // removed meanwhile
    }
  }
  return out.sort((a, b) => b.t - a.t || (a.name < b.name ? 1 : -1));
}

/**
 * The names in `dir` that pruning must leave: the three newest copies a restore would take (restorableCopyName),
 * by the time they were written, that pass the header check, a read-only quick_check and have this app's tables.
 * A damaged or cut-short file never takes a place, so the newest copy that can be restored is always among them.
 * Opens at most as many files as it takes to find three.
 */
export function protectedCopies(dir: string): Set<string> {
  const keep = new Set<string>();
  for (const copy of copiesNewestFirst(dir)) {
    if (keep.size === PROTECTED_COPIES) break;
    if (verifyDatabaseFile(copy.file).ok) keep.add(copy.name);
  }
  return keep;
}

/**
 * Why the live database fails quick_check, or null when it passes. While it fails, every copy may be the one that
 * is needed, so nothing is pruned. Read-only: a damaged file is not written to. A file that is not there gives no
 * verdict (null): only a database that exists can be damaged.
 */
export function liveDatabaseProblem(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("PRAGMA quick_check(1)").all() as { quick_check: string }[];
    return rows.length === 1 && rows[0]!.quick_check === "ok" ? null : `quick_check: ${rows.map((r) => r.quick_check).join("; ").slice(0, 200)}`;
  } catch (err) {
    return (err as Error).message.slice(0, 200);
  } finally {
    try {
      db?.close();
    } catch {
      // nothing to release
    }
  }
}

/** The two numbers of statfs that say how much a process may still write. Tests inject one. */
export type Statfs = (path: string) => { bavail: number; bsize: number };

/** Bytes a write to `dir` can still use: the blocks free for a process that is not root. */
export function freeBytes(dir: string, statfs: Statfs = statfsSync): number {
  const s = statfs(dir);
  return s.bavail * s.bsize;
}

/** A copy that was not started because the disk it goes to could not hold it. */
export class NoRoomError extends Error {}

/**
 * A copy starts only when its folder's disk has twice the database and its WAL free. The copy takes that size once
 * at the most, and the rest is what the live database needs to keep writing while the copy exists. A disk that cannot
 * be measured does not stop a copy: VACUUM INTO fails on its own when the disk is full, and the partial file is removed.
 */
export function assertRoomForCopy(dbPath: string, dir: string, statfs?: Statfs): void {
  const database = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`);
  let free: number;
  try {
    free = freeBytes(dir, statfs);
  } catch {
    return;
  }
  if (free >= 2 * database) return;
  throw new NoRoomError(
    `not enough free space for a database copy: ${dir} has ${mb(free)} free and a copy needs ${mb(2 * database)} (twice the database and its WAL, ${mb(database)}). Free space on the data volume.`,
  );
}
