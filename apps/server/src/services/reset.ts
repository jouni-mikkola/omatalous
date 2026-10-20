/**
 * Starting over from the browser (Asetukset > Ylläpito): the household's data goes and the install stays.
 *
 * Gone: every member with their accounts, transactions, rules, marks, loans, expected bills, saving tips, bank keys,
 * bank connections, sessions and security events, the settings rows that belong to one user, and the payee names the
 * trade register did not know as a company (a private person's name among them).
 * Kept: the account of the admin who asked (same id, name, password and role), the instance settings, the shared bank
 * application, the trade register's answers about companies, the maintenance rows and every database copy.
 *
 * The order is what makes it safe:
 *   1. a copy of the database is written and checked. When that fails, nothing else happens.
 *   2. every member's bank consents are ended at the bank, while their keys still exist. A consent that cannot be
 *      ended is counted and the reset goes on: it dies with its key.
 *   3. one transaction deletes every user (the cascades take the rest) and puts the admin's row back.
 * One reset runs at a time, and none while a restore waits for the start (services/ops-danger.ts). A request whose
 * session an earlier reset removed is refused: a second copy would hold the emptied database, under the first one's
 * name when the second is the same.
 * No secret is written anywhere on the way: the log, the event and the answer hold file names and counts only.
 * scripts/reset.sh is the other reset: it removes the whole install.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { revokeAllConnections } from "../connectors/registry.ts";
import { verifyDatabaseFile } from "../db/backup-check.ts";
import { RESET_LABEL, snapshotName } from "../db/backup-keep.ts";
import { takeSnapshot } from "../db/open.ts";
import type { User } from "../db/rows.ts";
import { HttpUserError } from "../platform/errors.ts";
import { inflightCount } from "../platform/inflight.ts";
import type { Services } from "./context.ts";
import { checkPassword, type Req } from "./ops.ts";
import { beginDanger, dangerUnderWay, endDanger, refuser } from "./ops-danger.ts";
import { busy, oneLine, READ_ONLY, wrongWord } from "./ops-validate.ts";
import { recordEvent } from "./security.ts";

/** What the admin types to confirm. */
const RESET_WORD = "TYHJENNÄ";
const WHAT = "tietojen tyhjennys";

export interface ResetResult {
  ok: true;
  /** File name of the copy made first, in <data>/backups. */
  copy: string;
  /** Bank consents ended at the bank. */
  revoked: number;
  /** Consents that could not be ended; they expire at the bank on their own. */
  failed: number;
  /** Every session is gone, the asker's too. */
  message: string;
}

/** What an error says, cleaned for the log: one line, the app secret and anything key-like taken out. */
const told = (s: Services, err: unknown) => oneLine(err instanceof Error ? err.message : "error", 300, s.config.appSecret ? [s.config.appSecret] : []);

