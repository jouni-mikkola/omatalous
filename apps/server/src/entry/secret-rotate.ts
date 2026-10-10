/**
 * `secret rotate`: a new app secret, with every sealed bank key re-sealed under it. Node only.
 *
 * Order, so that no step leaves the install without a working secret:
 *   1. the new secret is written next to the old one (<file>.next, mode 600)
 *   2. the database is copied (pre-secret-rotate-*.db), then all keys are re-sealed in one transaction
 *   3. the old secret is kept as <file>.prev-<date>, and <file>.next replaces <file> (an atomic rename)
 * A run that stopped after step 1 or 2 is finished by running the command again: it finds <file>.next and
 * checks which secret the database is sealed with.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Services } from "../services/context.ts";
import { databaseOpensWith, resealAll } from "../services/secret-rotation.ts";

export interface RotateOptions {
  secretFile: string;
  /** Writes a copy of the database and returns its path. */
  snapshot: () => string;
}

export async function rotateAppSecret(s: Services, opts: RotateOptions): Promise<string[]> {
  const oldSecret = s.config.appSecret;
  if (!oldSecret) throw new Error("No app secret is in use.");
  const file = opts.secretFile;
  const next = `${file}.next`;
  const lines: string[] = [];

  let newSecret: string;
  if (existsSync(next)) {
    newSecret = readFileSync(next, "utf8").trim();
    if (newSecret.length < 32) throw new Error(`${next} is too short. Delete it and run the command again.`);
    lines.push("The previous run was interrupted, continuing from it.");
  } else {
    newSecret = randomBytes(48).toString("base64url");
    writeFileSync(next, `${newSecret}\n`, { flag: "wx", mode: 0o600 });
  }

  if (await databaseOpensWith(s, oldSecret)) {
    lines.push(`Backup: ${opts.snapshot()}`);
    const r = await resealAll(s, oldSecret, newSecret);
    lines.push(`Re-sealed: ${r.userKeys} user keys, ${r.instanceKeys} shared keys.`);
  } else if (await databaseOpensWith(s, newSecret)) {
    lines.push("The keys are already sealed with the new secret.");
  } else {
    throw new Error("The keys in the database open with neither the old nor the new secret. Nothing was changed.");
  }

  const prev = `${file}.prev-${s.now().toISOString().slice(0, 19).replace(/[-:]/g, "")}`;
  copyFileSync(file, prev);
  chmodSync(prev, 0o600);
  renameSync(next, file);
  chmodSync(file, 0o600);
  lines.push(`The new secret is in ${file}. The old one is in ${prev}. It is only needed to open old backups, so delete it once those are gone (14 days).`);
  lines.push("Restart the app: docker compose restart banking");
  return lines;
}
