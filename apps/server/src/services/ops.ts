/**
 * Web maintenance (Asetukset > Ylläpito). The app never runs anything. An admin's request becomes a
 * row in ops_requests; a helper on the host polls the rows through the `ops` CLI (cli-ops.ts), runs fixed
 * scripts and reports back. Every attempt is written to security_events with an ops_ kind.
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { quickFileCheck } from "../db/backup-check.ts";
import { COPY_NAME, copiesNewestFirst, copyKind, type CopyKind, restorableCopyName } from "../db/backup-keep.ts";
import { atOrAbove } from "../db/migrate.ts";
import type { OpsRequest } from "../db/ops-repo.ts";
import { newestIntactCopy } from "../db/restore.ts";
import type { User } from "../db/rows.ts";
import { verifyPassword } from "../security/password.ts";
import { clearWake, deleteAccessRequest, readAccessRequest, touchWake, writeAccessRequest } from "./access-request.ts";
import type { Services } from "./context.ts";
import { HttpUserError, TooManyAttempts, tooManyMessage, UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import { refuser } from "./ops-danger.ts";
import {
  busy,
  HELPER_MIN_VERSION,
  HELPER_SEEN_KEY,
  helperHasTools,
  helperKnows,
  helperOutdated,
  helperStatus,
  helperWakes,
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
  type Refusal,
  REQUEST_EXPIRY_MS,
  ROLLBACK_WORD,
  RUNNING_TIMEOUT_MS,
  LOGS_MAX_BYTES,
  LOGS_MAX_LINES,
  sanitiseOutput,
  scrub,
  validOpsId,
  wrongWord,
  XYZ,
} from "./ops-validate.ts";
import { takeWatchdog } from "./ops-watchdog.ts";
import { recordEvent } from "./security.ts";

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
  access: "etäkäyttö",
  // no colon in a name: the audit list splits an event at its first ": "
  "prerelease-on": "uudet versiot tarjolle heti",
  "prerelease-off": "uudet versiot tarjolle kahden päivän päästä",
};

/** These also reach the other admins as a notice. */
const NOTIFY: readonly OpsAction[] = ["update", "rollback", "restart", "access", "prerelease-on", "prerelease-off"];

export const ENABLE_COMMAND = "./scripts/install.sh --ops-helper";
const MUTATING_PER_MINUTE_MS = 60_000;
const PER_HOUR = 20;

/** Where a call came from, for the security events. */
export interface Req {
  ip: string | null;
  userAgent: string | null | undefined;
}

const secretsOf = (s: Services): string[] => (s.config.appSecret ? [s.config.appSecret] : []);
/** What looks like a team's host name or a tunnel token (an audience tag looks like one too), by the forms of access-request.ts. */
const ACCESS_LOOKS = /[a-z0-9-]+\.cloudflareaccess\.com|[A-Za-z0-9_=-]{20,}/gi;
/**
 * What a helper's words are cleaned of: the app secret, and for `access` the tunnel token and the Access pair that wait
 * in the request file. `byLooks`: the file is gone, as it is for a report that comes after the timeout, so the words
 * are cleaned of whatever looks like one of the three.
 */
function secretsFor(s: Services, action: string): { secrets: string[]; byLooks: boolean } {
  const sent = action === "access" ? readAccessRequest(s) : null;
  const secrets = sent?.want === "tunnel" ? [...secretsOf(s), sent.tunnelToken, sent.accessAud, sent.teamDomain] : secretsOf(s);
  return { secrets, byLooks: action === "access" && !sent };
}

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
  await s.settings.set(HELPER_SEEN_KEY, s.now().toISOString());
  if (version && /^[0-9A-Za-z._-]{1,20}$/.test(version)) await s.settings.set(VERSION_KEY, version);
}

