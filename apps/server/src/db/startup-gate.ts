/**
 * The check before the server opens its database (entry/node.ts, server mode only: a CLI call, `migrate-check` and
 * `restore` never come here).
 *
 * A household whose database file was damaged in the night must find the app working in the morning. So a database
 * that fails SQLite's own check is moved to <data>/damaged and the newest intact copy takes its place. The same
 * start runs a restore an admin asked for in the browser: the marker <data>/.restore-request names the copy.
 *
 * Rules:
 *   - The gate never throws and never ends the process. An exit at start would loop and look like a bad update to
 *     the watchdog, so with no intact copy the damaged file stays and the app starts on it. For the same reason a
 *     start that was cut off between the move and the copy's rename is finished by the next one.
 *   - An intact copy that could not be put in place (no room on the disk) is not "no copy": the result, the event
 *     and the notice say that it waits, and the next start tries again.
 *   - It moves files and deletes none of the household's. The marker and the restore's temporary file are its own.
 *   - A healthy database is never moved: only SQLite saying "damaged" counts, never a lock, a busy file or a failure
 *     to look.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fsyncDir } from "../platform/durable.ts";
import { COPY_NAME, copyKind, fileStamp } from "./backup-keep.ts";
import { finishStagedCopy, newestIntactCopy, restoreDatabase, stageCopy } from "./restore.ts";

/** The primary result codes of SQLite that say the file itself is bad. */
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
/** A copy's name is 103 characters at the most (COPY_NAME) and a user's id 64; a longer marker is not a request. */
const MARKER_MAX_BYTES = 200;
/** The id of the admin who asked, on the marker's second line. */
const ASKER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * A request is carried out by the start that follows it. An older marker is one whose start never came: the app
 * stayed down, or an older image that does not know the file ran in between. Days later the copy it names is no
 * longer what the admin chose, so it is dropped and the admins are told.
 */
export const MARKER_MAX_AGE_MS = 15 * 60_000;
/** The action's name in the audit list of Asetukset > Ylläpito: the request (services/db-restore.ts) and this start's answer to it say the same words. */
export const RESTORE_LABEL = "tietokannan palautus";

/**
 * The marker of a restore asked for in the browser: the copy's file name, and on a second line the id of the admin
 * who asked. Nothing else, and no line end after the last line.
 */
export const restoreRequestPath = (dataDir: string) => join(dataDir, ".restore-request");

/** A restore asked for in the browser that this start did not carry out: the marker was too old, or the restore failed. */
export interface NotDone {
  name: string;
  /** The id of the admin who asked, when the marker had one. */
  by: string | null;
  why: "old" | "failed";
  /** One line for the log of the server. */
  detail: string;
}

export type GateResult = (
  /** Nothing was wrong, or nothing could be judged. */
  | { state: "ok"; lines: string[] }
  /**
   * A copy is in place of the database: the old one was damaged, or an admin asked for the restore. `copy` is null
   * when this start only finished what an earlier one was cut off in: which copy that was is not known any more.
   */
  | { state: "restored"; lines: string[]; cause: "damaged" | "requested"; copy: { name: string; at: string } | null; /** Who asked, for a requested one whose marker said so. */ by?: string }
  /**
   * The database is damaged and stays where it is. `waiting` is the intact copy that could not be put in its place
   * and why (no room, a folder that cannot be made): the next start tries again. Null when there is no intact copy.
   */
  | { state: "damaged"; lines: string[]; reason: string; waiting: { name: string; why: string } | null }
) & {
  /** Set, whatever the state, when a restore was asked for in the browser and this start did not do it. */
  notDone?: NotDone;
};

/** SQLite's reports and Node's errors have line ends and paths, and what the gate says is one line. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").slice(0, 200);

/**
 * SQLite's verdict on the live database, read-only: why it is damaged, or null. A failed quick_check and the two
 * errors that mean "not a readable database" count. A database another process holds (busy, locked) and any other
 * failure to look (permissions, an I/O error) do not: the open that follows reports those.
 * The header alone is not judged (quickFileCheck): after a kill in the middle of a checkpoint the main file of a
 * WAL database is shorter than its header says, and the log still makes it whole.
 */
