/**
 * The encrypted copy to another machine (Asetukset > Palvelin), sent over SFTP by the host helper (the `offsite` action).
 *
 * Decision: the household keeps a copy outside this machine that nobody can read without the key. The copy is
 * encrypted on the host with age to a public key before anything leaves; the secret half of that key is made here,
 * shown to the admin once and never stored, so it travels neither with the copy nor with the database. The target, the
 * public key and the SSH key this machine signs in with are sealed in one value under their own context (the SSH key is
 * a secret, the address is private) and rotated with the app secret (secret-rotation.ts). Nothing is sent until an
 * admin has given a target, confirmed they saved the key and turned the copy on, each time with their password.
 */
import type { Language } from "@banking/core";
import { opsText } from "./ops-english.ts";
import { UserError } from "../platform/errors.ts";
import { parseBoolean, parseOffsiteDir, parseOffsiteHost, parseOffsitePort, parseOffsiteUser } from "../platform/validate.ts";
import { AGE_RECIPIENT, isSshKey, newAgeKey, newSshKey, sshPublicLine } from "../security/offsite-keys.ts";
import type { User } from "../db/rows.ts";
import type { Services } from "./context.ts";
import { checkPassword, queueOffsiteOwn, queueRefuses, requestOp, type Req } from "./ops.ts";
import { deleteOffsiteRequest, type OffsiteRequest, sweepOffsiteRequest, writeOffsiteRequest } from "./offsite-request.ts";
import { recordEvent } from "./security.ts";

/** The row: `{ enabled, keyEnc }`. `keyEnc` is the sealed config. */
export const KEY = "instance_offsite";
/** Sealing context: the sealed value opens nowhere else. */
export const AAD = "instance:offsite";

const DAY_KEY = "offsite_day";
/** No successful copy for this long counts as stale on the page. */
const STALE_MS = 3 * 86_400_000;

interface Row {
  enabled: boolean;
  keyEnc: string | null;
}
/** The keys come first (made by `makeKeys`); the target is filled in by `saveOffsite`. */
interface Config {
  sshKey: string;
  recipient: string;
  host?: string;
  port?: number;
  user?: string;
  dir?: string;
}

async function readRow(s: Services): Promise<Row> {
  const raw = await s.settings.get(KEY);
  try {
    const j = raw ? (JSON.parse(raw) as Partial<Row>) : {};
    return { enabled: j.enabled === true, keyEnc: typeof j.keyEnc === "string" ? j.keyEnc : null };
  } catch {
    return { enabled: false, keyEnc: null };
  }
}

async function openConfig(s: Services, row: Row): Promise<Config | null> {
  if (!row.keyEnc) return null;
  const box = await s.secretBox();
  if (!box) return null;
  try {
    const j = JSON.parse(await box.open(row.keyEnc, AAD)) as Partial<Config>;
    return isSshKey(j.sshKey) && typeof j.recipient === "string" && AGE_RECIPIENT.test(j.recipient) ? (j as Config) : null;
  } catch {
    return null;
  }
}

const complete = (c: Config | null): c is Required<Config> => !!c && !!c.host && !!c.port && !!c.user && !!c.dir;
const toRequest = (c: Required<Config>): OffsiteRequest => ({ host: c.host, port: c.port, user: c.user, dir: c.dir, recipient: c.recipient, sshKey: c.sshKey });

async function store(s: Services, enabled: boolean, config: Config | null): Promise<void> {
  let keyEnc: string | null = null;
  if (config) {
    const box = await s.secretBox();
    if (!box) throw UserError.of("offsite.no_secret");
    keyEnc = await box.seal(JSON.stringify(config), AAD);
  }
  await s.settings.set(KEY, JSON.stringify({ enabled, keyEnc } satisfies Row));
}

/** What the last copies say: the newest finished request and whether the newest good one is old. */
async function lastRun(s: Services, language: Language) {
  const finished = (await s.ops.recent(200)).filter((r) => r.action === "offsite" && r.finishedAt && (r.status === "ok" || r.status === "failed"));
  const last = finished[0];
  const good = finished.find((r) => r.status === "ok");
  return {
    last: last ? { ok: last.status === "ok", at: last.finishedAt!, summary: opsText(last.summary ?? "", language) } : null,
    stale: !good || s.now().getTime() - Date.parse(good.finishedAt!) > STALE_MS,
  };
}

/**
 * What the browser may see. The SSH public line and the age public key are public; the SSH private key and the age
 * secret are never returned (the age secret exists only in the answer of `makeKeys`).
 */
export async function offsiteView(s: Services, language: Language = "fi") {
  const row = await readRow(s);
  const config = await openConfig(s, row);
  const run = await lastRun(s, language);
  return {
    enabled: row.enabled && complete(config),
    hasKeys: config !== null,
    unreadable: !!row.keyEnc && config === null,
    configured: complete(config),
    host: config?.host ?? null,
    port: config?.port ?? 22,
    user: config?.user ?? null,
    dir: config?.dir ?? null,
    recipient: config?.recipient ?? null,
    sshPublic: config ? sshPublicLine(config.sshKey) : null,
    last: run.last,
    stale: row.enabled && run.stale,
    secret: { available: !!s.config.appSecret },
  };
}

