/**
 * The app secret encrypts bank keys stored in the database. It lives in a
 * file outside the database (Docker: the banking-secrets volume at
 * /secrets/app_secret), so a copied database alone reveals no keys.
 *
 * Nobody has to create it: on first start a random secret is written with
 * mode 600. The file is created exclusively (O_EXCL), so an existing file is
 * never overwritten and a planted symlink is not followed. Node only.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { writeNewFileDurable } from "../platform/durable.ts";

/**
 * Not mkdirSync(recursive): on a path under /proc Node's recursive mkdir never returns (100 % CPU, no log, a
 * container that never crashes), so the missing parents are created one level at a time.
 */
function ensureDir(dir: string): void {
  const missing: string[] = [];
  for (let d = dir; !existsSync(d); d = dirname(d)) {
    missing.push(d);
    if (dirname(d) === d) break;
  }
  for (const d of missing.reverse()) mkdirSync(d, { mode: 0o700 });
}

/**
 * Whether a text, trimmed as every reader of the secret trims it, can be the app secret: under 32 characters is too
 * weak to derive an encryption key from. The one statement of the rule for the server.
 */
export const isAppSecret = (text: string): boolean => text.length >= 32;

export type AppSecretResult = { secret: string; created: boolean } | { secret: null; problem: string };

export function loadOrCreateAppSecret(path: string): AppSecretResult {
  try {
    const secret = readFileSync(path, "utf8").trim();
    if (!isAppSecret(secret)) return { secret: null, problem: `${path} is too short (at least 32 characters)` };
    if (process.platform !== "win32" && statSync(path).mode & 0o077) {
      console.warn(`${path}: the file is readable by others, set its mode to 600`);
    }
    return { secret, created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { secret: null, problem: `${path}: ${(err as Error).message}` };
  }
  try {
    ensureDir(dirname(path));
    const secret = randomBytes(48).toString("base64url");
    writeNewFileDurable(path, `${secret}\n`, 0o600, dirname(path));
    return { secret, created: true };
  } catch (err) {
    return { secret: null, problem: `could not create the app secret (${path}): ${(err as Error).message}` };
  }
}
