/**
 * Loads the installed add-on module at start, before the database opens (docs/MODULES.md, "What the host does", 3): the
 * kept bundle's signature is checked again, its host range against the running version, its files are extracted afresh
 * and `server.mjs` registers its entry. Any failure leaves the module out and the app starts without it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MigrationError } from "../db/migrate.ts";
import { EXTENSIONS } from "../extensions.ts";
import { BundleRefused, checkBundle, NotForThisVersion } from "./bundle.ts";
import { HOST_KEY, moduleHost } from "./host.ts";
import { extract, readActive, readKept } from "./store.ts";

export type StartState =
  | { state: "none" }
  | { state: "connected"; id: string; version: string; label?: string; filesDir: string; css: boolean }
  | { state: "waiting"; id: string; version: string }
  | { state: "refused"; id: string; version: string; reason: string };

/** What the routes and the page need of the module: where it lives, which signers this build trusts and what the start did. */
export interface ModuleRuntime {
  /** `<DATA_DIR>/modules`. */
  root: string;
  signersFile: string | null;
  start: StartState;
}

/** The reason of a module left out because one of its migrations failed; the status line in Asetukset reads it. */
export const MIGRATION_FAILED = "a migration of the module failed at start";

/**
 * Opens the database with the module's migrations, and again without the module when one of its own files fails, so a
 * broken release does not stop the app in a restart loop. The start state then says why, and `dropped` is the error
 * for the log. A failing shared migration stops the start as before. The next start tries the module again.
 */
export async function openWithModule<T>(start: StartState, open: () => Promise<T>): Promise<{ opened: T; start: StartState; dropped: string | null }> {
  try {
    return { opened: await open(), start, dropped: null };
  } catch (err) {
    const entry = start.state === "connected" ? EXTENSIONS.find((e) => e.id === start.id) : undefined;
    const file = err instanceof MigrationError ? err.migration : undefined;
    if (start.state !== "connected" || !entry?.migrationsDir || !file || !existsSync(join(entry.migrationsDir, file))) throw err;
    EXTENSIONS.splice(EXTENSIONS.indexOf(entry), 1);
    return { opened: await open(), start: { state: "refused", id: start.id, version: start.version, reason: MIGRATION_FAILED }, dropped: (err as Error).message };
  }
}

export async function loadInstalledModule(opts: { root: string; signersFile: string | null; appVersion: string }): Promise<StartState> {
  const active = readActive(opts.root);
  if (!active) return { state: "none" };
  const refused = (reason: string): StartState => ({ state: "refused", ...active, reason });
  const kept = await readKept(opts.root, active);
  if (!kept) return refused("the installed bundle is missing");
  let checked;
  try {
    checked = await checkBundle(kept.packed, kept.signature, { signersFile: opts.signersFile, appVersion: opts.appVersion, version: active.version });
  } catch (err) {
    if (err instanceof NotForThisVersion) return { state: "waiting", ...active };
    return refused(err instanceof BundleRefused ? err.message : "the bundle could not be read");
  }
  if (checked.manifest.id !== active.id) return refused("the bundle names another module");
  let dir: string;
  try {
    dir = await extract(opts.root, active, checked.files);
  } catch {
    return refused("the bundle could not be written to the data folder");
  }
  const migrationsDir = checked.manifest.migrations ? join(dir, "migrations") : undefined;
  const { host, added, close } = moduleHost({ id: active.id, version: opts.appVersion, dir, migrationsDir: migrationsDir && existsSync(migrationsDir) ? migrationsDir : undefined });
  const g = globalThis as Record<symbol, unknown>;
  g[HOST_KEY] = host;
  try {
    const mod = (await import(pathToFileURL(join(dir, "server.mjs")).href)) as { default?: unknown };
    if (typeof mod.default !== "function") throw new Error("server.mjs has no register function");
    await (mod.default as (h: typeof host) => unknown)(host);
    if (!added()) throw new Error("the module added no entry");
  } catch (err) {
    const entry = added();
    if (entry) EXTENSIONS.splice(EXTENSIONS.indexOf(entry), 1);
    console.error(`add-on module ${active.id} ${active.version} did not load: ${(err as Error).message}`);
    return refused("the module did not start");
  } finally {
    close();
  }
  const entry = added()!;
  return { state: "connected", ...active, label: entry.label, filesDir: dir, css: !!checked.manifest.css };
}
