/**
 * Checks for input from the browser, the command line and the environment. Each helper returns the clean value
 * or throws a UserError with a message safe to show. Nothing checked here is written to the filesystem or put in a
 * command: the values are URL origins, IANA zone names, small integers and flags.
 */
import { UserError } from "./errors.ts";

export const HISTORY_DAYS = { min: 30, max: 730 };
export const MAX_SYNCS_PER_DAY = 4;

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);

/** An http(s) origin only: no credentials, path, query or fragment. */
export function parseBaseUrl(value: unknown): string {
  const problem = new UserError("Anna osoite muodossa https://talous.oma.fi (ilman polkua).");
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
  const problem = new UserError("Tuntematon aikavyöhyke.");
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
  if (!Array.isArray(value) || value.length > MAX_SYNCS_PER_DAY || !value.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) {
    throw new UserError(`Valitse enintään ${MAX_SYNCS_PER_DAY} hakuaikaa.`);
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

export function parseHistoryDays(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < HISTORY_DAYS.min || (value as number) > HISTORY_DAYS.max) {
    throw new UserError(`Historian pituus on ${HISTORY_DAYS.min}–${HISTORY_DAYS.max} päivää.`);
  }
  return value as number;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new UserError("Arvon pitää olla päällä tai pois.");
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

/** A calendar date, or a 400 with `message`. */
export function parseIsoDate(value: unknown, message = "Virheellinen päivämäärä."): string {
  if (!isIsoDate(value)) throw new UserError(message);
  return value;
}

/**
 * A JSON object with only the listed keys. Unknown keys are refused rather
 * than ignored, so a typo or a probe never silently "succeeds".
 */
export function strictObject<K extends string>(value: unknown, allowed: readonly K[]): Partial<Record<K, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UserError("Pyynnön sisältö on väärän muotoinen.");
  for (const key of Object.keys(value)) {
    if (!(allowed as readonly string[]).includes(key)) throw new UserError(`Tuntematon kenttä: ${key.slice(0, 40)}`);
  }
  return value as Partial<Record<K, unknown>>;
}