/** The one place a request is queued: the helper's wait is woken once the row has committed (an insert that lost is not). */
async function insertQueued(s: Services, row: Parameters<Services["ops"]["insert"]>[0]): Promise<boolean> {
  const queued = await s.ops.insert(row);
  if (queued) touchWake(s);
  return queued;
}

async function storeState(s: Services, input: unknown): Promise<void> {
  await takeWatchdog(s, input);
  const next = normaliseState(input, secretsOf(s));
  if (!Object.keys(next).length) return;
  await s.settings.set(STATE_KEY, JSON.stringify(mergeState(await loadSnapshot(s), next)));
}

/**
 * Where the copy answers once it has left the tunnel, by the helper's stored state (`lanAddress`, its form checked in
 * ops-validate.ts). Null from a helper that does not say, and for a value out of form: the page shows it in a sentence.
 */
export const lanAddressAfterTunnel = async (s: Services): Promise<string | null> => (await loadSnapshot(s)).lanAddress ?? null;

export async function helperInfo(s: Services) {
  const seenAt = await s.settings.get(HELPER_SEEN_KEY);
  const version = await s.settings.get(VERSION_KEY);
  const { status, reason } = helperStatus(seenAt, s.now());
  return { status, reason, seenAt, version, outdated: status !== "off" && helperOutdated(version), tools: helperHasTools(version), wakes: helperWakes(version), knowsPrerelease: helperKnows(version, "prerelease-on"), minVersion: HELPER_MIN_VERSION, enableCommand: ENABLE_COMMAND };
}

// ── backups kept by the app ──────────────────────────────

interface AppBackup {
  name: string;
  size: number;
  at: string;
  kind: CopyKind;
}

/**
 * The database copies in <data>/backups, newest first (the one listing of db/backup-keep.ts), what a restore saved
 * among them. An empty, cut-short or non-database file is left out (the copy code removes those, this covers one
 * left by a killed process).
 */
export function listAppBackups(s: Services): AppBackup[] {
  if (!s.backupDir) return [];
  const whole = (file: string): boolean => {
    try {
      return quickFileCheck(file) === null;
    } catch {
      return false; // removed meanwhile
    }
  };
  return copiesNewestFirst(s.backupDir, (name) => COPY_NAME.test(name))
    .filter((c) => whole(c.file))
    .slice(0, 30)
    .map(({ name, size, at }) => ({ name, size, at, kind: copyKind(name) }));
}

// ── what the page shows ──────────────────────────────────

