/**
 * The Lisäosa card of Asetukset: the add-on code, its check and its removal (docs/MODULES.md).
 *
 * Decision: the owner connects or removes the household's add-on module with one code. The code is sealed under its own
 * context and never returned, logged, put in an event or exported; what the admin sees is the status line. A check
 * never runs a bundle: the next start loads what the check installed, and a start checks before it loads.
 */
import { existsSync } from "node:fs";
import { readSettingRows } from "../db/settings-repo.ts";
import type { User } from "../db/rows.ts";
import { TooManyAttempts, UserError } from "../platform/errors.ts";
import { SecretBox } from "../security/secretbox.ts";
import { checkBundle, BundleRefused, NotForThisVersion } from "../modules/bundle.ts";
import { type ModuleCode, moduleCodeText, parseModuleCode } from "../modules/code.ts";
import { download, FetchFailed, listCandidates } from "../modules/fetch.ts";
import type { StartState } from "../modules/load.ts";
import { compareVersions, parseVersion } from "../modules/semver.ts";
import { install, readActive, removeActive } from "../modules/store.ts";
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
const HOUR_MS = 3_600_000;
/** A start looks for a new release when the last check is older than this. */
const START_CHECK_AGE_MS = HOUR_MS;
/** All the requests of the check before a start together: a slow or failing release service never holds the start longer. */
const START_CHECK_DEADLINE_MS = 20_000;
/** The least time between two checks the admin asks for. */
const MANUAL_CHECK_GAP_MS = 30_000;

type Checked = { state: "installed" | "waiting" | "refused"; id?: string; version?: string; reason?: string; appVersion: string; at: string };

export type ModuleView =
  | { state: "none" }
  | { state: "connected"; id: string; version: string; label?: string; noCode?: true }
  | { state: "pending"; id: string; version: string }
  | { state: "waiting" }
  | { state: "refused"; reason: string }
  | { state: "checking" };

function parseStatus(raw: string | null): Checked | null {
  try {
    const j = raw ? (JSON.parse(raw) as Checked) : null;
    return j && typeof j.state === "string" && typeof j.appVersion === "string" ? j : null;
  } catch {
    return null;
  }
}

const readStatus = async (s: Services): Promise<Checked | null> => parseStatus(await s.settings.get(STATUS_KEY));

async function hasCode(s: Services): Promise<boolean> {
  return (await s.settings.get(KEY)) !== null;
}

async function openCodeFrom(raw: string | null, box: SecretBox | null): Promise<ModuleCode | null> {
  if (!raw || !box) return null;
  try {
    const { keyEnc } = JSON.parse(raw) as { keyEnc?: unknown };
    if (typeof keyEnc !== "string") return null;
    return parseModuleCode(await box.open(keyEnc, AAD));
  } catch {
    return null;
  }
}

const openCode = async (s: Services): Promise<ModuleCode | null> => openCodeFrom(await s.settings.get(KEY), await s.secretBox());

const startState = (s: Services): StartState => s.modules?.start ?? { state: "none" };

function parseFloor(raw: string | null): Record<string, string> {
  try {
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    return Object.fromEntries(Object.entries(j).filter((e): e is [string, string] => typeof e[1] === "string" && parseVersion(e[1]) !== null));
  } catch {
    return {};
  }
}

const readFloor = async (s: Services): Promise<Record<string, string>> => parseFloor(await s.settings.get(FLOOR_KEY));

/** `floor` with `id` raised to `version`, or null when it is not higher. */
function raised(floor: Record<string, string>, id: string, version: string): Record<string, string> | null {
  const now = floor[id];
  if (now && compareVersions(parseVersion(version)!, parseVersion(now)!) <= 0) return null;
  return { ...floor, [id]: version };
}

