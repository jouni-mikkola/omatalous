/**
 * The check before the server opens its database (entry/node.ts, server mode only: a CLI call and `migrate-check`
 * never come here).
 *
 * A database that fails SQLite's own check is left exactly where it is, and the server does not start on it: a start
 * would write to a file that is already damaged. The server answers every request with DAMAGED_PAGE instead of
 * exiting, so a restart loop is not mistaken for a bad update. The household puts back its own copy of the data folder.
 *
 * Rules:
 *   - The check never throws and writes nothing, and moves nothing.
 *   - A healthy database is never refused: only SQLite saying "damaged" counts, never a lock, a busy file or a failure
 *     to look.
 */
import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** The primary result codes of SQLite that say the file itself is bad. */
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/** SQLite's reports and Node's errors have line ends and paths, and what the log says is one line. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").slice(0, 200);

/**
 * SQLite's verdict on the live database, read-only: why it is damaged, or null. A failed quick_check and the two
 * errors that mean "not a readable database" count. A database another process holds (busy, locked) and any other
 * failure to look (permissions, an I/O error) do not: the open that follows reports those.
 * The header alone is not judged: after a kill in the middle of a checkpoint the main file of a WAL database is
 * shorter than its header says, and the log still makes it whole.
 */
export function damageOf(dbPath: string, lines: string[]): string | null {
  if (!existsSync(dbPath)) return null; // no file is a new install
  try {
    // an empty one is judged by the open (refuseEmptyOverData)
    if (statSync(dbPath).size === 0) return null;
  } catch {
    return null;
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("PRAGMA quick_check(5)").all() as { quick_check: string }[];
    if (rows.length === 1 && rows[0]!.quick_check === "ok") return null;
    return oneLine(`quick_check: ${rows.map((r) => r.quick_check).join("; ")}`);
  } catch (err) {
    const message = oneLine((err as Error).message);
    // errcode is the extended code (SQLITE_CORRUPT_INDEX is 779): the low byte is the primary one
    const code = ((err as { errcode?: number }).errcode ?? 0) & 0xff;
    if (code === SQLITE_CORRUPT || code === SQLITE_NOTADB) return message;
    lines.push(`database: the check before the start was skipped (${message}).`);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // nothing to release
    }
  }
}

/** What the server answers to every request while it waits on a damaged database. */
export const DAMAGED_PAGE = "Tietokanta on vaurioitunut, joten sovellus ei käynnisty. Palauta oma kopiosi data-kansiosta ja käynnistä sovellus uudelleen.\n";

/** The line the server prints before it waits on a damaged database. */
export const damagedLine = (dbPath: string, reason: string): string =>
  `database: ${dbPath} is damaged (${reason}). The server does not start on it and has changed nothing. Put back your own copy of the data folder and start again.`;