const view = (r: OpsRequest) => ({
  id: r.id,
  action: r.action,
  label: (ACTION_LABEL as Record<string, string>)[r.action] ?? r.action,
  status: r.status,
  by: r.requestedByName,
  requestedAt: r.requestedAt,
  startedAt: r.claimedAt,
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

/** Made only by checkPassword: the admin's password was right in this call. */
export interface PasswordProof {
  readonly userId: string;
}
const proofs = new WeakSet<PasswordProof>();

/**
 * The admin's password in front of a change to the host: one limiter key, one gate and one `ops_denied` event for
 * maintenance requests and for remote access (remote-access.ts). The proof lets requestOp queue without a second hash.
 */
export async function checkPassword(s: Services, user: User, password: string, req: Req, what: string): Promise<PasswordProof> {
  const key = `ops:${user.id}`;
  const deny = async (): Promise<never> => {
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
  const proof = { userId: user.id };
  proofs.add(proof);
  return proof;
}

const newId = () => `op_${randomBytes(8).toString("hex")}`;

// ── what the queue refuses ───────────────────────────────

/** No helper, or one that does not know the action: asked before the password. */
async function helperRefusal(s: Services, action: OpsAction): Promise<Refusal | null> {
  if ((await helperInfo(s)).status === "off") return { why: "apuri ei käytössä", error: new HttpUserError("Ylläpitoapuri ei ole käytössä.", 409) };
  // an older helper would not answer an action it does not know, and the request would sit claimed until it times out
  if (helperKnows(await s.settings.get(VERSION_KEY), action)) return null;
  return { why: "apuri vanhentunut", error: new HttpUserError(`Ylläpitoapurista on uudempi versio. Päivitä se palvelimella: ${ENABLE_COMMAND}`, 409) };
}

/** Another change under way, one a minute, and the hour's cap: asked after the password. */
async function slotRefusal(s: Services, action: OpsAction): Promise<Refusal | null> {
  const mutating = !READ_ONLY.includes(action);
  const since = (ms: number) => new Date(s.now().getTime() - ms).toISOString();
  if (mutating && (await s.ops.hasActiveMutating(READ_ONLY))) return busy();
  if (mutating && (await s.ops.countSince(since(MUTATING_PER_MINUTE_MS), READ_ONLY)) > 0) return { why: "liian tiheään", error: new TooManyAttempts("Odota hetki ennen seuraavaa toimintoa.", 60) };
  if ((await s.ops.countSince(since(3600_000))) >= PER_HOUR) return { why: "tuntiraja", error: new TooManyAttempts("Liian monta pyyntöä tunnissa. Yritä myöhemmin.", 3600) };
  return null;
}

/**
 * Throws what requestOp would refuse `action` for right now, with no event. For a caller with work to do before it
 * queues (remote-access.ts asks Cloudflare first). requestOp asks again when it queues.
 */
export async function queueRefuses(s: Services, action: OpsAction): Promise<void> {
  await expireStale(s);
  const no = (await helperRefusal(s, action)) ?? (await slotRefusal(s, action));
  if (no) throw no.error;
}

/**
 * `proof`: the caller checked the password in this same call (remote access does, before it asks Cloudflare anything).
 * `access` is queued only that way: its request file is written by the remote access page, never by this route.
 */
export async function requestOp(s: Services, user: User, raw: unknown, req: Req, proof?: PasswordProof) {
  const input = parseOpsRequest(raw);
  const { action } = input;
  const label = ACTION_LABEL[action];
  const refuse = refuser(s, user.id, req, label);
  const checked = proof !== undefined && proofs.has(proof) && proof.userId === user.id;
  if (action === "access" && !checked) await refuse({ why: "pyydetty ylläpidosta", error: new UserError("Etäkäyttöä muutetaan kohdassa Asetukset > Palvelin > Etäkäyttö.") });
  await expireStale(s);

  await refuse(await helperRefusal(s, action));
  if (action === "rollback") {
    await refuse(wrongWord(input.confirm, ROLLBACK_WORD));
    if (!(await loadSnapshot(s)).can_rollback) await refuse({ why: "ei palautettavaa", error: new UserError("Edellistä versiota ei ole tallessa.") });
  }
  if (NEEDS_PASSWORD.includes(action) && !checked) await checkPassword(s, user, input.password, req, label);

  await refuse(await slotRefusal(s, action));

  const id = newId();
  // the insert is the last word on the one active request: two calls at once both pass the look above
  if (!(await insertQueued(s, { id, action, requestedBy: user.id, at: s.now().toISOString() }))) await refuse(busy());
  await recordEvent(s, { kind: "ops_request", userId: user.id, ...req, detail: `${label}: jonossa` });
  if (NOTIFY.includes(action)) await notifyAdmins(s, user, `${user.displayName} käynnisti toiminnon: ${label}`);
  return view((await s.ops.get(id))!);
}

/**
 * The one request queued with no admin's password: the server itself takes back a remote access nobody got in through
 * (remote-access-trial.ts, from its timer and the hourly tick; no route leads here). It writes the request file itself,
 * so `lan` is all it can ask of the helper. `userId` is the admin who turned remote access on. Null when the helper is
 * away or the queue is taken: the caller looks again later.
 */
export async function queueOwnLan(s: Services, userId: string): Promise<string | null> {
  await expireStale(s);
  if ((await helperInfo(s)).status === "off" || !helperKnows(await s.settings.get(VERSION_KEY), "access") || (await s.ops.hasActiveMutating(READ_ONLY))) return null;
  const id = newId();
  writeAccessRequest(s, { want: "lan" });
  if (!(await insertQueued(s, { id, action: "access", requestedBy: userId, at: s.now().toISOString() }))) {
    deleteAccessRequest(s);
    return null;
  }
  await recordEvent(s, { kind: "ops_request", userId, detail: `${ACTION_LABEL.access}: jonossa, palvelin perui etäkäytön itse` });
  return id;
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
  await recordEvent(s, { kind: "ops_request", userId: user.id, ...req, detail: `${(ACTION_LABEL as Record<string, string>)[row.action] ?? row.action}: peruutettu` });
}

/** The newest database copy, after the password. Returns the file to stream. */
export async function backupForDownload(s: Services, user: User, password: string, req: Req): Promise<{ stream: ReturnType<typeof createReadStream>; name: string; size: number }> {
  const key = `dl:${user.id}`;
  const attempt = s.opsDownloadLimiter.consume(key);
  if (attempt.wait) throw new TooManyAttempts("Liian monta latausta tunnissa. Yritä myöhemmin.", attempt.wait);
  await checkPassword(s, user, password, req, "varmuuskopion lataus");
  const copies = listAppBackups(s);
  if (!s.backupDir || !copies.length) throw new UserError("Varmuuskopiota ei ole vielä. Ota ensin varmuuskopio.");
  // the copy a restore would take (db/restore.ts): the full check runs on the file that is about to leave the
  // machine, and what a restore saved of the database it replaced (pre-restore-*) is never handed out as the newest
  const newest = newestIntactCopy(s.backupDir);
  for (const b of copies.slice(0, Math.max(0, copies.findIndex((c) => c.name === newest?.name)))) {
    if (restorableCopyName(b.name)) console.error(`backup download: ${b.name} failed its check and is skipped`);
  }
  if (!newest) throw new UserError("Varmuuskopiot eivät läpäisseet tarkistusta. Ota uusi varmuuskopio.");
  await recordEvent(s, { kind: "ops_download", userId: user.id, ...req, detail: `varmuuskopion lataus: ladattu (${newest.name})`, notify: false });
  await notifyAdmins(s, user, `${user.displayName} latasi tietokannan varmuuskopion`);
  return { stream: createReadStream(newest.file), name: newest.name, size: newest.size };
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

export async function pollOps(s: Services, opts: { helper?: string; done: string[]; dry?: boolean }): Promise<PolledRequest | null> {
  // `ops poll --dry`, the helper's self-test: the database answers one read, and nothing is written, expired or handed out
  if (opts.dry) {
    await s.ops.oldestQueued([]);
    return null;
  }
  // the wake goes first: a request queued after this line leaves its own wake, and the look below may even find it
  clearWake(s);
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
    // the table also accepts port, and a row could be written by anything with file access
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
    const { secrets, byLooks } = secretsFor(s, row.action);
    // scrubbed first, so a look-alike is found whole: scrub joins what a colour code or a control character had split
    const said = (text: unknown) => (typeof text !== "string" ? "" : byLooks ? scrub(text, secrets).replace(ACCESS_LOOKS, "[piilotettu]") : text);
    const output = said(o.output);
    // steps from the whole text, before the output is cut to its tail
    const steps = parseSteps(scrub(output, secrets));
    const done = await s.ops.finish(o.id, {
      status: o.status,
      at: s.now().toISOString(),
      exitCode: (o.exit_code as number | null | undefined) ?? null,
      summary: oneLine(said(o.summary) || (o.status === "ok" ? "Valmis." : "Epäonnistui."), 200, secrets),
      output: sanitiseOutput(output, secrets, row.action === "logs" ? { lines: LOGS_MAX_LINES, bytes: LOGS_MAX_BYTES } : undefined),
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
