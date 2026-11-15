/**
 * The copies the app takes before a change (db/open.ts takeSnapshot, scripts/update.sh) and the room a disk must have
 * before one starts. Nothing here is a backup of the household's data: that is the household's own to keep.
 *
 * scripts/lib/dbcopy.sh (DBCOPY_JS: its space check) follows the same rule inline. It runs inside old and new images,
 * so it cannot import this file. A change to the rule here is a change there.
 */
import { existsSync, lstatSync, readdirSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * What the reset saved before it emptied the data, `pre-reset-<time>.db`. It is the only way back from the reset, so it
 * stays KEPT_COPY_DAYS days however many other copies follow.
 */
export const RESET_LABEL = "pre-reset";
/** What a secret rotation saved before it re-sealed the stored keys, `pre-secret-rotate-<time>.db`. Kept like the reset's copy. */
export const SECRET_ROTATE_LABEL = "pre-secret-rotate";
/** Days a reset's and a rotation's copy stays. The newest-N rule of the other copies never counts or removes them. */
export const KEPT_COPY_DAYS = 14;
export const MB = 1_048_576;

/** 20261010T031500: the time in the name of a copy the copy code writes. UTC. */
function fileStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
}

/** The file name of the copy taken at `at` under a label: `pre-reset-20261010T031500.db`. Who writes it and who looks for it both ask here. */
export const snapshotName = (label: string, at: Date): string => `${label}-${fileStamp(at)}.db`;

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
 * millisecond the later name comes first. A folder or a link is no copy, and a folder that is not there has none.
 */
export function copiesNewestFirst(dir: string, wanted: (name: string) => boolean): CopyFile[] {
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
