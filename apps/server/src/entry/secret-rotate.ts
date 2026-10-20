/**
 * `secret rotate`: a new app secret, with every sealed bank key re-sealed under it. Node only.
 *
 * Order, so that no step leaves the install without a working secret:
 *   1. the new secret is written next to the old one (<file>.next, mode 600)
 *   2. the database is copied (pre-secret-rotate-*.db), then all keys are re-sealed in one transaction
 *   3. the old secret is kept as <file>.prev-<date>, and <file>.next replaces <file> (an atomic rename)
 * A run that stopped after step 1 or 2 is finished by running the command again: it finds <file>.next and
 * checks which secret the database is sealed with. A run that stopped between the database commit and the
 * rename (a crash, a power loss) is finished by the next start (finishInterruptedRotation).
 * Every file and its folder are flushed to disk before the next step, because the database commit is durable
 * and a lost .next would leave keys sealed with a secret nobody has.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { fsyncDir, fsyncFile, writeNewFileDurable } from "../platform/durable.ts";
import type { Services } from "../services/context.ts";
import { databaseOpensWith, resealAll, tokenStops, triedAgainstToken } from "../services/secret-rotation.ts";
import { isAppSecret } from "./app-secret.ts";

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
    if (!isAppSecret(newSecret)) throw new Error(`${next} is too short. Delete it and run the command again.`);
    lines.push("The previous run was interrupted, continuing from it.");
  } else {
    newSecret = randomBytes(48).toString("base64url");
    writeNewFileDurable(next, `${newSecret}\n`, 0o600, dirname(file));
  }

  if (await databaseOpensWith(s, oldSecret)) {
    lines.push(`Backup: ${opts.snapshot()}`);
    const r = await resealAll(s, oldSecret, newSecret);
    lines.push(`Re-sealed: ${r.userKeys} user keys, ${r.instanceKeys} shared keys.`);
  } else if (await databaseOpensWith(s, newSecret)) {
    lines.push("The keys are already sealed with the new secret.");
  } else {
    if (await triedAgainstToken(s)) throw new Error(tokenStops("opens with neither the old nor the new secret"));
    throw new Error("The keys in the database open with neither the old nor the new secret. Nothing was changed.");
  }

  const prev = installNext(file, next, s.now());
  lines.push(`The new secret is in ${file}. The old one is in ${prev}. It is only needed to open old backups, so delete it once those are gone (14 days).`);
  lines.push("Restart the app: docker compose restart banking");
  return lines;
}

/**
 * True when the secret file holds another secret than the one this process runs with: a rotation was made and the app
 * waits for its restart, so whatever it sealed now would be sealed with a key that is gone after it.
 */
export function secretFileDiffers(file: string | null, running: string | null | undefined): boolean {
  if (!file || !running) return false;
  try {
    return readFileSync(file, "utf8").trim() !== running;
  } catch {
    return false;
  }
}

/** Keeps the old secret as <file>.prev-<stamp> and makes <file>.next the secret file; each step is flushed. */
function installNext(file: string, next: string, at: Date): string {
  const prev = `${file}.prev-${at.toISOString().slice(0, 19).replace(/[-:]/g, "")}`;
  copyFileSync(file, prev);
  chmodSync(prev, 0o600);
  fsyncFile(prev);
  fsyncFile(next);
  renameSync(next, file);
  chmodSync(file, 0o600);
  fsyncDir(dirname(file));
  return prev;
}

/**
 * At start: a <file>.next left behind next to a database that is already sealed with it means the rotation
 * committed but stopped before the rename. The rename is finished here, otherwise the app would start with
 * the old secret and every stored bank key would fail to open. Returns the secret now in use, or null when
 * nothing changed.
 */
export async function finishInterruptedRotation(s: Services, secretFile: string): Promise<string | null> {
  const next = `${secretFile}.next`;
  if (!existsSync(next)) return null;
  const current = s.config.appSecret;
  const candidate = readFileSync(next, "utf8").trim();
  if (!current || !isAppSecret(candidate)) return null;
  if (await databaseOpensWith(s, current)) return null; // not committed: running the command again continues it
  if (!(await databaseOpensWith(s, candidate))) {
    console.error(`${next} exists but the stored keys open with neither it nor ${secretFile}. Nothing was changed. See docs/ADVANCED.md.`);
    return null;
  }
  const prev = installNext(secretFile, next, s.now());
  console.warn(`recovery: an interrupted secret rotation was finished (the stored keys were already sealed with the new secret). The old secret is in ${prev}.`);
  return candidate;
}
