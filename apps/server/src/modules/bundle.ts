/**
 * Checks an add-on module bundle (docs/MODULES.md): its signature against the signers file of this tree, then every tar
 * entry and the manifest. Only a bundle that passes all of it comes back as files; nothing is written or run here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atOrAbove, compatFloor, MigrationError } from "../db/migrate.ts";
import { parseVersion, parseRange, satisfies } from "./semver.ts";
import { BundleRefused, readTarGz } from "./tar.ts";

export { BundleRefused } from "./tar.ts";

/** A sound bundle built for other versions of the app: a newer release may fit, so the check waits instead of refusing. */
export class NotForThisVersion extends BundleRefused {
  override name = "NotForThisVersion";
}

/** The principal and the namespace of every module signature. */
const SIGNATURE_NAMESPACE = "omatalous-module";
const SIG_MAX = 8 * 1024;
const VERIFY_TIMEOUT_MS = 20_000;

interface Manifest {
  id: string;
  version: string;
  host: string;
  server: "server.mjs";
  web: "web.mjs";
  css?: "web.css";
  migrations?: "migrations/";
}

export interface CheckedBundle {
  manifest: Manifest;
  files: Map<string, Buffer>;
}

const ID = /^[a-z][a-z0-9-]{1,30}$/;
/**
 * Ids the app uses itself. The module's routes are mounted at /api/<id>, its page at #/<id> and its CLI commands under
 * <id>, so one of these would shadow a shared route, page or command, and with `tokenReads` open every shared GET under
 * that prefix to a service token. modules.test.ts holds this list equal to or above what the app mounts.
 */
export const RESERVED_IDS: ReadonlySet<string> = new Set([
  // first segments of the shared /api routes, and /modules of the web files
  "accounts", "admin", "ahead", "auth", "bank", "bank-file", "card-file", "connections", "dashboard", "data", "demo",
  "expected-bills", "explain", "export", "foreign-rows", "health", "household-members", "import", "language", "loans",
  "marks", "merchants", "meta", "modules", "ops", "payer-roles", "recurring", "reports", "review", "rules", "security",
  "settlement", "statements", "sync", "transactions", "users",
  // shared pages
  "overview", "bills", "settings",
  // shared CLI commands
  "address", "help", "secret", "service-token", "sessions", "setup-code", "user", "version",
]);
const MIGRATION = /^migrations\/(9[0-8]\d\d)_[a-z0-9_]{1,60}\.sql$/;
const ASSET = /^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.(mjs|css|svg|png|woff2)$/;
const KEYS = new Set(["id", "version", "host", "server", "web", "css", "migrations"]);

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The signers file of the build: beside the bundle in the image (/app/module_signers), release/ in the tree. In the
 * tree the code runs either bundled (apps/server/dist/node.js, `pnpm start`) or from source (src/modules/bundle.ts).
 */
export function findSignersFile(): string | null {
  return [resolve(here, "../module_signers"), resolve(here, "../../../release/module_signers"), resolve(here, "../../../../release/module_signers")].find((p) => existsSync(p)) ?? null;
}

