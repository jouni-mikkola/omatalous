/**
 * "Palauta viimeisin" (Asetukset > Ylläpito): an admin whose data went wrong yesterday takes the newest database copy
 * back from the browser, with no shell.
 *
 * The running app restores nothing. It leaves a marker in the data folder, <data>/.restore-request, that holds the
 * copy's file name, and stops. Docker's restart policy starts it again, and the check before the start
 * (db/startup-gate.ts) puts the copy in place before the database opens: the same code as after damage, so there is
 * one restore path.
 *
 * Rules:
 *   - The request names no file. The server picks the copy with `newestIntactCopy`, the one answer to "which copy
 *     would be restored".
 *   - A refusal changes nothing on disk. The marker is the last thing a request writes, whole or not at all.
 *   - One restore at a time, and none beside a reset (services/ops-danger.ts), a maintenance request the helper has
 *     or will take, or a bank fetch or other background work: the stop would cut those off.
 *   - Once the marker is there the process stops, whatever else fails. A marker that stayed would restore at some
 *     later start, when nobody expects it.
 */
import { renameSync, rmSync } from "node:fs";
import { type CopyKind, copyKind } from "../db/backup-keep.ts";
import { type IntactCopy, newestIntactCopy } from "../db/restore.ts";
import type { User } from "../db/rows.ts";
import { RESTORE_LABEL as LABEL, restoreRequestPath } from "../db/startup-gate.ts";
import { fsyncDir, writeNewFileDurable } from "../platform/durable.ts";
import { HttpUserError } from "../platform/errors.ts";
import { inflightCount } from "../platform/inflight.ts";
import type { Services } from "./context.ts";
import { dataDirOf } from "./disk.ts";
import { checkPassword, expireStale, type Req } from "./ops.ts";
import { beginDanger, dangerUnderWay, refuser } from "./ops-danger.ts";
import { busy, READ_ONLY, type Refusal, wrongWord } from "./ops-validate.ts";
import { recordEvent } from "./security.ts";

/** The word the admin types. A restore drops every change made after the copy. */
const RESTORE_WORD = "PALAUTA";
/** The answer leaves before the server stops taking requests. */
const STOP_AFTER_MS = 100;

/**
 * The copy as the page shows it: its file name in <data>/backups, when it was written (ISO), its size in bytes and
 * what it is. A `pre-reset` one undoes a reset, and the card says so.
 */
export interface RestoreCopy {
  name: string;
  at: string;
  size: number;
  kind: CopyKind;
}
const view = ({ name, at, size }: IntactCopy): RestoreCopy => ({ name, at, size, kind: copyKind(name) });

/** Ends the process as `docker stop` does: entry/node.ts answers SIGTERM with entry/shutdown.ts. */
const stopProcess = (): void => void process.kill(process.pid, "SIGTERM");

/** What the page shows before it asks: the copy a restore would take now, or null when there is no intact one. */
export function restoreState(s: Services): { copy: RestoreCopy | null; pending: boolean } {
  const copy = s.backupDir ? newestIntactCopy(s.backupDir) : null;
  return { copy: copy && view(copy), pending: dangerUnderWay(s) === "restore" };
}

/**
 * The marker whole or not at all: written beside its place, flushed and renamed, as the gate asks. It holds the
 * copy's file name and, on a second line, the id of the admin who asked (the request's own event is in the database
 * that is replaced): nothing else, and no line end after it. The gate carries a marker out only while it is young
 * (MARKER_MAX_AGE_MS). A write that fails leaves nothing behind.
 */
function writeMarker(dataDir: string, name: string, by: string): void {
  const marker = restoreRequestPath(dataDir);
  const next = `${marker}.new`;
  try {
    rmSync(next, { force: true });
    writeNewFileDurable(next, `${name}\n${by}`, 0o600, dataDir);
    renameSync(next, marker);
    fsyncDir(dataDir);
  } catch (err) {
    // the caller saw no marker before this, so one that is here now is this request's own
    for (const file of [next, marker]) {
      try {
        rmSync(file, { force: true });
      } catch {
        // not a file this request made
      }
    }
    throw err;
  }
}

/**
 * The last checks and the marker, with no wait in between: of two requests at once the second finds the first one's
 * marker, and a reset that started meanwhile holds the mark. Returns the copy the marker names, or why nothing was
 * written.
 */
function takeRestore(s: Services, by: string): IntactCopy | Refusal {
  // a bank fetch, the hourly tick or the tasks after an update: the stop would cut them off
  if (inflightCount() > 0) return { why: "taustatyö kesken", error: new HttpUserError("Pankkihaku tai muu taustatyö on kesken. Yritä hetken päästä uudelleen.", 409) };
  const under = dangerUnderWay(s);
  if (under === "restore") return { why: "palautus jo pyydetty", error: new HttpUserError("Tietokannan palautus on jo pyydetty. Se tehdään, kun sovellus käynnistyy uudelleen.", 409) };
  // a reset waits for the bank between its copy and its delete: the stop would cut it off after the consents ended
  if (under) return busy();
  const dir = dataDirOf(s);
  const copy = dir !== null && s.backupDir ? newestIntactCopy(s.backupDir) : null;
  if (dir === null || !copy) return { why: "ei ehjää varmuuskopiota", error: new HttpUserError("Ehjää varmuuskopiota ei löytynyt, joten mitään ei palautettu.", 409) };
  try {
    writeMarker(dir, copy.name, by);
  } catch (err) {
    console.error(`restore request: the marker could not be written (${(err as Error).message}). Nothing was changed.`);
    return { why: "pyyntöä ei voitu tallentaa", error: new HttpUserError("Palautuspyyntöä ei voitu tallentaa levylle. Mitään ei muutettu.", 503) };
  }
  beginDanger(s, "restore");
  return copy;
}

/**
 * Asks for the newest intact copy to be restored at the next start, and stops the server so that the start comes.
 * The route read `input` through strictObject, so it has those two fields and no other. Throws what the route
 * answers: 400 for a wrong word, 403 for a wrong password, 409 while something else is under way or no copy is intact.
 */
export async function requestRestore(s: Services, user: User, input: { password?: unknown; confirm?: unknown }, req: Req): Promise<{ copy: RestoreCopy }> {
  const refuse = refuser(s, user.id, req, LABEL);

  await refuse(wrongWord(input.confirm, RESTORE_WORD));
  await checkPassword(s, user, typeof input.password === "string" ? input.password : "", req, LABEL);

  // a request the helper never took no longer counts (it expires as it does for the queue)
  await expireStale(s);
  if (await s.ops.hasActiveMutating(READ_ONLY)) await refuse(busy());
  const taken = takeRestore(s, user.id);
  if ("error" in taken) return refuse(taken);

  try {
    console.log(`restore request: backups/${taken.name} is restored at the next start. Stopping for it.`);
    await recordEvent(s, { kind: "ops_request", userId: user.id, ...req, detail: `${LABEL}: pyydetty (${taken.name})` });
    for (const u of await s.users.list()) {
      if (u.role === "admin" && u.id !== user.id) await recordEvent(s, { kind: "ops_notice", userId: u.id, detail: `${user.displayName} käynnisti tietokannan palautuksen varmuuskopiosta`, notify: true });
    }
  } catch (err) {
    console.error("restore request: the event could not be recorded:", (err as Error).message);
  } finally {
    // the marker is on disk: the stop comes even when the log could not be written
    setTimeout(stopProcess, STOP_AFTER_MS);
  }
  return { copy: view(taken) };
}
