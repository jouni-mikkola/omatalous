/**
 * Checks for input from the browser, the command line and the environment. Each helper returns the clean value
 * or throws a UserError with a message safe to show. Nothing checked here is written to the filesystem or put in a
 * command: the values are URL origins, IANA zone names, small integers and flags.
 */
import { UserError } from "./errors.ts";
import { limitField } from "./limits.ts";

const HISTORY_DAYS = { min: limitField("historyDays").min, max: limitField("historyDays").max };
const MAX_SYNCS_PER_DAY = 4;

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

/** Control characters, and the ones nobody sees: a name of zero-width spaces would show as a blank row. */
export const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * A name a person typed, trimmed: none of the UNSEEN characters anywhere in it and at most `max` characters after the
 * trim, or a 400. The text is checked before the trim, so a name of line breaks alone is refused and not read as empty.
 * An empty name passes: the caller decides what it means.
 */
export function parseNameText(text: string, max: number): string {
  const name = text.trim();
  if (UNSEEN.test(text) || name.length > max) throw UserError.of("check.field_bad");
  return name;
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

