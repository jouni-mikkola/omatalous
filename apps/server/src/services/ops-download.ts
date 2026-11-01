/** The newest intact database copy for download, after the admin's password (Asetukset > Ylläpito). */
import { createReadStream } from "node:fs";
import { newestIntactCopy } from "../db/restore.ts";
import { restorableCopyName } from "../db/backup-keep.ts";
import type { User } from "../db/rows.ts";
import { TooManyAttempts, UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";
import { checkPassword, listAppBackups, notifyAdmins, type Req } from "./ops.ts";
import { recordEvent } from "./security.ts";

/** The newest database copy, after the password. Returns the file to stream. */
export async function backupForDownload(s: Services, user: User, password: string, req: Req): Promise<{ stream: ReturnType<typeof createReadStream>; name: string; size: number }> {
  const key = `dl:${user.id}`;
  const attempt = s.opsDownloadLimiter.consume(key);
  if (attempt.wait) throw new TooManyAttempts("Liian monta latausta tunnissa. Yritä myöhemmin.", attempt.wait);
  await checkPassword(s, user, password, req, "varmuuskopion lataus");
  const copies = listAppBackups(s);
  if (!s.backupDir || !copies.length) throw new UserError("Varmuuskopiota ei ole vielä. Ota ensin varmuuskopio.");
  // the copy a restore would take (db/restore.ts): the full check runs on the file that is about to leave the
  // machine, and what a restore saved of the database it replaced (pre-restore-*) is never handed out as the newest
  const newest = newestIntactCopy(s.backupDir);
  for (const b of copies.slice(0, Math.max(0, copies.findIndex((c) => c.name === newest?.name)))) {
    if (restorableCopyName(b.name)) console.error(`backup download: ${b.name} failed its check and is skipped`);
  }
  if (!newest) throw new UserError("Varmuuskopiot eivät läpäisseet tarkistusta. Ota uusi varmuuskopio.");
  await recordEvent(s, { kind: "ops_download", userId: user.id, ...req, detail: `varmuuskopion lataus: ladattu (${newest.name})`, notify: false });
  await notifyAdmins(s, user, `${user.displayName} latasi tietokannan varmuuskopion`);
  return { stream: createReadStream(newest.file), name: newest.name, size: newest.size };
}
