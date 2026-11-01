/**
 * Checks for input from the browser, the command line and the environment. Each helper returns the clean value
 * or throws a UserError with a message safe to show. Nothing checked here is written to the filesystem or put in a
 * command: the values are URL origins, IANA zone names, small integers and flags.
 */
import { UserError } from "./errors.ts";
import { limitField } from "./limits.ts";

const HISTORY_DAYS = { min: limitField("historyDays").min, max: limitField("historyDays").max };
export const MAX_SYNCS_PER_DAY = 4;

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);

/** An http(s) origin only: no credentials, path, query or fragment. */
export function parseBaseUrl(value: unknown): string {
  const problem = UserError.of("check.address");
  if (typeof value !== "string" || value.length > 200 || /[\s\x00-\x1f\x7f\\]/.test(value)) throw problem;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw problem;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw problem;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw problem;
  if (!HOSTNAME.test(url.hostname) && !/^\[[0-9a-f:.]+\]$/.test(url.hostname)) throw problem;
  return url.origin;
}

/** An IANA zone name the runtime knows, e.g. Europe/Helsinki. */
export function parseTimezone(value: unknown): string {
  const problem = UserError.of("check.timezone");
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+-]{0,30}(?:\/[A-Za-z0-9_+-]{1,30}){0,2}$/.test(value)) throw problem;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    throw problem;
  }
  return value;
}

/** 0–4 distinct whole hours; an empty list means manual fetching only. */
export function parseSyncHours(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_SYNCS_PER_DAY) throw UserError.of("check.sync_count", { max: MAX_SYNCS_PER_DAY });
  if (!value.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) throw UserError.of("check.sync_hour");
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

export function parseHistoryDays(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < HISTORY_DAYS.min || (value as number) > HISTORY_DAYS.max) {
    throw UserError.of("check.history_days", { min: HISTORY_DAYS.min, max: HISTORY_DAYS.max });
  }
  return value as number;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw UserError.of("check.flag");
  return value;
}

/** An optional flag: false when absent, a 400 for anything but a boolean (the string "false" is not one). */
export function parseOptionalBoolean(value: unknown): boolean {
  return value === undefined || value === null ? false : parseBoolean(value);
}

/** `YYYY-MM-DD` that exists on the calendar: 2026-02-30 does not. */
export function isIsoDate(value: unknown): value is string {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// the days a household's rows can have: a range past them is a mistake or a probe, and every loop over a range stays short
const RANGE_FIRST = "1900-01-01";
const RANGE_LAST = "2199-12-31";

/**
 * The ends of a range from the browser, each optional: a calendar date from 1900 to 2199, `from` at or before `to`, or a
 * 400. A year-9999 `to` once froze the server.
 */
export function parseDateRange<F extends string | undefined, T extends string | undefined>(from: F, to: T): { from: F; to: T } {
  const bad = (d: string | undefined) => d !== undefined && (!isIsoDate(d) || d < RANGE_FIRST || d > RANGE_LAST);
  if (bad(from) || bad(to) || (from !== undefined && to !== undefined && (from as string) > (to as string))) throw UserError.of("check.date_range");
  return { from, to };
}

/** A calendar date, or a 400 with the catalogue message `code`. */
export function parseIsoDate(value: unknown, code: "check.date" | "check.date_range" = "check.date"): string {
  if (!isIsoDate(value)) throw UserError.of(code);
  return value;
}

/** A loan as a figure names it: a saved loan's UUID, or `account:` and the id of a connected account (at most 200 characters, no space or comma). */
const LOAN_REF = /^(?:[0-9a-f-]{36}|account:[^\s,]{1,200})$/;

/** The loan of a figure of one loan, or a 400. Absent stays absent. */
export function parseLoanRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !LOAN_REF.test(value)) throw UserError.of("check.loan");
  return value;
}

/**
 * A JSON object with only the listed keys. Unknown keys are refused rather
 * than ignored, so a typo or a probe never silently "succeeds".
 */
export function strictObject<K extends string>(value: unknown, allowed: readonly K[]): Partial<Record<K, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw UserError.of("check.body_shape");
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) throw UserError.of("check.field", { name: key.slice(0, 40) });
  }
  return value as Partial<Record<K, unknown>>;
}

const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Where the outside notices go: an https address (a webhook) or an ntfy topic. The address is a secret in practice (a
 * webhook's path, a public topic's name), so the caller seals it. An address of this machine or an IP number is refused.
 */
export function parseNoticeAddress(value: unknown): string {
  const problem = UserError.of("check.notice_address");
  if (typeof value !== "string") throw problem;
  const text = value.trim();
  if (NTFY_TOPIC.test(text)) return text;
  if (text.length > 300 || /[\s\x00-\x1f\x7f\\]/.test(text)) throw problem;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw problem;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw problem;
  const labels = url.hostname.split(".");
  if (labels.length < 2 || !HOSTNAME.test(url.hostname) || /^\d+$/.test(labels[labels.length - 1]!) || labels[0] === "localhost" || /\.(localhost|local|internal)$/.test(url.hostname)) throw problem;
  return url.href;
}

/** The token sent as a Bearer header: visible characters only. */
export function parseNoticeToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 300 || !/^[\x21-\x7e]+$/.test(value)) throw UserError.of("check.notice_token");
  return value;
}

// ── the copy to another machine (services/offsite.ts) ────
// The same forms are checked again in bash (scripts/lib/ops-offsite.sh) before a value reaches ssh or sftp.

const OFFSITE_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** A host name or an IPv4 number: it starts with a letter or a digit, so it is never read as an option. */
export const OFFSITE_HOST = new RegExp(`^${OFFSITE_LABEL}(?:\\.${OFFSITE_LABEL})*$`);
export const OFFSITE_USER = /^[a-z0-9_][a-z0-9_.-]{0,31}$/;
/** A folder on the other machine: relative to the sign-in folder or absolute, no `..`, never starts with a dash. */
export const OFFSITE_DIR = /^[A-Za-z0-9_./][A-Za-z0-9_./-]{0,119}$/;

export function parseOffsiteHost(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text.length > 253 || !OFFSITE_HOST.test(text)) throw UserError.of("offsite.host");
  return text;
}

export function parseOffsitePort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) throw UserError.of("offsite.port");
  return value;
}

export function parseOffsiteUser(value: unknown): string {
  if (typeof value !== "string" || !OFFSITE_USER.test(value.trim())) throw UserError.of("offsite.user");
  return value.trim();
}

export function parseOffsiteDir(value: unknown): string {
  const text = typeof value === "string" ? value.trim().replace(/\/+$/, "") || "/" : "";
  if (!OFFSITE_DIR.test(text) || text.includes("//") || text.split("/").includes("..")) throw UserError.of("offsite.dir");
  return text;
}
