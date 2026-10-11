/**
 * Web maintenance (Asetukset > Ylläpito). The app never runs anything. An admin's request becomes a
 * row in ops_requests; a helper on the host polls the rows through the `ops` CLI (cli-ops.ts), runs fixed
 * scripts and reports back. Every attempt is written to security_events with an ops_ kind.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { quickFileCheck, verifyDatabaseFile } from "../db/backup-check.ts";
import { atOrAbove } from "../db/migrate.ts";
import type { OpsRequest } from "../db/ops-repo.ts";
import type { User } from "../db/rows.ts";
import { verifyPassword } from "../security/password.ts";
import type { Services } from "./context.ts";
import { HttpUserError, TooManyAttempts, tooManyMessage, UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import {
  HELPER_MIN_VERSION,
  helperHasTools,
  helperKnows,
  helperOutdated,
  helperStatus,
  mergeState,
  NEEDS_PASSWORD,
  normaliseState,
  OPS_ACTIONS,
  type OpsAction,
  type OpsState,
  oneLine,
  parseOpsRequest,
  parseSteps,
  READ_ONLY,
  REQUEST_EXPIRY_MS,
  ROLLBACK_WORD,
  RUNNING_TIMEOUT_MS,
  LOGS_MAX_BYTES,
  LOGS_MAX_LINES,
  sanitiseOutput,
  scrub,
  validOpsId,
  XYZ,
} from "./ops-validate.ts";
import { recordEvent } from "./security.ts";

const SEEN_KEY = "ops_helper_seen";
const VERSION_KEY = "ops_helper_version";
const STATE_KEY = "ops_state";

export const ACTION_LABEL: Record<OpsAction, string> = {
  update: "päivitys",
  rollback: "edellisen version palautus",
  backup: "varmuuskopio",
  restart: "uudelleenkäynnistys",
  doctor: "järjestelmän tarkistus",
  "check-update": "päivitysten tarkistus",
  logs: "lokien luku",
  prune: "levyn siivous",
  "helper-renew": "apurin uusinta",
};

/** These also reach the other admins as a notice. */
const NOTIFY: readonly OpsAction[] = ["update", "rollback", "restart"];

export const ENABLE_COMMAND = "./scripts/install.sh --ops-helper";
const MUTATING_PER_MINUTE_MS = 60_000;
const PER_HOUR = 20;

interface Req {
  ip: string | null;
  userAgent: string | null | undefined;
}

const secretsOf = (s: Services): string[] => (s.config.appSecret ? [s.config.appSecret] : []);

// ── state ────────────────────────────────────────────────

async function loadSnapshot(s: Services): Promise<OpsState> {
  const raw = await s.settings.get(STATE_KEY);
  if (!raw) return {};
  try {
    return normaliseState(JSON.parse(raw), secretsOf(s));
  } catch {
    return {};
  }
}

async function touchHelper(s: Services, version: string | undefined): Promise<void> {
  await s.settings.set(SEEN_KEY, s.now().toISOString());
  if (version && /^[0-9A-Za-z._-]{1,20}$/.test(version)) await s.settings.set(VERSION_KEY, version);
}

async function storeState(s: Services, input: unknown): Promise<void> {
  const next = normaliseState(input, secretsOf(s));
  if (!Object.keys(next).length) return;
  await s.settings.set(STATE_KEY, JSON.stringify(mergeState(await loadSnapshot(s), next)));
}

export async function helperInfo(s: Services) {
  const seenAt = await s.settings.get(SEEN_KEY);
  const version = await s.settings.get(VERSION_KEY);
  const { status, reason } = helperStatus(seenAt, s.now());
  return { status, reason, seenAt, version, outdated: status !== "off" && helperOutdated(version), tools: helperHasTools(version), minVersion: HELPER_MIN_VERSION, enableCommand: ENABLE_COMMAND };
}

// ── backups kept by the app ──────────────────────────────