/** `input` is the body after the route's strictObject; `sessionId` is the session the request came in with. */
export async function resetData(s: Services, user: User, input: { password?: unknown; confirm?: unknown }, req: Req, sessionId: string | undefined): Promise<ResetResult> {
  const deny = refuser(s, user.id, req, WHAT);
  const refuse = (why: string, error: HttpUserError): Promise<never> => deny({ why, error });
  const wrong = wrongWord(input.confirm, RESET_WORD);
  if (wrong) return deny(wrong);
  // Asked and taken before the first await of this request, so two requests never both hold the mark. A restore
  // that waits for the start counts as well: the reset would empty a database that the start then replaces.
  if (dangerUnderWay(s)) return deny(busy());
  beginDanger(s, "reset");
  try {
    await checkPassword(s, user, typeof input.password === "string" ? input.password : "", req, WHAT);
    // A reset that ended while this request waited took every session with it: this one is its double, not a new wish.
    if (!sessionId || !(await s.users.getSession(sessionId))) {
      return await refuse("istunto päättynyt", new HttpUserError("Istunto on päättynyt. Kirjaudu sisään uudelleen.", 409));
    }
    const notAdmin = () => refuse("ei ylläpitäjä", new HttpUserError("Tunnuksesi ei ole enää ylläpitäjä, joten mitään ei tyhjennetty.", 403));
    // the asker as the database has them now, before a consent is ended
    if ((await s.users.get(user.id))?.role !== "admin") return await notAdmin();
    if (await s.ops.hasActiveMutating(READ_ONLY)) await deny(busy());
    const file = await s.users.databaseFile();
    const db = s.db as typeof s.db & { exec?: (sql: string) => void };
    if (!file || typeof db.exec !== "function") {
      return await refuse("ei tietokantatiedostoa", new HttpUserError("Tietokannasta ei saa tässä asennuksessa varmuuskopiota, joten mitään ei tyhjennetty.", 503));
    }
    // a bank fetch or a scheduled run would write rows after the copy: they would be in neither
    if (inflightCount() > 0) await refuse("haku kesken", new HttpUserError("Tietojen haku on kesken. Yritä hetken päästä uudelleen.", 409));
    // a copy of this second is never written over: it may be the only one that holds the household
    const at = s.now();
    if (existsSync(join(dirname(file), "backups", snapshotName(RESET_LABEL, at)))) {
      await refuse("varmuuskopio on jo", new HttpUserError("Samalla hetkellä tehty varmuuskopio on jo olemassa. Yritä hetken päästä uudelleen.", 409));
    }

    // 1. the copy, checked here once more: it is the only way back
    let copy: string;
    try {
      copy = takeSnapshot({ exec: (sql) => db.exec!(sql) }, file, RESET_LABEL, at);
      const check = verifyDatabaseFile(copy);
      if (!check.ok) throw new Error(`the copy ${basename(copy)} failed its check: ${check.reason}`);
    } catch (err) {
      console.error("data reset: the copy could not be made, nothing was deleted:", told(s, err));
      return await refuse("varmuuskopio epäonnistui", new HttpUserError("Varmuuskopion teko epäonnistui, joten mitään ei tyhjennetty.", 503));
    }

    // 2. the consents, while the keys exist
    const bank = { revoked: 0, failed: 0 };
    for (const member of await s.users.list()) {
      try {
        const r = await revokeAllConnections(s, member.id);
        bank.revoked += r.revoked;
        bank.failed += r.failed;
      } catch (err) {
        // the kind of error only: what a bank client throws may quote a request
        bank.failed++;
        console.error(`data reset: ending one member's bank consents failed (${err instanceof Error ? err.name : "error"}), the reset goes on`);
      }
    }
    const counts = `pankkiyhteyksiä lopetettu ${bank.revoked}, lopettamatta jäi ${bank.failed}`;

    // 3. the one transaction: every user goes and the admin's row, as it is now, comes back (db/users-repo.ts)
    let emptied: boolean;
    try {
      emptied = await s.users.deleteAllBut(user.id, s.now().toISOString());
    } catch (err) {
      console.error("data reset: the delete failed and was rolled back:", told(s, err));
      await recordEvent(s, { kind: "ops_denied", userId: user.id, ...req, detail: `${WHAT}: tyhjennys epäonnistui, varmuuskopio ${basename(copy)}, ${counts}` });
      throw new HttpUserError(
        bank.revoked ? "Tietojen tyhjennys epäonnistui, ja tiedot ovat ennallaan. Pankkiyhteydet ehdittiin lopettaa: yhdistä pankki uudelleen." : "Tietojen tyhjennys epäonnistui, ja tiedot ovat ennallaan.",
        503,
      );
    }
    if (!emptied) return await notAdmin();
    try {
      // the deleted rows must not stay in the file's free pages
      await s.users.compact();
    } catch (err) {
      console.error("data reset: database compaction failed:", told(s, err));
    }
    await recordEvent(s, { kind: "data_reset", userId: user.id, ...req, detail: `varmuuskopio ${basename(copy)}, ${counts}` });
    console.log(`data reset: done, the copy is backups/${basename(copy)} (bank consents ended ${bank.revoked}, not ended ${bank.failed})`);
    return { ok: true, copy: basename(copy), ...bank, message: "Tiedot on tyhjennetty. Kirjaudu sisään uudelleen." };
  } finally {
    endDanger(s);
  }
}
