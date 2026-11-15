/**
 * The Lisäosa card of Asetukset: the add-on code, its check and its removal (docs/MODULES.md).
 *
 * Decision: the owner connects or removes the household's add-on module with one code. The code is sealed under its own
 * context and never returned, logged, put in an event or exported; what the admin sees is the status line. A check
 * never runs a bundle: the next start loads what the check installed.
 */
import type { User } from "../db/rows.ts";
import { UserError } from "../platform/errors.ts";
import { checkBundle, BundleRefused, NotForThisVersion } from "../modules/bundle.ts";
import { type ModuleCode, moduleCodeText, parseModuleCode } from "../modules/code.ts";
import { download, FetchFailed, listCandidates } from "../modules/fetch.ts";
import type { StartState } from "../modules/load.ts";
import { compareVersions, parseVersion } from "../modules/semver.ts";
import { install, readActive, removeAll } from "../modules/store.ts";
import type { Services } from "./context.ts";
import { checkPassword, type Req } from "./ops.ts";
import { recordEvent } from "./security.ts";

/** `{ keyEnc }`: the sealed code. */
export const KEY = "instance_module";
export const AAD = "instance:module";
/** What the last check found: `{ state, id?, version?, reason?, appVersion, at }`. Holds no part of the code. */
const STATUS_KEY = "module_status";
/**
 * `{ [id]: version }`: the highest version of each module this install has installed. An older signed release stays
 * valid forever, so the floor outlives the removal of the code and its folder: a new code cannot bring an old bundle back.
 */
const FLOOR_KEY = "module_floor";
const DAY_MS = 86_400_000;

type Checked = { state: "installed" | "waiting" | "refused"; id?: string; version?: string; reason?: string; appVersion: string; at: string };

export type ModuleView =
  | { state: "none" }
  | { state: "connected"; id: string; version: string; label?: string; noCode?: true }
  | { state: "pending"; id: string; version: string }
  | { state: "waiting" }
  | { state: "refused"; reason: string }
  | { state: "checking" };

async function readStatus(s: Services): Promise<Checked | null> {
  const raw = await s.settings.get(STATUS_KEY);
  try {
    const j = raw ? (JSON.parse(raw) as Checked) : null;
    return j && typeof j.state === "string" && typeof j.appVersion === "string" ? j : null;
  } catch {
    return null;
  }
}

async function hasCode(s: Services): Promise<boolean> {
  return (await s.settings.get(KEY)) !== null;
}

async function openCode(s: Services): Promise<ModuleCode | null> {
  const raw = await s.settings.get(KEY);
  if (!raw) return null;
  const box = await s.secretBox();
  if (!box) return null;
  try {
    const { keyEnc } = JSON.parse(raw) as { keyEnc?: unknown };
    if (typeof keyEnc !== "string") return null;
    return parseModuleCode(await box.open(keyEnc, AAD));
  } catch {
    return null;
  }
}

const startState = (s: Services): StartState => s.modules?.start ?? { state: "none" };

async function readFloor(s: Services): Promise<Record<string, string>> {
  const raw = await s.settings.get(FLOOR_KEY);
  try {
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    return Object.fromEntries(Object.entries(j).filter((e): e is [string, string] => typeof e[1] === "string" && parseVersion(e[1]) !== null));
  } catch {
    return {};
  }
}

/** Raises the floor of `id` to `version`, never lowers it. */
async function raiseFloor(s: Services, id: string, version: string): Promise<void> {
  const floor = await readFloor(s);
  const now = floor[id];
  if (now && compareVersions(parseVersion(version)!, parseVersion(now)!) <= 0) return;
  await s.settings.set(FLOOR_KEY, JSON.stringify({ ...floor, [id]: version }));
}

/**
 * The status line's facts. No code: nothing, unless a module runs anyway. The start loads what `active.json` names
 * before the database opens, so a module whose files were put in place by hand, or whose code the database lost (one
 * restored from before the code), runs with no code; the line says so, as no check looks for its next release.
 */
export async function moduleView(s: Services): Promise<ModuleView> {
  const start = startState(s);
  const root = s.modules?.root;
  const active = root ? readActive(root) : null;
  const running = start.state === "connected" && active && active.id === start.id && active.version === start.version ? start : null;
  if (!(await hasCode(s))) return running ? { state: "connected", id: running.id, version: running.version, label: running.label, noCode: true } : { state: "none" };
  const status = await readStatus(s);
  if (running) return { state: "connected", id: running.id, version: running.version, label: running.label };
  if (active && (start.state === "none" || start.state === "connected")) return { state: "pending", ...active };
  if (start.state === "refused" && active && active.version === start.version) return { state: "refused", reason: start.reason };
  if (status?.state === "waiting" || start.state === "waiting") return { state: "waiting" };
  if (status?.state === "refused") return { state: "refused", reason: status.reason ?? "" };
  if (active) return { state: "pending", ...active };
  return { state: "checking" };
}

let running: Promise<void> | null = null;

/**
 * Fetches the newest release that fits this version and installs it. One check at a time; the result is the status row.
 * Every failure is a status, never an exception, so a failing release service ends nothing else.
 */
