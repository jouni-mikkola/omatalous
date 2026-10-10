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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

export type AppSecretResult = { secret: string; created: boolean } | { secret: null; problem: string };

export function loadOrCreateAppSecret(path: string): AppSecretResult {
  try {
    const secret = readFileSync(path, "utf8").trim();
    if (secret.length < 32) return { secret: null, problem: `${path} on liian lyhyt (vähintään 32 merkkiä)` };
    if (process.platform !== "win32" && statSync(path).mode & 0o077) {
      console.warn(`${path}: tiedosto on muidenkin luettavissa, aseta oikeudeksi 600`);
    }
    return { secret, created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { secret: null, problem: `${path}: ${(err as Error).message}` };
  }
  try {
    ensureDir(dirname(path));
    const secret = randomBytes(48).toString("base64url");
    writeFileSync(path, `${secret}\n`, { flag: "wx", mode: 0o600 });
    return { secret, created: true };
  } catch (err) {
    return { secret: null, problem: `salausavainta ei voitu luoda (${path}): ${(err as Error).message}` };
  }
}