function damageOf(dbPath: string, lines: string[]): string | null {
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

/**
 * Reads the marker and removes it, in that order and before anything is restored: a restore that fails or is cut
 * off must not run again at every start. Returns the copy's name and who asked, or null when there is no request to
 * carry out. A request that is too old is not carried out: it goes to `told`.
 */
function takeRequest(dataDir: string, now: Date, lines: string[], told: { notDone?: NotDone }): { name: string; by: string | null } | null {
  const marker = restoreRequestPath(dataDir);
  let text: string | null = null;
  let age = 0;
  try {
    const st = lstatSync(marker);
    if (st.isFile() && st.size <= MARKER_MAX_BYTES) text = readFileSync(marker, "utf8");
    // a marker from the future is as wrong as an old one: the clock moved, and nobody knows when it was written
    age = Math.abs(now.getTime() - st.mtimeMs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
  }
  try {
    rmSync(marker);
    fsyncDir(dataDir);
  } catch (err) {
    lines.push(`database: the restore request ${marker} could not be removed (${(err as NodeJS.ErrnoException).code ?? "error"}), so nothing was restored. Remove it by hand.`);
    return null;
  }
  const [name = "", by, ...more] = (text ?? "").split("\n");
  if (text === null || more.length || !COPY_NAME.test(name) || (by !== undefined && !ASKER_ID.test(by))) {
    lines.push("database: the restore request did not hold the file name of a copy. It was removed and nothing was restored.");
    return null;
  }
  const asked = { name, by: by ?? null };
  if (age <= MARKER_MAX_AGE_MS) return asked;
  const detail = `the request was ${Math.round(age / 60_000)} minutes old, and one older than ${MARKER_MAX_AGE_MS / 60_000} minutes is not carried out`;
  lines.push(`database: the restore of backups/${name} asked for in the browser was not done: ${detail}. The request was removed. Ask again in the browser.`);
  told.notDone = { ...asked, why: "old", detail };
  return null;
}

/** Moves the database and its -wal and -shm files to <data>/damaged under one new name, and returns the main file's new path. */
function moveAside(dbPath: string, dir: string, now: Date): string {
  const name = `${basename(dbPath, ".db")}-${fileStamp(now)}`;
  let to = join(dir, `${name}.db`);
  // a second damaged file in the same second gets its own name: a move must never replace an earlier one
  for (let n = 2; ["", "-wal", "-shm"].some((suffix) => existsSync(to + suffix)); n++) to = join(dir, `${name}-${n}.db`);
  // the main file last: until it goes, a start that is cut off here finds the database where it was
  for (const suffix of ["-wal", "-shm", ""]) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, to + suffix);
  }
  return to;
}

export function gateDatabase(dbPath: string, now: Date, migrationsDir?: string): GateResult {
  // a request this start did not do goes with whatever else the start found: the database is still checked
  const told: { notDone?: NotDone } = {};
  const result = gate(dbPath, now, told, migrationsDir);
  return told.notDone ? { ...result, notDone: told.notDone } : result;
}

function gate(dbPath: string, now: Date, told: { notDone?: NotDone }, migrationsDir?: string): GateResult {
  const lines: string[] = [];
  const dataDir = dirname(dbPath);
  const backups = join(dataDir, "backups");
  try {
    const asked = takeRequest(dataDir, now, lines, told);
    if (asked) {
      try {
        const at = statSync(join(backups, asked.name)).mtime.toISOString();
        // restoreDatabase checks the copy and saves the current database as pre-restore-*.db first; its last line is for the CLI
        const done = restoreDatabase(dbPath, join("backups", asked.name), now, migrationsDir).slice(0, -1);
        lines.push(`database: restored from backups/${asked.name}, as asked in the browser. ${done.join(" ")}`);
        return { state: "restored", lines, cause: "requested", copy: { name: asked.name, at }, ...(asked.by ? { by: asked.by } : {}) };
      } catch (err) {
        lines.push(`database: the restore asked for in the browser was not done. ${(err as Error).message}`);
        told.notDone = { ...asked, why: "failed", detail: oneLine((err as Error).message) };
      }
    }

    if (!existsSync(dbPath)) {
      // an earlier start moved a damaged database aside and was cut off before the checked copy got its name:
      // left alone, the open would make an empty database and refuse to start over the copies, at every start
      if (finishStagedCopy(dbPath, migrationsDir)) {
        lines.push(`database: ${dbPath} was missing and a checked copy waited beside it: an earlier start moved a damaged database aside and was cut off. The copy is now the database. Changes made after that copy are lost.`);
        return { state: "restored", lines, cause: "damaged", copy: null };
      }
      // no file is a new install
      return { state: "ok", lines };
    }
    // an empty one is judged by the open (refuseEmptyOverData)
    if (statSync(dbPath).size === 0) return { state: "ok", lines };
    const reason = damageOf(dbPath, lines);
    if (reason === null) return { state: "ok", lines };

    const copy = newestIntactCopy(backups, migrationsDir);
    // the newest intact copy is the one the reset wrote before it emptied the data: every other copy is older than the reset, so nothing here is a start's to bring back alone
    if (!copy || copyKind(copy.name) === "pre-reset") {
      const none = copy ? `the newest intact copy backups/${copy.name} was written before the data was emptied, which a start does not take back alone` : `${backups} holds no intact copy`;
      lines.push(`database: ${dbPath} is damaged (${reason}) and ${none}. Starting on the damaged file. Restore a backup: docs/ADVANCED.md#restore-a-backup`);
      return { state: "damaged", lines, reason, waiting: null };
    }
    const dir = join(dataDir, "damaged");
    let next: string | undefined;
    let aside: string;
    try {
      // the folder and the checked copy first: what can fail for lack of space fails before anything has moved
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      next = stageCopy(copy.file, dbPath);
      // the staged copy's name is on the disk before the database leaves: a start cut off after the move finds it
      fsyncDir(dataDir);
      // four renames in a row: the stale -wal must be gone before the copy has the database's name
      aside = moveAside(dbPath, dir, now);
      renameSync(next, dbPath);
    } catch (err) {
      // the staged copy is the gate's own file: with the database still in place the next start makes a new one
      if (next && existsSync(dbPath)) rmSync(next, { force: true });
      const why = oneLine((err as Error).message);
      lines.push(`database: ${dbPath} is damaged (${reason}). The intact copy backups/${copy.name} could not be put in its place (${why}). Starting on the damaged file. Make room on the disk and restart: the next start restores the copy.`);
      return { state: "damaged", lines, reason, waiting: { name: copy.name, why } };
    }
    try {
      fsyncDir(dir);
      fsyncDir(dataDir);
    } catch (err) {
      // the copy has the database's name: a flush that fails does not make the restore undone
      lines.push(`database: the restore could not be flushed to the disk (${oneLine((err as Error).message)}).`);
    }
    lines.push(`database: ${dbPath} was damaged (${reason}). It was moved to ${aside} and backups/${copy.name} (written ${copy.at}) was restored. Changes made after that copy are lost.`);
    return { state: "restored", lines, cause: "damaged", copy: { name: copy.name, at: copy.at } };
  } catch (err) {
    lines.push(`database: the check before the start stopped (${(err as Error).message}). Starting without it.`);
    return { state: "ok", lines };
  }
}