function checkForModule(s: Services, userId: string | null): Promise<void> {
  running ??= runCheck(s, userId).finally(() => {
    running = null;
  });
  return running;
}

async function runCheck(s: Services, userId: string | null): Promise<void> {
  const appVersion = s.build.version;
  const at = s.now().toISOString();
  const write = (c: Omit<Checked, "appVersion" | "at">) => s.settings.set(STATUS_KEY, JSON.stringify({ ...c, appVersion, at } satisfies Checked));
  const root = s.modules?.root;
  const code = await openCode(s);
  if (!code || !root) {
    await write({ state: "refused", reason: root ? "the code cannot be opened with this app secret" : "this install keeps no module folder" });
    return;
  }
  const fetchImpl = s.fetch ?? fetch;
  let reason = "no release carries a module";
  let waiting = false;
  // an install from before the floor existed brings its version in
  const installedBefore = readActive(root);
  if (installedBefore) await raiseFloor(s, installedBefore.id, installedBefore.version);
  const floor = await readFloor(s);
  try {
    const candidates = await listCandidates(fetchImpl, code);
    for (const c of candidates) {
      const active = readActive(root);
      // an older signed release stays valid forever, so a release list that lost its newer ones must not bring it back.
      // Older is taken only when the installed one waits for another app version (an app rolled back)
      if (active && startState(s).state !== "waiting" && compareVersions(parseVersion(c.version)!, parseVersion(active.version)!) < 0) {
        reason = "the release is older than the installed module";
        continue;
      }
      try {
        const { packed, signature } = await download(fetchImpl, code, c);
        const checked = await checkBundle(packed, signature, { signersFile: s.modules?.signersFile ?? null, appVersion, version: c.version });
        const lowest = floor[checked.manifest.id];
        if (lowest && startState(s).state !== "waiting" && compareVersions(parseVersion(checked.manifest.version)!, parseVersion(lowest)!) < 0) {
          reason = "the release is older than a version this install has had";
          continue;
        }
        if (active && active.id === checked.manifest.id && active.version === checked.manifest.version) {
          await write({ state: "installed", ...active });
          return;
        }
        const installed = await install(root, checked, packed, signature);
        await raiseFloor(s, installed.id, installed.version);
        await write({ state: "installed", ...installed });
        await recordEvent(s, { kind: "module_installed", userId, detail: `${installed.id} ${installed.version}` });
        return;
      } catch (err) {
        if (err instanceof NotForThisVersion) {
          waiting = true;
          continue;
        }
        if (err instanceof BundleRefused || err instanceof FetchFailed) {
          reason = err.message;
          await recordEvent(s, { kind: "module_refused", userId, detail: `${c.version}: ${err.message}` });
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    reason = err instanceof FetchFailed ? err.message : "the check failed";
    if (!(err instanceof FetchFailed)) console.error("add-on module check failed:", (err as Error).name);
  }
  // a module that is installed and still fits stays: a release service that does not answer removes nothing
  const active = readActive(root);
  if (active && startState(s).state === "connected") return;
  await write(waiting ? { state: "waiting" } : { state: "refused", reason });
}

/** Saves the code, for the admin's password, and checks for a module at once. */
export async function setModuleCode(s: Services, user: User, o: { code?: unknown; password?: unknown }, req: Req): Promise<ModuleView> {
  await checkPassword(s, user, typeof o.password === "string" ? o.password : "", req, "lisäosan koodi");
  const code = parseModuleCode(o.code);
  const box = await s.secretBox();
  if (!box) throw new UserError("Palvelimen salausavain puuttuu. Ylläpitäjä löytää syyn palvelimen lokista.");
  // sealed in its own form, read back through parseModuleCode
  await s.settings.set(KEY, JSON.stringify({ keyEnc: await box.seal(moduleCodeText(code), AAD) }));
  await s.settings.delete(STATUS_KEY);
  await recordEvent(s, { kind: "module_code_set", userId: user.id, ip: req.ip, userAgent: req.userAgent ?? null });
  await checkForModule(s, user.id);
  return moduleView(s);
}

/**
 * Removes the code and the module's files, for the admin's password. Its tables and the version floor stay; the running
 * process keeps it until a restart.
 */
export async function removeModuleCode(s: Services, user: User, o: { password?: unknown }, req: Req): Promise<ModuleView> {
  await checkPassword(s, user, typeof o.password === "string" ? o.password : "", req, "lisäosan poisto");
  await s.settings.delete(KEY);
  await s.settings.delete(STATUS_KEY);
  if (s.modules?.root) await removeAll(s.modules.root);
  await recordEvent(s, { kind: "module_code_removed", userId: user.id, ip: req.ip, userAgent: req.userAgent ?? null });
  return moduleView(s);
}

/**
 * The check after a start on a new app version, and once a day: only with a code, and never while one runs. A module
 * that the start refused for this version is looked for again at once.
 */
export async function recheckModule(s: Services): Promise<void> {
  if (!(await hasCode(s))) return;
  const status = await readStatus(s);
  const due = !status || status.appVersion !== s.build.version || s.now().getTime() - Date.parse(status.at) >= DAY_MS || startState(s).state === "waiting";
  if (due) await checkForModule(s, null);
}
