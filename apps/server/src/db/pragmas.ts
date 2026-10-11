import type { Db } from "./types.ts";

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