/** Raises the floor of `id` to `version`, never lowers it. */
async function raiseFloor(s: Services, id: string, version: string): Promise<void> {
  const next = raised(await readFloor(s), id, version);
  if (next) await s.settings.set(FLOOR_KEY, JSON.stringify(next));
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
 * Where one check reads its facts and puts its outcome: the services, or memory before the database opens
 * (checkModuleBeforeStart), when the module is not loaded yet and nothing may be written.
 */
interface CheckEnv {
  appVersion: string;
  now: Date;
  root: string | undefined;
  signersFile: string | null;
  fetch: typeof fetch;
  code: ModuleCode | null;
  start: StartState;
  /** Before the database opens a check that fails leaves the status of an installed module as it is: the check after the start looks again. */
  beforeStart: boolean;
  floor(): Promise<Record<string, string>>;
  raiseFloor(id: string, version: string): Promise<void>;
  writeStatus(status: Checked): Promise<void>;
  event(kind: "module_installed" | "module_refused", detail: string): Promise<void>;
}

async function servicesEnv(s: Services, userId: string | null): Promise<CheckEnv> {
  return {
    appVersion: s.build.version,
    now: s.now(),
    root: s.modules?.root,
    signersFile: s.modules?.signersFile ?? null,
    fetch: s.fetch ?? fetch,
    code: await openCode(s),
    start: startState(s),
    beforeStart: false,
    floor: () => readFloor(s),
    raiseFloor: (id, version) => raiseFloor(s, id, version),
    writeStatus: (status) => s.settings.set(STATUS_KEY, JSON.stringify(status)),
    event: (kind, detail) => recordEvent(s, { kind, userId, detail }),
  };
}

/**
 * Fetches the newest release that fits this version and installs it. One check at a time; the result is the status row.
 * Every failure is a status, never an exception, so a failing release service ends nothing else.
 */
function checkForModule(s: Services, userId: string | null): Promise<void> {
  running ??= servicesEnv(s, userId)
    .then(runCheck)
    .finally(() => {
      running = null;
    });
  return running;
}

async function runCheck(env: CheckEnv): Promise<void> {
  const { appVersion, root, code, start } = env;
  const write = (c: Omit<Checked, "appVersion" | "at">) => env.writeStatus({ ...c, appVersion, at: env.now.toISOString() });
  if (!code || !root) {
    await write({ state: "refused", reason: root ? "the code cannot be opened with this app secret" : "this install keeps no module folder" });
    return;
  }
  let reason = "no release carries a module";
  let waiting = false;
  // an install from before the floor existed brings its version in
  const installedBefore = readActive(root);
  if (installedBefore) await env.raiseFloor(installedBefore.id, installedBefore.version);
  const floor = await env.floor();
  try {
    const candidates = await listCandidates(env.fetch, code);
    for (const c of candidates) {
      const active = readActive(root);
      // an older signed release stays valid forever, so a release list that lost its newer ones must not bring it back.
      // Older is taken only when the installed one waits for another app version (an app rolled back)
      if (active && start.state !== "waiting" && compareVersions(parseVersion(c.version)!, parseVersion(active.version)!) < 0) {
        reason = "the release is older than the installed module";
        continue;
      }
      try {
        const { packed, signature } = await download(env.fetch, code, c);
        const checked = await checkBundle(packed, signature, { signersFile: env.signersFile, appVersion, version: c.version });
        const lowest = floor[checked.manifest.id];
        if (lowest && start.state !== "waiting" && compareVersions(parseVersion(checked.manifest.version)!, parseVersion(lowest)!) < 0) {
          reason = "the release is older than a version this install has had";
          continue;
        }
        if (active && active.id === checked.manifest.id && active.version === checked.manifest.version) {
          await write({ state: "installed", ...active });
          return;
        }
        const installed = await install(root, checked, packed, signature);
        await env.raiseFloor(installed.id, installed.version);
        await write({ state: "installed", ...installed });
        await env.event("module_installed", `${installed.id} ${installed.version}`);
        return;
      } catch (err) {
        if (err instanceof NotForThisVersion) {
          waiting = true;
          continue;
        }
        if (err instanceof BundleRefused || err instanceof FetchFailed) {
          reason = err.message;
          await env.event("module_refused", `${c.version}: ${err.message}`);
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
  if (active && (env.beforeStart || start.state === "connected")) return;
  await write(waiting ? { state: "waiting" } : { state: "refused", reason });
}

/** What the check before the start found, kept until the database is open (flushStartCheck). */
interface StartOutcome {
  status: Checked | null;
  floors: [id: string, version: string][];
  events: { kind: "module_installed" | "module_refused"; detail: string }[];
}
let startOutcome: StartOutcome | null = null;


/**
 * The check before the start (entry/node.ts), ahead of the load of the installed module: with a code and a last check
 * older than an hour, a new release is installed in time for this very start to load it. The database is only read; what
 * the check found is written once it is open. Every request shares one deadline, and every failure ends here, so a
 * slow or failing release service never holds or stops the start.
 */
export async function checkModuleBeforeStart(o: {
  dbPath: string;
  appSecret: string | null;
  root: string;
  signersFile: string | null;
  appVersion: string;
  fetch?: typeof fetch;
  now?: () => Date;
  deadlineMs?: number;
}): Promise<void> {
  try {
    if (!o.appSecret || !existsSync(o.dbPath)) return;
    const rows = readSettingRows(o.dbPath, [KEY, STATUS_KEY, FLOOR_KEY]);
    const raw = rows.get(KEY) ?? null;
    if (!raw) return;
    const now = (o.now ?? (() => new Date()))();
    const status = parseStatus(rows.get(STATUS_KEY) ?? null);
    if (status && status.appVersion === o.appVersion && now.getTime() - Date.parse(status.at) < START_CHECK_AGE_MS) return;
    const code = await openCodeFrom(raw, await SecretBox.fromSecret(o.appSecret));
    if (!code) return;
    const deadline = AbortSignal.timeout(o.deadlineMs ?? START_CHECK_DEADLINE_MS);
    const base = o.fetch ?? fetch;
    const bounded = ((input, init) => base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline })) as typeof fetch;
    const outcome: StartOutcome = { status: null, floors: [], events: [] };
    let floor = parseFloor(rows.get(FLOOR_KEY) ?? null);
    await runCheck({
      appVersion: o.appVersion,
      now,
      root: o.root,
      signersFile: o.signersFile,
      fetch: bounded,
      code,
      start: { state: "none" },
      beforeStart: true,
      floor: async () => floor,
      raiseFloor: async (id, version) => {
        const next = raised(floor, id, version);
        if (!next) return;
        floor = next;
        outcome.floors.push([id, version]);
      },
      writeStatus: async (c) => {
        outcome.status = c;
      },
      event: async (kind, detail) => {
        outcome.events.push({ kind, detail });
      },
    });
    startOutcome = outcome;
  } catch (err) {
    console.error("add-on module check before the start failed:", (err as Error).name);
  }
}

/** Writes down what the check before the start found, now that the database is open. */
async function flushStartCheck(s: Services): Promise<void> {
  const outcome = startOutcome;
  startOutcome = null;
  if (!outcome) return;
  for (const [id, version] of outcome.floors) await raiseFloor(s, id, version);
  if (outcome.status) await s.settings.set(STATUS_KEY, JSON.stringify(outcome.status));
  for (const e of outcome.events) await recordEvent(s, { kind: e.kind, userId: null, detail: e.detail });
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
 * Removes the code and the module's install record, for the admin's password. Its tables and the version floor stay.
 * The files stay until the next start deletes them: the running process serves the module's web files from them.
 * A running module keeps running until then.
 */
export async function removeModuleCode(s: Services, user: User, o: { password?: unknown }, req: Req): Promise<ModuleView> {
  await checkPassword(s, user, typeof o.password === "string" ? o.password : "", req, "lisäosan poisto");
  await s.settings.delete(KEY);
  await s.settings.delete(STATUS_KEY);
  if (s.modules?.root) await removeActive(s.modules.root);
  await recordEvent(s, { kind: "module_code_removed", userId: user.id, ip: req.ip, userAgent: req.userAgent ?? null });
  return moduleView(s);
}

/**
 * The check after a start on a new app version, and once a day: only with a code, and never while one runs. A module
 * that the start refused for this version is looked for again at once. What the check before the start found is written
 * first, and counts as the last check.
 */
export async function recheckModule(s: Services): Promise<void> {
  await flushStartCheck(s);
  if (!(await hasCode(s))) return;
  const status = await readStatus(s);
  const due = !status || status.appVersion !== s.build.version || s.now().getTime() - Date.parse(status.at) >= DAY_MS || startState(s).state === "waiting";
  if (due) await checkForModule(s, null);
}

/** The version the last check installed and whether this process still has to be restarted to run it; null when it installed none. */
export type CheckedModule = { version: string; restart: boolean } | null;

const lastManualCheck = new WeakMap<Services, number>();

/**
 * The admin's check, at once and with no password: it only looks for a signed release and puts it on the disk, as the daily
 * check does. One every half minute. The answer says which version is installed and whether a restart brings it in.
 */
export async function checkModuleNow(s: Services, user: User): Promise<{ view: ModuleView; checked: CheckedModule }> {
  if (!(await hasCode(s))) throw new UserError("Lisäosan koodia ei ole tallennettu.");
  const nowMs = s.now().getTime();
  const last = lastManualCheck.get(s);
  if (last !== undefined && nowMs >= last && nowMs - last < MANUAL_CHECK_GAP_MS) throw new TooManyAttempts("Odota hetki ennen seuraavaa tarkistusta.", Math.ceil((MANUAL_CHECK_GAP_MS - (nowMs - last)) / 1000));
  lastManualCheck.set(s, nowMs);
  const before = await readStatus(s);
  await checkForModule(s, user.id);
  const status = await readStatus(s);
  const start = startState(s);
  // a check that failed leaves the status of an installed module as it was, and then it found nothing (the time alone cannot tell, a clock that has not moved writes the same one)
  const checked: CheckedModule =
    status?.state === "installed" && status.id && status.version && (status.at !== before?.at || status.version !== before.version) ? { version: status.version, restart: !(start.state === "connected" && start.id === status.id && start.version === status.version) } : null;
  return { view: await moduleView(s), checked };
}
