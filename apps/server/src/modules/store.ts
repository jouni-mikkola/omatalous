/**
 * The add-on module on disk (docs/MODULES.md): `<DATA_DIR>/modules/active.json` names the installed `{ id, version }`,
 * and `<id>/<version>/` keeps the verified tar and its signature. The start extracts the tar afresh into `files/`, so
 * what runs always comes from a bundle whose signature was checked at this start.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseVersion } from "./semver.ts";
import type { CheckedBundle } from "./bundle.ts";

export interface Active {
  id: string;
  version: string;
}

const ID = /^[a-z][a-z0-9-]{1,30}$/;
const BUNDLE = "bundle.tar.gz";
const SIG = "bundle.tar.gz.sig";

const activeFile = (root: string) => join(root, "active.json");
const versionDir = (root: string, a: Active) => join(root, a.id, a.version);
const filesDir = (root: string, a: Active) => join(versionDir(root, a), "files");

/** The installed module, or null when there is none or the file is not one this code wrote. */
export function readActive(root: string): Active | null {
  try {
    const j = JSON.parse(readFileSync(activeFile(root), "utf8")) as Partial<Active>;
    if (typeof j.id !== "string" || !ID.test(j.id) || typeof j.version !== "string" || !parseVersion(j.version)) return null;
    return { id: j.id, version: j.version };
  } catch {
    return null;
  }
}

export async function readKept(root: string, a: Active): Promise<{ packed: Buffer; signature: Buffer } | null> {
  const dir = versionDir(root, a);
  if (!existsSync(join(dir, BUNDLE)) || !existsSync(join(dir, SIG))) return null;
  return { packed: await readFile(join(dir, BUNDLE)), signature: await readFile(join(dir, SIG)) };
}

/** Keeps the verified tar and its signature, names it in active.json and deletes every other version and module. */
export async function install(root: string, checked: CheckedBundle, packed: Buffer, signature: Buffer): Promise<Active> {
  const a: Active = { id: checked.manifest.id, version: checked.manifest.version };
  await mkdir(join(root, a.id), { recursive: true, mode: 0o700 });
  const tmp = join(root, a.id, `.tmp-${process.pid}-${Date.now()}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { mode: 0o700 });
  await writeFile(join(tmp, BUNDLE), packed, { mode: 0o600 });
  await writeFile(join(tmp, SIG), signature, { mode: 0o600 });
  const target = versionDir(root, a);
  await rm(target, { recursive: true, force: true });
  await rename(tmp, target);
  const next = join(root, `.active-${process.pid}.json`);
  await writeFile(next, JSON.stringify(a), { mode: 0o600 });
  await rename(next, activeFile(root));
  for (const id of await readdir(root)) {
    if (id === "active.json") continue;
    if (id !== a.id) await rm(join(root, id), { recursive: true, force: true });
    else for (const v of await readdir(join(root, id))) if (v !== a.version) await rm(join(root, id, v), { recursive: true, force: true });
  }
  return a;
}

/** Writes the checked files into `files/`, replacing what was there. */
export async function extract(root: string, a: Active, files: Map<string, Buffer>): Promise<string> {
  const dir = filesDir(root, a);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [path, data] of files) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) await mkdir(join(dir, path.slice(0, slash)), { recursive: true, mode: 0o700 });
    await writeFile(join(dir, path), data, { mode: 0o600 });
  }
  return dir;
}

/** Deletes the module folder. The module's tables in the database stay. */
export async function removeAll(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
