/**
 * Maintenance requests: what the browser may ask for, and the scrub applied to everything the host helper
 * sends back. The helper repeats the action list and the scrub in bash (`ACTIONS` and `scrub_out` in
 * scripts/ops-helper.sh); tools/repo-rules/parity.ts fails when the action lists differ.
 *
 * None of the twelve actions takes parameters. `access` applies the change of remote access the app has prepared in a
 * file of its own (services/access-request.ts); the request itself says nothing about it. `prerelease-on` and
 * `prerelease-off` are the two positions of one switch as two names, so that no value travels to the host. `port` is
 * reserved and refused. A new action needs an entry in OPS_ACTIONS and ACTION_SINCE and the helper's `ACTIONS` and
 * `case`. This list and the helper's are the gates: the table stores any name since migration 0017 dropped the CHECK
 * on ops_requests.action, and a row is only ever written for a name that parseOpsRequest let through.
 */
import { HttpUserError, UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";

/** The setting that holds when the host helper was last heard of (ISO): written at every real poll, report and state (services/ops.ts), read for the page and for the notice of a silent helper (services/db-health.ts). */
export const HELPER_SEEN_KEY = "ops_helper_seen";

export const OPS_ACTIONS = ["update", "rollback", "backup", "restart", "doctor", "check-update", "logs", "prune", "helper-renew", "access", "prerelease-on", "prerelease-off"] as const;
export type OpsAction = (typeof OPS_ACTIONS)[number];

/** Reserved for a later release. */
const RESERVED = ["port"];

/**
 * Read-only: they may run beside another request and need no password. This is the one list. The queries in
 * db/ops-repo.ts take it as a parameter, and the unique index idx_ops_one_active (migration 0007) names the same
 * three; a test compares the index with this list.
 */
export const READ_ONLY: readonly OpsAction[] = ["doctor", "check-update", "logs"];
/** Need the admin's password again. */
export const NEEDS_PASSWORD: readonly OpsAction[] = ["update", "rollback", "access"];

export const ROLLBACK_WORD = "PALAUTA";

export const OPS_ID = /^op_[0-9a-f]{16}$/;

export interface OpsInput {
  action: OpsAction;
  password: string;
  confirm: string;
}

export function parseOpsRequest(input: unknown): OpsInput {
  const o = strictObject(input, ["action", "params", "password", "confirm"] as const);
  if (typeof o.action !== "string") throw new UserError("Valitse toiminto.");
  if (RESERVED.includes(o.action)) throw new UserError("Tätä toimintoa ei voi vielä tehdä selaimessa.");
  if (!(OPS_ACTIONS as readonly string[]).includes(o.action)) throw new UserError("Tuntematon toiminto.");
  // no action takes parameters: an empty object or nothing
  if (o.params !== undefined && !(typeof o.params === "object" && o.params !== null && !Array.isArray(o.params) && Object.keys(o.params).length === 0)) {
    throw new UserError("Toiminto ei ota parametreja.");
  }
  for (const k of ["password", "confirm"] as const) {
    if (o[k] !== undefined && (typeof o[k] !== "string" || (o[k] as string).length > 1024)) throw new UserError("Virheellinen kenttä.");
  }
  return { action: o.action as OpsAction, password: (o.password as string | undefined) ?? "", confirm: (o.confirm as string | undefined) ?? "" };
}

// ── what a request is refused for ────────────────────────

/** Why a request is refused: the word for the `ops_denied` event and what the admin is told. */
export interface Refusal {
  why: string;
  error: UserError;
}

/** Another change is under way. The queue, the reset and the restore all say it with this sentence. */
export const busy = (): Refusal => ({ why: "toinen kesken", error: new HttpUserError("Toinen toiminto on kesken.", 409) });

/**
 * The word an admin types before a change that cannot be taken back (PALAUTA, TYHJENNÄ). Null when `typed` is the
 * word, to the letter. The rollback, the restore and the reset ask here, so a wrong word is refused and recorded the
 * same way by all three.
 */
export const wrongWord = (typed: unknown, word: string): Refusal | null => (typed === word ? null : { why: "vahvistus", error: new UserError(`Kirjoita ${word} vahvistukseksi.`) });

/** The id the helper may use in a path: op_ and 16 lowercase hex digits. */
export function validOpsId(id: unknown): id is string {
  return typeof id === "string" && OPS_ID.test(id);
}

// ── output scrub ─────────────────────────────────────────

export const OUTPUT_MAX_LINES = 200;
export const OUTPUT_MAX_BYTES = 16 * 1024;
/** `logs` returns up to 100 lines of each of three services, so it gets a larger window. */
export const LOGS_MAX_LINES = 320;
export const LOGS_MAX_BYTES = 48 * 1024;
const REDACTED = "[piilotettu]";

/**
 * Text from the host (update output, doctor lines, commit subjects) before it is stored or shown. It is
 * shown as text only. ANSI and control characters go; keys, tokens, long secret-looking runs and the app
 * secret are replaced. `secrets` are values known to this process.
 */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let t = text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
  t = t.replace(/-----BEGIN [A-Z ]*KEY-----[\s\S]*?(?:-----END [A-Z ]*KEY-----|$)/g, REDACTED);
  t = t.replace(/^.*\bAuthorization:.*$/gim, REDACTED);
  // bearer tokens and JWTs (Enable Banking), also when they are short or split by dots
  t = t.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);
  t = t.replace(/\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}/g, REDACTED);
  t = t.replace(/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=\S*/g, (m) => `${m.slice(0, m.indexOf("=") + 1)}${REDACTED}`);
  for (const s of secrets) if (s.length >= 8) t = t.split(s).join(REDACTED);
  return t.replace(/[A-Za-z0-9_=-]{40,}/g, REDACTED);
}