type Who = { user: User; req: Req };

const event = (s: Services, who: Who, detail: string) => recordEvent(s, { kind: "offsite_changed", userId: who.user.id, ...who.req, detail });

/**
 * New SSH and age keys, for the admin's password. The copy is turned off (the other machine must trust the new SSH key
 * and the old copies keep the old age key) and the target stays. The age secret is in the answer once and nowhere else.
 */
export async function makeKeys(s: Services, who: Who, password: unknown) {
  await checkPassword(s, who.user, typeof password === "string" ? password : "", who.req, "kopion avaimet");
  const old = await openConfig(s, await readRow(s));
  const age = newAgeKey();
  await store(s, false, { ...old, sshKey: newSshKey(), recipient: age.recipient });
  await event(s, who, "avaimet luotu, kopio pois päältä");
  return { ...(await offsiteView(s, who.user.language)), ageSecret: age.secret };
}

/** `{ password, enabled, host, port, user, dir, recipient?, keyConfirmed? }`, already checked for other keys by the route. */
export async function saveOffsite(s: Services, who: Who, o: Partial<Record<"password" | "enabled" | "host" | "port" | "user" | "dir" | "recipient" | "keyConfirmed", unknown>>) {
  await checkPassword(s, who.user, typeof o.password === "string" ? o.password : "", who.req, "kopion kohde");
  const row = await readRow(s);
  const old = await openConfig(s, row);
  if (!old) throw UserError.of("offsite.key_missing");
  const enabled = parseBoolean(o.enabled);
  const next: Config = { sshKey: old.sshKey, recipient: old.recipient, host: parseOffsiteHost(o.host), port: parseOffsitePort(o.port), user: parseOffsiteUser(o.user), dir: parseOffsiteDir(o.dir) };
  // a pasted age key replaces the made one: the household may already keep a key of their own
  if (o.recipient !== undefined && o.recipient !== old.recipient) {
    if (typeof o.recipient !== "string" || !AGE_RECIPIENT.test(o.recipient.trim())) throw UserError.of("offsite.recipient");
    next.recipient = o.recipient.trim();
  }
  if (enabled && o.keyConfirmed !== true && !row.enabled) throw UserError.of("offsite.saved_key_confirm");
  await store(s, enabled, next);
  const changed = [enabled !== row.enabled ? (enabled ? "päälle" : "pois") : null, next.host !== old.host || next.port !== old.port || next.user !== old.user || next.dir !== old.dir ? "kohde" : null, next.recipient !== old.recipient ? "salausavain" : null].filter(Boolean);
  if (changed.length) await event(s, who, changed.join(", "));
  return offsiteView(s, who.user.language);
}

/** Removes the target, the keys and the switch, for the admin's password. Copies already on the other machine stay there. */
export async function removeOffsite(s: Services, who: Who, password: unknown) {
  await checkPassword(s, who.user, typeof password === "string" ? password : "", who.req, "kopion kohteen poisto");
  await s.settings.delete(KEY);
  deleteOffsiteRequest(s);
  await event(s, who, "kohde poistettu");
  return offsiteView(s, who.user.language);
}

/** One copy now, for the admin's password. The request file is written first and removed if the queue refuses. */
export async function runOffsiteNow(s: Services, who: Who, password: unknown) {
  const config = await openConfig(s, await readRow(s));
  if (!config) throw UserError.of("offsite.not_set");
  if (!complete(config)) throw UserError.of("offsite.incomplete");
  await queueRefuses(s, "offsite");
  const proof = await checkPassword(s, who.user, typeof password === "string" ? password : "", who.req, "kopio toiselle koneelle");
  if (!writeOffsiteRequest(s, toRequest(config))) throw UserError.of("offsite.no_folder");
  try {
    return await requestOp(s, who.user, { action: "offsite" }, who.req, proof);
  } catch (err) {
    // another copy may already be waiting for the same file
    await sweepOffsiteRequest(s);
    throw err;
  }
}

/**
 * The hourly tick's call: the first tick of a local day queues that day's copy when the switch is on. The day is
 * claimed only once the request is queued, so a tick that found the helper away tries again. Never throws.
 */
export async function queueOffsiteDaily(s: Services, day: string): Promise<void> {
  try {
    const row = await readRow(s);
    if (!row.enabled || (await s.settings.get(DAY_KEY)) === day) return;
    const config = await openConfig(s, row);
    if (!complete(config)) return;
    const admin = (await s.users.list()).find((u) => u.role === "admin");
    if (!admin) return;
    if (await queueOffsiteOwn(s, admin.id, toRequest(config))) await s.settings.set(DAY_KEY, day);
  } catch (err) {
    console.error("queueing the copy to another machine failed:", (err as Error).name);
  }
}