const BACKUP_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.db$/;

interface AppBackup {
  name: string;
  size: number;
  at: string;
  kind: "daily" | "pre-update" | "manual";
}

/**
 * The database copies in <data>/backups, newest first. Regular files only; an empty, cut-short or
 * non-database file is left out (the copy code removes those, this covers one left by a killed process).
 */
export function listAppBackups(s: Services): AppBackup[] {
  if (!s.backupDir) return [];
  let names: string[];
  try {
    names = readdirSync(s.backupDir);
  } catch {
    return [];
  }
  const out: (AppBackup & { t: number })[] = [];
  for (const name of names) {
    if (!BACKUP_FILE.test(name)) continue;
    try {
      const st = lstatSync(join(s.backupDir, name));
      if (!st.isFile()) continue;
      if (quickFileCheck(join(s.backupDir, name)) !== null) continue;
      out.push({ name, size: st.size, at: st.mtime.toISOString(), kind: name.startsWith("auto-") ? "daily" : name.startsWith("pre-update-") ? "pre-update" : "manual", t: st.mtimeMs });
    } catch {
      // removed meanwhile
    }
  }
  return out.sort((a, b) => b.t - a.t).slice(0, 30).map(({ t: _t, ...b }) => b);
}

// ── what the page shows ──────────────────────────────────

const view = (r: OpsRequest) => ({
  id: r.id,
  action: r.action,
  label: (ACTION_LABEL as Record<string, string>)[r.action] ?? r.action,
  status: r.status,
  by: r.requestedByName,
  requestedAt: r.requestedAt,
  finishedAt: r.finishedAt,
  exitCode: r.exitCode,
  summary: r.summary,
  output: r.output,
  steps: r.steps ? (JSON.parse(r.steps) as unknown) : [],
});

/**
 * A helper that checked before an update and has not checked since still says "available" for the version that now
 * runs. Its latest_version tells: when that is not newer than the running version there is nothing to offer.
 * Compared only when both read as X.Y.Z; otherwise the stored answer stands.
 */
function withoutStaleOffer(snapshot: OpsState, running: string): OpsState {
  const latest = snapshot.latest_version;
  if (latest === undefined || !XYZ.test(latest) || !XYZ.test(running) || !atOrAbove(running, latest)) return snapshot;
  return { ...snapshot, update_available: false };
}

export async function opsState(s: Services) {
  await expireStale(s);
  const [helper, snapshot, requests] = await Promise.all([helperInfo(s), loadSnapshot(s), s.ops.recent(8)]);
  return {
    version: s.build.version,
    build: s.build.id,
    helper,
    state: withoutStaleOffer(snapshot, s.build.version),
    appBackups: listAppBackups(s),
    requests: requests.map(view),
    /** Something is queued or running: the page polls faster and disables the buttons. */
    active: requests.some((r) => (r.status === "queued" || r.status === "running") && !READ_ONLY.includes(r.action as OpsAction)),
    readOnlyActive: requests.some((r) => (r.status === "queued" || r.status === "running") && READ_ONLY.includes(r.action as OpsAction)),
    now: s.now().toISOString(),
  };
}

/** The audit list: who asked for what and how it ended. Newest first. */
export async function opsAudit(s: Services) {
  const events = await s.security.list({ kindPrefix: "ops_", limit: 150 });
  return events
    .filter((e) => e.kind !== "ops_notice")
    .slice(0, 50)
    .map((e) => {
      const [action = "", ...rest] = (e.detail ?? "").split(": ");
      const outcome = rest.join(": ");
      return { id: e.id, at: e.at, username: e.username, ip: e.ip, action, outcome: e.kind === "ops_denied" ? `kielletty, ${outcome}` : outcome };
    });
}

// ── requests from the browser ────────────────────────────