/** Scrubbed, then the last 200 lines and 16 KiB (more for the logs action). */
export function sanitiseOutput(text: string, secrets: readonly string[] = [], limits: { lines: number; bytes: number } = { lines: OUTPUT_MAX_LINES, bytes: OUTPUT_MAX_BYTES }): string {
  let t = scrub(text, secrets);
  const lines = t.split("\n");
  if (lines.length > limits.lines) t = lines.slice(-limits.lines).join("\n");
  const buf = Buffer.from(t, "utf8");
  if (buf.length > limits.bytes) {
    // cut at the front so the result stays at the end; drop a half character left at the cut
    t = buf.subarray(buf.length - limits.bytes).toString("utf8").replace(/^�+/, "");
  }
  return t;
}

/** One line for a card: scrubbed, newlines to spaces, at most `max` characters. */
export function oneLine(text: string, max: number, secrets: readonly string[] = []): string {
  return scrub(text, secrets).replace(/\s+/g, " ").trim().slice(0, max);
}

interface OpsStep {
  n: number;
  m: number;
  text: string;
  /** Seconds since the request began; absent where the helper's line is missing or malformed. */
  at?: number;
}
/** The most steps a request keeps, from the final report and from `ops progress` alike. */
export const MAX_STEPS = 20;
const STEP_LINE = /^STEP:\s*(\d{1,2})\/(\d{1,2})\s+(.{1,100})$/;
const STEP_AT_LINE = /^STEP-AT:\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,6})$/;

/** The one check of a step: `STEP: n/m text`, as the helper's scripts print it and as `ops progress` is given it. */
function parseStepLine(line: string): OpsStep | null {
  const hit = STEP_LINE.exec(line.trim());
  return hit ? { n: Number(hit[1]), m: Number(hit[2]), text: hit[3]!.trim() } : null;
}

/** The step `ops progress` was given: exactly n, m and text, through the same check as a line of the report. */
export function parseStepObject(v: unknown): OpsStep | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== "m,n,text" || typeof o.text !== "string" || !Number.isInteger(o.n) || !Number.isInteger(o.m)) return null;
  return parseStepLine(`STEP: ${o.n}/${o.m} ${o.text}`);
}

/** `STEP: n/m text` lines the helper's scripts print, for the progress list. A `STEP-AT: n/m seconds` line right after a step gives its `at`. */
export function parseSteps(output: string): OpsStep[] {
  const steps: OpsStep[] = [];
  let last: OpsStep | null = null;
  for (const line of output.split("\n")) {
    const at = STEP_AT_LINE.exec(line.trim());
    if (at && last && last.n === Number(at[1]) && last.m === Number(at[2])) last.at = Number(at[3]);
    last = null;
    if (at) continue;
    const step = parseStepLine(line);
    if (step && steps.length < MAX_STEPS) steps.push((last = step));
  }
  return steps;
}

// ── helper status ────────────────────────────────────────

