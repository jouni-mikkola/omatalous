/**
 * What the dangerous actions of Asetukset > Ylläpito share: the one way a request says no, and the one answer to "is
 * a reset or a restore under way".
 *
 * The reset (services/reset.ts) empties the database and the restore (services/db-restore.ts) replaces it. Neither
 * may start while the other is under way: a restore's stop would cut a reset off after it ended the bank consents,
 * and a reset beside a pending restore would empty a database that the next start replaces. Each asks here before it
 * starts and takes the mark with no wait in between. Nothing is stored: the mark lives in this process, and a
 * restore that waits for the start is also seen by its marker in the data folder.
 */
import { lstatSync } from "node:fs";
import { restoreRequestPath } from "../db/startup-gate.ts";
import type { Services } from "./context.ts";
import { dataDirOf } from "./disk.ts";
import type { Req } from "./ops.ts";
import type { Refusal } from "./ops-validate.ts";
import { recordEvent } from "./security.ts";

/** Throws for a refusal and does nothing for null. */
export interface Refuse {
  (no: Refusal): Promise<never>;
  (no: Refusal | null): Promise<void>;
}

/**
 * Records the `ops_denied` event of a refusal, "<label>: <why>", and throws what the admin is told. The queue, the
 * reset and the restore all refuse through this, so no refused attempt is missing from the audit list.
 */
export function refuser(s: Services, userId: string, req: Req, label: string): Refuse {
  return (async (no: Refusal | null) => {
    if (!no) return;
    await recordEvent(s, { kind: "ops_denied", userId, ...req, detail: `${label}: ${no.why}` });
    throw no.error;
  }) as Refuse;
}

export type Danger = "reset" | "restore";

/** The database and which of the two this process has under way on it. */
const underWay = new WeakMap<object, Danger>();

/** Anything at the marker's path counts, also a link or a file that cannot be looked at. */
function markerThere(dataDir: string): boolean {
  try {
    return lstatSync(restoreRequestPath(dataDir), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Which of the two is under way on this app's database, or null. A restore is under way from its request to the
 * stop: this process took the request, or a marker is in the data folder.
 */
export function dangerUnderWay(s: Services): Danger | null {
  const dir = dataDirOf(s);
  return underWay.get(s.db) ?? (dir !== null && markerThere(dir) ? "restore" : null);
}

/**
 * Takes the mark. The caller asked dangerUnderWay and awaited nothing since, so two requests never both hold it. A
 * reset gives it back with endDanger; a restore keeps it, because the process is about to stop.
 */
export function beginDanger(s: Services, what: Danger): void {
  underWay.set(s.db, what);
}

export function endDanger(s: Services): void {
  underWay.delete(s.db);
}
