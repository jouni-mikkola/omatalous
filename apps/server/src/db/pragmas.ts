import type { Db } from "./types.ts";

/** A cheap read that throws when the database cannot be read at all (a locked or unreadable file). */
export async function pingDatabase(db: Db): Promise<void> {
  await db.first("SELECT value FROM settings LIMIT 1");
}

/** SQLite's `PRAGMA quick_check` with room for five problems: one row `ok` on a sound database, else what it found. */
export async function quickCheck(db: Db): Promise<string[]> {
  return (await db.all<{ quick_check: string }>("PRAGMA quick_check(5)")).map((r) => r.quick_check);
}

/**
 * Keeps SQLite's table statistics current. The planner chooses between the full-history indexes and the small
 * partial ones (pending rows, uncategorised rows) by those numbers, and picks the wrong one without them.
 * `PRAGMA optimize` analyses only what has changed much since the last time and is a no-op otherwise; the
 * analysis limit keeps a run on a large history to a few tens of milliseconds. Never throws: a failure only
 * leaves the old statistics.
 */
export async function optimizeDatabase(db: Db): Promise<void> {
  try {
    await db.run("PRAGMA analysis_limit = 1000");
    await db.run("PRAGMA optimize");
  } catch (err) {
    console.error("database statistics could not be refreshed:", (err as Error).message);
  }
}