export const HELPER_OK_MS = 3 * 60_000;
export const HELPER_STALE_MS = 24 * 3600_000;
export const REQUEST_EXPIRY_MS = 10 * 60_000;
export const RUNNING_TIMEOUT_MS = 30 * 60_000;
/** The lowest helper version this server understands; the helper sends its own in `ops poll --helper`. */
export const HELPER_MIN_VERSION = 1;
/**
 * The helper version that first knows each action (OPS_HELPER_VERSION in scripts/ops-helper.sh when its `case` got the
 * action). A request is queued only for a helper that has reported at least that version, and a poll from an older
 * helper does not hand it out: an action a helper does not know would otherwise be left unanswered. A new action
 * gets the helper version that ships it, so bump OPS_HELPER_VERSION with it.
 */
export const ACTION_SINCE: Record<OpsAction, number> = {
  update: 1,
  rollback: 1,
  backup: 1,
  restart: 1,
  doctor: 1,
  "check-update": 1,
  logs: 2,
  prune: 2,
  "helper-renew": 2,
  access: 3,
  "prerelease-on": 4,
  "prerelease-off": 4,
};

/** The first helper version that waits for the app's wake (WAKE_WAIT in scripts/ops-helper.sh): it starts a request within seconds. */
const WAKE_SINCE = 5;

export type HelperStatus = "ok" | "slow" | "off";

/** Section 1.7 of the spec. "off" covers never seen and silent for more than a day: buttons stay disabled. */
export function helperStatus(seenAt: string | null, now: Date): { status: HelperStatus; reason: "never" | "stale" | null } {
  if (!seenAt || Number.isNaN(Date.parse(seenAt))) return { status: "off", reason: "never" };
  const age = now.getTime() - Date.parse(seenAt);
  if (age < HELPER_OK_MS) return { status: "ok", reason: null };
  if (age <= HELPER_STALE_MS) return { status: "slow", reason: null };
  return { status: "off", reason: "stale" };
}

/**
 * True when a helper of this version knows the action. The oldest version this server serves knows its own actions
 * even when it never said which version it is.
 */
export function helperKnows(version: string | null | undefined, action: OpsAction): boolean {
  const since = ACTION_SINCE[action];
  if (since <= HELPER_MIN_VERSION) return true;
  const n = version == null ? NaN : Number.parseInt(version, 10);
  return n >= since;
}

/** The page shows its Huolto panel (logs, prune, helper-renew) when the helper knows all three. */
export function helperHasTools(version: string | null): boolean {
  return (["logs", "prune", "helper-renew"] as const).every((a) => helperKnows(version, a));
}

/** True when the helper waits for the app's wake. The version comes with every poll, so this is never stale as a snapshot field would be. */
export function helperWakes(version: string | null): boolean {
  const n = version === null ? NaN : Number.parseInt(version, 10);
  return n >= WAKE_SINCE;
}

/** True when the helper's version is older than this server expects. Unreadable versions count as old. */
export function helperOutdated(version: string | null): boolean {
  const n = version === null ? NaN : Number.parseInt(version, 10);
  return !(n >= HELPER_MIN_VERSION);
}

// ── state snapshot from the helper ───────────────────────

export interface OpsState {
  version?: string;
  build?: string;
  commit?: string;
  update_available?: boolean;
  /** Release mode only: the newest release the helper saw. Lets the server tell when update_available is stale. */
  latest_version?: string;
  behind_commits?: { hash: string; subject: string }[];
  checked_at?: string;
  can_rollback?: boolean;
  schema_changed?: boolean;
  mode?: string;
  port?: number;
  address?: string;
  /** Where the copy would answer after remote access goes off, by the rule the helper's `lan` uses. Absent until a helper that knows the field has reported. */
  lanAddress?: string;
  /** The switch for pre-releases as the host's `.env` has it (TALOUS_PRERELEASE). Absent until a helper that knows the field has reported. */
  prerelease?: "yes" | "no";
  /** `source`: the install follows a branch and has no releases to follow, so the page shows no switch. */
  channel?: "source" | "release";
  doctor?: { at: string; items: { id: string; level: "ok" | "warn" | "error"; title: string; detail: string; hint: string }[] };
  backups?: { name: string; size: number; at: string; kind: string }[];
}