async function checkPassword(s: Services, user: User, password: string, req: Req, what: string): Promise<void> {
  const key = `ops:${user.id}`;
  const deny = async () => {
    await recordEvent(s, { kind: "ops_denied", userId: user.id, ...req, detail: `${what}: salasana` });
    throw new HttpUserError("Salasana ei täsmää.", 403);
  };
  if (!password) return deny();
  const attempt = s.opsLimiter.consume(key);
  if (attempt.wait) {
    if (attempt.first) await recordEvent(s, { kind: "lockout", userId: user.id, ...req, detail: "ylläpito" });
    throw new TooManyAttempts(tooManyMessage(attempt.wait), attempt.wait);
  }
  if (!s.hashGate.tryEnter()) {
    s.opsLimiter.release(key);
    throw new TooManyAttempts("Palvelin on kiireinen. Yritä hetken päästä uudelleen.", 2);
  }
  let ok = false;
  try {
    const record = await s.users.findForLogin(user.username);
    ok = !!record && (await verifyPassword(password, record.passwordHash));
  } finally {
    s.hashGate.leave();
  }
  if (!ok) return deny();
  s.opsLimiter.reset(key);
}

export async function requestOp(s: Services, user: User, raw: unknown, req: Req) {
  const input = parseOpsRequest(raw);
  const { action } = input;
  const label = ACTION_LABEL[action];
  const deny = async (why: string) => void (await recordEvent(s, { kind: "ops_denied", userId: user.id, ...req, detail: `${label}: ${why}` }));
  await expireStale(s);

  if ((await helperInfo(s)).status === "off") {
    await deny("apuri ei käytössä");
    throw new HttpUserError("Ylläpitoapuri ei ole käytössä.", 409);
  }
  if (!helperKnows(await s.settings.get(VERSION_KEY), action)) {
    // an older helper would not answer an action it does not know, and the request would sit claimed until it times out
    await deny("apuri vanhentunut");
    throw new HttpUserError(`Ylläpitoapurista on uudempi versio. Päivitä se palvelimella: ${ENABLE_COMMAND}`, 409);
  }
  if (action === "rollback") {
    if (input.confirm !== ROLLBACK_WORD) {
      await deny("vahvistus");
      throw new UserError(`Kirjoita ${ROLLBACK_WORD} vahvistukseksi.`);
    }
    if (!(await loadSnapshot(s)).can_rollback) {
      await deny("ei palautettavaa");
      throw new UserError("Edellistä versiota ei ole tallessa.");
    }
  }
  if (NEEDS_PASSWORD.includes(action)) await checkPassword(s, user, input.password, req, label);

  const mutating = !READ_ONLY.includes(action);
  const now = s.now();
  if (mutating && (await s.ops.hasActiveMutating(READ_ONLY))) {
    await deny("toinen kesken");
    throw new HttpUserError("Toinen toiminto on kesken.", 409);
  }
  if (mutating && (await s.ops.countSince(new Date(now.getTime() - MUTATING_PER_MINUTE_MS).toISOString(), READ_ONLY)) > 0) {
    await deny("liian tiheään");
    throw new TooManyAttempts("Odota hetki ennen seuraavaa toimintoa.", 60);
  }
  if ((await s.ops.countSince(new Date(now.getTime() - 3600_000).toISOString())) >= PER_HOUR) {
    await deny("tuntiraja");
    throw new TooManyAttempts("Liian monta pyyntöä tunnissa. Yritä myöhemmin.", 3600);
  }

  const id = `op_${randomBytes(8).toString("hex")}`;
  if (!(await s.ops.insert({ id, action, requestedBy: user.id, at: now.toISOString() }))) {
    await deny("toinen kesken");
    throw new HttpUserError("Toinen toiminto on kesken.", 409);
  }
  await recordEvent(s, { kind: "ops_request", userId: user.id, ...req, detail: `${label}: jonossa` });
  if (NOTIFY.includes(action)) await notifyAdmins(s, user, `${user.displayName} käynnisti toiminnon: ${label}`);
  return view((await s.ops.get(id))!);
}