/** Runs `ssh-keygen -Y verify` over the tar. True only for a signature by a key of the signers file for the module namespace. */
async function signatureOk(packed: Buffer, signature: Buffer, signersFile: string): Promise<boolean> {
  if (signature.length === 0 || signature.length > SIG_MAX) return false;
  const dir = await mkdtemp(join(tmpdir(), "module-sig-"));
  try {
    const sigFile = join(dir, "bundle.sig");
    await writeFile(sigFile, signature, { mode: 0o600 });
    return await new Promise<boolean>((done) => {
      let child;
      try {
        child = spawn("ssh-keygen", ["-Y", "verify", "-f", signersFile, "-I", SIGNATURE_NAMESPACE, "-n", SIGNATURE_NAMESPACE, "-s", sigFile], { stdio: ["pipe", "ignore", "ignore"], timeout: VERIFY_TIMEOUT_MS });
      } catch {
        done(false);
        return;
      }
      child.on("error", () => done(false));
      child.on("close", (code) => done(code === 0));
      child.stdin.on("error", () => undefined);
      child.stdin.end(packed);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseManifest(raw: Buffer | undefined): Manifest {
  if (!raw) throw new BundleRefused("bundle has no manifest");
  let m: unknown;
  try {
    m = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new BundleRefused("manifest is not JSON");
  }
  if (typeof m !== "object" || m === null || Array.isArray(m)) throw new BundleRefused("manifest is not an object");
  const o = m as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.has(k)) throw new BundleRefused("manifest has an unknown key");
  if (typeof o.id !== "string" || !ID.test(o.id)) throw new BundleRefused("manifest id is not valid");
  if (RESERVED_IDS.has(o.id)) throw new BundleRefused("manifest id is one the app uses itself");
  if (typeof o.version !== "string" || !parseVersion(o.version)) throw new BundleRefused("manifest version is not valid");
  if (typeof o.host !== "string" || !parseRange(o.host)) throw new BundleRefused("manifest host range is not valid");
  if (o.server !== "server.mjs" || o.web !== "web.mjs") throw new BundleRefused("manifest names other entry files");
  if (o.css !== undefined && o.css !== "web.css") throw new BundleRefused("manifest names another stylesheet");
  if (o.migrations !== undefined && o.migrations !== "migrations/") throw new BundleRefused("manifest names another migrations folder");
  return o as unknown as Manifest;
}

/** Whether the bundle may hold this path: the table of docs/MODULES.md. */
function allowed(path: string, manifest: Manifest): boolean {
  if (path === "manifest.json" || path === "server.mjs" || path === "web.mjs") return true;
  if (path === "web.css") return manifest.css === "web.css";
  if (MIGRATION.test(path)) return manifest.migrations === "migrations/";
  return ASSET.test(path);
}

/**
 * Each migration declares a compat floor this version meets. The module's tables stay when it is removed, refused at a
 * start or waits for another app version, and the shared migrate refuses a database with an unknown migration that has
 * no floor: one such file would keep the whole app from starting the first time the module is not loaded.
 */
function migrationsHaveFloor(files: Map<string, Buffer>, appVersion: string): void {
  for (const [path, data] of files) {
    if (!MIGRATION.test(path)) continue;
    let floor: string | null;
    try {
      floor = compatFloor({ name: path.slice("migrations/".length), sql: data.toString("utf8") });
    } catch (err) {
      if (err instanceof MigrationError) throw new BundleRefused("a migration has a compat floor that is not a version");
      throw err;
    }
    if (floor === null) throw new BundleRefused("a migration has no compat floor");
    if (!atOrAbove(appVersion, floor)) throw new BundleRefused("a migration has a compat floor above this version");
  }
}

/**
 * The checked bundle, or BundleRefused with the reason. `version` is the one the release asset was named for, and
 * `appVersion` the running app's: the manifest's host range must hold it.
 */
export async function checkBundle(packed: Buffer, signature: Buffer, opts: { signersFile: string | null; appVersion: string; version?: string }): Promise<CheckedBundle> {
  if (!opts.signersFile) throw new BundleRefused("this install trusts no module signer");
  if (!(await signatureOk(packed, signature, opts.signersFile))) throw new BundleRefused("signature does not verify");
  const { files, dirs } = readTarGz(packed);
  const manifest = parseManifest(files.get("manifest.json"));
  for (const dir of dirs) if (dir !== "migrations" && dir !== "assets") throw new BundleRefused("bundle has a folder it may not have");
  for (const path of files.keys()) if (!allowed(path, manifest)) throw new BundleRefused("bundle has a file it may not have");
  if (!files.has("server.mjs") || !files.has("web.mjs")) throw new BundleRefused("bundle lacks an entry file");
  if (manifest.css && !files.has("web.css")) throw new BundleRefused("bundle lacks its stylesheet");
  if (opts.version !== undefined && manifest.version !== opts.version) throw new BundleRefused("manifest version differs from the release");
  if (!satisfies(opts.appVersion, manifest.host)) throw new NotForThisVersion("built for another version of the app");
  migrationsHaveFloor(files, opts.appVersion);
  return { manifest, files };
}