/** Exactly X.Y.Z: the only shape of a release version the app compares. */
export const XYZ = /^\d+\.\d+\.\d+$/;
const isoOrNull = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
const text = (v: unknown, max: number, secrets: readonly string[]): string | undefined => (typeof v === "string" ? oneLine(v, max, secrets) : undefined);
/** An http or https URL of a host (a name, an IPv4 address or an IPv6 address in brackets) and an optional port. */
const LAN_ADDRESS = /^https?:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*\])(?::(\d{1,5}))?$/;
/** lanAddress is shown to an admin as the way in after the tunnel: whole and unchanged, or not at all (never cut or scrubbed into another address). */
function lanAddress(v: unknown, secrets: readonly string[]): string | undefined {
  if (typeof v !== "string" || v.length > 120) return undefined;
  const hit = LAN_ADDRESS.exec(v);
  if (!hit || (hit[1] !== undefined && (Number(hit[1]) < 1 || Number(hit[1]) > 65535))) return undefined;
  return scrub(v, secrets) === v ? v : undefined;
}

/**
 * The snapshot is data from outside: every field is checked, cut and scrubbed, unknown keys are dropped.
 * Fields the helper leaves out keep their old value (see mergeState).
 */
export function normaliseState(input: unknown, secrets: readonly string[] = []): OpsState {
  const out: OpsState = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return out;
  const o = input as Record<string, unknown>;
  const str = (k: string, max: number) => text(o[k], max, secrets);
  if (str("version", 40)) out.version = str("version", 40);
  if (str("build", 80)) out.build = str("build", 80);
  if (typeof o.commit === "string" && /^[0-9a-f]{4,40}$/.test(o.commit)) out.commit = o.commit;
  if (typeof o.update_available === "boolean") out.update_available = o.update_available;
  if (typeof o.latest_version === "string" && XYZ.test(o.latest_version)) out.latest_version = o.latest_version;
  if (typeof o.can_rollback === "boolean") out.can_rollback = o.can_rollback;
  if (typeof o.schema_changed === "boolean") out.schema_changed = o.schema_changed;
  if (isoOrNull(o.checked_at)) out.checked_at = isoOrNull(o.checked_at);
  if (str("mode", 20)) out.mode = str("mode", 20);
  if (str("address", 120)) out.address = str("address", 120);
  if (lanAddress(o.lanAddress, secrets)) out.lanAddress = lanAddress(o.lanAddress, secrets);
  if (o.prerelease === "yes" || o.prerelease === "no") out.prerelease = o.prerelease;
  if (o.channel === "source" || o.channel === "release") out.channel = o.channel;
  if (Number.isInteger(o.port) && (o.port as number) >= 1 && (o.port as number) <= 65535) out.port = o.port as number;
  if (Array.isArray(o.behind_commits)) {
    out.behind_commits = o.behind_commits
      .slice(0, 30)
      .map((c) => {
        const r = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
        return { hash: typeof r.hash === "string" && /^[0-9a-f]{4,40}$/.test(r.hash) ? r.hash : "", subject: text(r.subject, 100, secrets) ?? "" };
      })
      .filter((c) => c.hash);
  }
  if (typeof o.doctor === "object" && o.doctor !== null && !Array.isArray(o.doctor)) {
    const d = o.doctor as Record<string, unknown>;
    const at = isoOrNull(d.at);
    if (at && Array.isArray(d.items)) {
      out.doctor = {
        at,
        items: d.items.slice(0, 40).map((i) => {
          const r = (typeof i === "object" && i !== null ? i : {}) as Record<string, unknown>;
          return {
            id: text(r.id, 40, secrets) ?? "",
            level: r.level === "ok" || r.level === "warn" || r.level === "error" ? r.level : "warn",
            title: text(r.title, 100, secrets) ?? "",
            detail: text(r.detail, 300, secrets) ?? "",
            hint: text(r.hint, 300, secrets) ?? "",
          };
        }),
      };
    }
  }
  if (Array.isArray(o.backups)) {
    out.backups = o.backups.slice(0, 50).flatMap((b) => {
      const r = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
      const name = typeof r.name === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(r.name) ? r.name : null;
      const at = isoOrNull(r.at);
      if (!name || !at || !Number.isInteger(r.size) || (r.size as number) < 0) return [];
      return [{ name, size: r.size as number, at, kind: r.kind === "daily" || r.kind === "pre-update" || r.kind === "manual" ? r.kind : "manual" }];
    });
  }
  return out;
}

export function mergeState(old: OpsState, next: OpsState): OpsState {
  return { ...old, ...next };
}