/** Every other admin sees a one-time notice (services/security.ts renders it). */
async function notifyAdmins(s: Services, actor: User, detail: string): Promise<void> {
  for (const u of await s.users.list()) {
    if (u.role === "admin" && u.id !== actor.id) await recordEvent(s, { kind: "ops_notice", userId: u.id, detail, notify: true });
  }
}

export async function cancelOp(s: Services, user: User, id: string, req: Req) {
  if (!validOpsId(id)) throw new UserError("Pyyntöä ei löydy.");
  const row = await s.ops.get(id);
  if (!row) throw new UserError("Pyyntöä ei löydy.");
  if (!(await s.ops.cancelQueued(id, s.now().toISOString()))) throw new UserError("Pyyntöä ei voi enää perua.");
  await recordEvent(s, { kind: "ops_request", userId: user.id, ...req, detail: `${(ACTION_LABEL as Record<string, string>)[row.action] ?? row.action}: peruttu` });
}

/** The newest database copy, after the password. Returns the file to stream. */
export async function backupForDownload(s: Services, user: User, password: string, req: Req): Promise<{ stream: ReturnType<typeof createReadStream>; name: string; size: number }> {
  const key = `dl:${user.id}`;
  const attempt = s.opsDownloadLimiter.consume(key);
  if (attempt.wait) throw new TooManyAttempts("Liian monta latausta tunnissa. Yritä myöhemmin.", attempt.wait);
  await checkPassword(s, user, password, req, "varmuuskopion lataus");
  const copies = listAppBackups(s);
  if (!copies.length || !s.backupDir) throw new UserError("Varmuuskopiota ei ole vielä. Ota ensin varmuuskopio.");
  // the full check runs on the file that is about to leave the machine; a broken newest copy is skipped
  const newest = copies.find((b) => {
    const check = verifyDatabaseFile(join(s.backupDir!, b.name));
    if (!check.ok) console.error(`backup download: ${b.name} failed its check and is skipped: ${check.reason}`);
    return check.ok;
  });
  if (!newest) throw new UserError("Varmuuskopiot eivät läpäisseet tarkistusta. Ota uusi varmuuskopio.");
  await recordEvent(s, { kind: "ops_download", userId: user.id, ...req, detail: `varmuuskopion lataus: ladattu (${newest.name})`, notify: false });
  await notifyAdmins(s, user, `${user.displayName} latasi tietokannan varmuuskopion`);
  return { stream: createReadStream(join(s.backupDir, newest.name)), name: newest.name, size: newest.size };
}

// ── expiry (hourly tick, ops poll and every state read) ──

export async function expireStale(s: Services): Promise<void> {
  const now = s.now();
  for (const r of await s.ops.queuedBefore(new Date(now.getTime() - REQUEST_EXPIRY_MS).toISOString())) {
    if (await s.ops.finish(r.id, { status: "expired", at: now.toISOString(), summary: "Apuri ei ottanut pyyntöä vastaan." })) await resultEvent(s, r, "vanhentui");
  }
  for (const r of await s.ops.runningBefore(new Date(now.getTime() - RUNNING_TIMEOUT_MS).toISOString())) {
    if (await s.ops.finish(r.id, { status: "failed", at: now.toISOString(), summary: "Ei vastausta." })) await resultEvent(s, r, "epäonnistui");
  }
  await s.ops.prune(200);
}

async function resultEvent(s: Services, r: OpsRequest, outcome: string): Promise<void> {
  await recordEvent(s, { kind: "ops_result", userId: r.requestedBy, detail: `${(ACTION_LABEL as Record<string, string>)[r.action] ?? r.action}: ${outcome}` });
}

// ── the helper's side (cli-ops.ts) ───────────────────────

export interface PolledRequest {
  id: string;
  action: OpsAction;
  params: Record<string, never>;
  secret: null;
}