/** How the detail of a `db_damaged` event begins when an intact copy waits for its place. gateEvent writes it and waitingCopy reads it back. */
const WAITS = (name: string) => `varmuuskopio ${name} odottaa: `;
const WAITS_READ = new RegExp(`^${WAITS("(\\S+)")}`);

/**
 * The security event for what the gate did. The detail is Finnish: an admin reads it in the security log, and the
 * notice at the top of the page starts with it (services/security.ts). `time` writes the copy's time as notices do.
 */
export function gateEvent(r: Exclude<GateResult, { state: "ok" }>, time: (iso: string) => string, asker?: string | null): { kind: "db_restored" | "db_damaged"; detail: string } {
  // a copy that waits: its name first, so the cut at 200 characters shortens the reason and never the name
  if (r.state === "damaged") return { kind: "db_damaged", detail: r.waiting ? `${WAITS(r.waiting.name)}${r.waiting.why}` : r.reason };
  const copy = r.copy ? `varmuuskopiosta ${r.copy.name} (${time(r.copy.at)})` : "varmuuskopiosta";
  if (r.cause === "damaged") return { kind: "db_restored", detail: `Tietokanta oli vaurioitunut. Se palautettiin ${copy}` };
  // `asker`: the display name of the admin who asked, when the restored database still knows them
  return { kind: "db_restored", detail: asker ? `${asker} palautti tietokannan ${copy}` : `Tietokanta palautettiin ${copy}` };
}

/**
 * How this start ended a restore asked for in the browser, for the audit list: the detail of an `ops_result` event
 * ("action: outcome") and the id of who asked. Null when none was asked. The request's own event, "pyydetty", is in
 * the database that was replaced, so after a restore this is the line that says who did it.
 */
export function requestOutcome(r: GateResult): { by: string | null; detail: string } | null {
  if (r.notDone) return { by: r.notDone.by, detail: `${RESTORE_LABEL}: ei tehty (${r.notDone.name}), ${r.notDone.why === "old" ? "pyyntö oli vanhentunut" : r.notDone.detail}` };
  if (r.state === "restored" && r.cause === "requested") return { by: r.by ?? null, detail: `${RESTORE_LABEL}: tehty (${r.copy?.name ?? ""})` };
  return null;
}

/**
 * What every admin is told about a request that was not done, as the detail of an `ops_notice`: the notice adds the
 * time of the start after it (services/security.ts). `asker` is the display name of who asked, when known.
 */
export function notDoneNotice(n: NotDone, asker: string | null): string {
  const asked = asker ? `${asker} pyysi tietokannan palautusta varmuuskopiosta ${n.name}` : `Tietokannan palautusta pyydettiin varmuuskopiosta ${n.name}`;
  return `${asked}, mutta tiedot ovat ennallaan, koska ${n.why === "old" ? "pyyntö oli vanhentunut ennen käynnistystä" : "palautus epäonnistui käynnistyksessä"}`;
}

/** The copy a `db_damaged` event says is waiting for its place, read from the detail gateEvent wrote. Null: no intact copy. */
export const waitingCopy = (detail: string | null | undefined): string | null => WAITS_READ.exec(detail ?? "")?.[1] ?? null;

/**
 * Whether an admin is told about the event. A database that stays damaged says so once and not again at every
 * start, so an unread notice that reads the same is enough. A restore is always told, and so is a damaged database
 * whose notice now reads differently (an intact copy waits, or no longer does).
 */
export function isNews(event: { kind: string; detail: string }, unread: readonly { kind: string; detail: string | null }[]): boolean {
  if (event.kind !== "db_damaged") return true;
  return !unread.some((e) => e.kind === "db_damaged" && waitingCopy(e.detail) === waitingCopy(event.detail));
}