export async function pollOps(s: Services, opts: { helper?: string; done: string[] }): Promise<PolledRequest | null> {
  await touchHelper(s, opts.helper);
  await expireStale(s);
  const done = opts.done.filter(validOpsId).slice(0, 100);
  // a restored database brings back rows the host already handled: they must not run again
  for (const r of await s.ops.queuedIn(done)) {
    if (await s.ops.finish(r.id, { status: "failed", at: s.now().toISOString(), summary: "Pyyntö oli jo käsitelty." })) await resultEvent(s, r, "epäonnistui");
  }
  for (;;) {
    const r = await s.ops.oldestQueued(done);
    if (!r) return null;
    // the table also accepts access and port, and a row could be written by anything with file access
    if (!validOpsId(r.id) || !(OPS_ACTIONS as readonly string[]).includes(r.action) || r.params !== "{}") {
      if (await s.ops.finish(r.id, { status: "failed", at: s.now().toISOString(), summary: "Virheellinen pyyntö." })) await resultEvent(s, r, "epäonnistui");
      continue;
    }
    // The polling helper is older than the action: a request queued for a newer helper that was then rolled back. It
    // would not answer, so the row ends here and the one mutating slot stays free.
    if (!helperKnows(opts.helper, r.action as OpsAction)) {
      if (await s.ops.finish(r.id, { status: "failed", at: s.now().toISOString(), summary: "Apuri ei tue tätä toimintoa." })) await resultEvent(s, r, "epäonnistui");
      continue;
    }
    if (await s.ops.claim(r.id, s.now().toISOString())) return { id: r.id, action: r.action as OpsAction, params: {}, secret: null };
  }
}

/** `{id, status, exit_code, summary, output, state}`. A repeated report is a no-op. */
export async function reportOps(s: Services, payload: unknown, helper?: string): Promise<void> {
  const o = strictObject(payload, ["id", "status", "exit_code", "summary", "output", "state"] as const);
  if (!validOpsId(o.id)) throw new UserError("Virheellinen pyynnön tunnus.");
  if (o.status !== "ok" && o.status !== "failed") throw new UserError("Virheellinen tila.");
  if (o.exit_code != null && !Number.isInteger(o.exit_code)) throw new UserError("Virheellinen poistumiskoodi.");
  if (o.summary != null && typeof o.summary !== "string") throw new UserError("Virheellinen yhteenveto.");
  if (o.output != null && typeof o.output !== "string") throw new UserError("Virheellinen loki.");
  await touchHelper(s, helper);
  const row = await s.ops.get(o.id);
  if (row) {
    const secrets = secretsOf(s);
    // steps from the whole text, before the output is cut to its tail
    const steps = parseSteps(scrub((o.output as string | undefined) ?? "", secrets));
    const done = await s.ops.finish(o.id, {
      status: o.status,
      at: s.now().toISOString(),
      exitCode: (o.exit_code as number | null | undefined) ?? null,
      summary: oneLine((o.summary as string | undefined) || (o.status === "ok" ? "Valmis." : "Epäonnistui."), 200, secrets),
      output: sanitiseOutput((o.output as string | undefined) ?? "", secrets, row.action === "logs" ? { lines: LOGS_MAX_LINES, bytes: LOGS_MAX_BYTES } : undefined),
      steps: JSON.stringify(steps),
    });
    if (done) await resultEvent(s, row, o.status === "ok" ? "valmis" : "epäonnistui");
  }
  if (o.state !== undefined) await storeState(s, o.state);
}

/** A heartbeat with a snapshot: the object itself or `{state: {...}}`. */
export async function stateOps(s: Services, payload: unknown, helper?: string): Promise<void> {
  await touchHelper(s, helper);
  const p = payload as { state?: unknown } | null;
  await storeState(s, p && typeof p === "object" && !Array.isArray(p) && "state" in p ? p.state : payload);
}
