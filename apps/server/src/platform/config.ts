/**
 * Configuration from environment variables and secret files (entry/node.ts).
 * Only infrastructure lives here; everything an admin can change in the
 * browser (address, time zone, sync times, the shared Enable Banking app) is
 * stored in the database and these values are its defaults, see
 * services/instance.ts.
 */
import { isAppSecret } from "../entry/app-secret.ts";

export interface EnableBankingConfig {
  appId: string;
  privateKeyPem: string;
}

/** Settings an admin changes in the browser; the environment only seeds them. */
export interface InstanceSettings {
  /** Address the app is opened at: bank redirect, cookies, CSRF origin. */
  appBaseUrl: string;
  timezone: string;
  /** Local hours (0–23) of the automatic fetch; PSD2 allows at most 4 a day. */
  syncHours: number[];
  /** Days of history to request on the first sync of an account. */
  historyDays: number;
  /** Look up unknown merchants' industry in the public trade register (services/industry.ts). */
  industryLookup: boolean;
}

/** The app's own check of Cloudflare Access (security/cf-access.ts). */
export interface AccessConfig {
  /** Audience tag of the Access application in front of this copy. */
  aud: string;
  /** The Zero Trust team's host: the issuer of the tokens and the only host their keys are fetched from. */
  teamDomain: string;
}

/** An Access application's audience tag: 64 hex characters, lower case as Cloudflare writes it. */
export const ACCESS_AUD = /^[0-9a-f]{64}$/;
/** `<team>.cloudflareaccess.com`: one label and the fixed suffix, so the value can name no other host, port or path. */
export const ACCESS_TEAM_DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

export interface Config {
  defaults: InstanceSettings;
  /** Set by CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN together; null means the check is off. */
  access: AccessConfig | null;
  /**
   * Encrypts the bank keys stored in the database. Lives in a file outside
   * the database (Docker: /secrets/app_secret, created on first start).
   */
  appSecret: string | null;
  sessionDays: number;
  /**
   * Session cookie name, per instance (`talous_<INSTANCE_NAME>`). Browsers share cookies between ports of
   * one host, so two instances on a machine need different names. Read from the environment so a
   * restored or cloned database cannot bring the collision back.
   */
  sessionCookie: string;
  /** Behind Caddy / Cloudflare Tunnel: trust X-Forwarded-For / -Proto. */
  trustProxy: boolean;
  /** One-time code for creating the first admin in the browser. */
  setupCode: string | null;
  /** PBKDF2 iterations; lower only for tests. */
  passwordIterations: number;
  /** Optional instance app from the environment (EB_APP_ID + EB_PRIVATE_KEY_FILE); one saved in the browser wins. */
  enableBanking: EnableBankingConfig | null;
  bank: {
    /** Overrides the redirect URL derived from the address (rarely needed). */
    redirectUrl: string | null;
    /** The static return page used for plain-http installs (EB_RELAY_URL); null means the project's own. */
    relayUrl: string | null;
    consentDays: number;
    /** Extra host names (with their subdomains) the bank's consent page may be on, on top of the built-in list (EB_AUTH_HOSTS). */
    authHosts: string[];
    /** Where the bank's API is (EB_API_URL), for the fake bank of the browser specs. Always a loopback address; undefined means Enable Banking's own. */
    apiUrl: string | undefined;
  };
}

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/**
 * EB_API_URL moves the bank's API to a stand-in on this machine. The signed requests of the bank key go wherever it
 * points, so any other host stops the start. It is read here and nowhere else: not from the database, not from the browser.
 */
function bankApiUrl(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const url = URL.canParse(text) ? new URL(text) : null;
  if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password || !LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new Error("EB_API_URL must be an http or https address on this machine (127.0.0.1, localhost or [::1]); the bank's API is not reached anywhere else.");
  }
  return url.origin;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** "6,18" → [6, 18]; invalid entries are ignored. */
function hours(value: string | undefined, fallback: number[]): number[] {
  if (!value?.trim()) return fallback;
  const list = value.split(",").map((h) => Number(h.trim()));
  const valid = [...new Set(list.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b).slice(0, 4);
  return valid.length ? valid : fallback;
}

/** A text that is no app secret (too short, entry/app-secret.ts) is treated as missing. */
function validSecret(secret: string): string | null {
  if (!secret) return null;
  if (!isAppSecret(secret)) {
    console.warn("APP_SECRET is shorter than 32 characters and is not used. Bank keys cannot be stored until it is fixed.");
    return null;
  }
  return secret;
}

/**
 * A fixed setup code is all a stranger needs to claim a copy that has no users yet. One shorter than 16 characters
 * is refused at start, and a generated code (19 characters) is used instead.
 */
function validSetupCode(code: string | undefined): string | null {
  const value = code?.trim();
  if (!value) return null;
  if (value.length < 16) {
    console.error(
      "SETUP_CODE is shorter than 16 characters and is not used. A generated code works instead: docker compose exec banking node dist/node.js setup-code. To use your own, set one of 16 characters or more in .env.",
    );
    return null;
  }
  return value;
}

/** Cookie names allow [a-z0-9_-] here; compose passes INSTANCE_NAME, existing installs have none and are "banking-app". */
function cookieName(instance: string | undefined): string {
  const name = (instance ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
  return `talous_${name || "banking-app"}`;
}

/**
 * CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN turn on the check of Cloudflare Access's signature. Half a pair or a value
 * of the wrong form stops the start: a copy that ran without the check its `.env` asks for would hide the mistake.
 * Letter case is not a mistake (host names and hex have none), so both are lowered first.
 */
function accessConfig(env: Env): AccessConfig | null {
  const aud = (env.CF_ACCESS_AUD ?? "").trim().toLowerCase();
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim().toLowerCase();
  if (!aud && !teamDomain) return null;
  if (!aud || !teamDomain) throw new Error("CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN go together: set both in .env, or neither.");
  if (!ACCESS_AUD.test(aud)) throw new Error("CF_ACCESS_AUD is not an Access application's audience tag (64 hex characters).");
  if (!ACCESS_TEAM_DOMAIN.test(teamDomain)) throw new Error("CF_ACCESS_TEAM_DOMAIN is not of the form <team>.cloudflareaccess.com (no https://, port or path).");
  return { aud, teamDomain };
}

export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim();
}

export function loadConfig(env: Env, files: { privateKeyPem?: string; appSecret?: string } = {}): Config {
  const pem = normalizePem(files.privateKeyPem ?? env.EB_PRIVATE_KEY ?? "");
  return {
    defaults: {
      // without an address the app is opened on this machine, at the port it listens on
      appBaseUrl: (env.APP_BASE_URL || `http://localhost:${int(env.PORT, 8080)}`).replace(/\/+$/, ""),
      timezone: env.TZ || "Europe/Helsinki",
      syncHours: hours(env.SYNC_HOURS, [6, 18]),
      historyDays: int(env.HISTORY_DAYS, 730),
      industryLookup: env.INDUSTRY_LOOKUP !== "false",
    },
    access: accessConfig(env),
    appSecret: validSecret((files.appSecret ?? env.APP_SECRET ?? "").trim()),
    sessionDays: int(env.SESSION_DAYS, 30),
    sessionCookie: cookieName(env.INSTANCE_NAME),
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
    setupCode: validSetupCode(env.SETUP_CODE),
    passwordIterations: int(env.PASSWORD_ITERATIONS, 600_000),
    enableBanking: env.EB_APP_ID && pem ? { appId: env.EB_APP_ID, privateKeyPem: pem } : null,
    bank: {
      redirectUrl: env.EB_REDIRECT_URL?.trim() || null,
      relayUrl: /^https:\/\/[^\s]+$/.test(env.EB_RELAY_URL?.trim() ?? "") ? env.EB_RELAY_URL!.trim() : null,
      consentDays: int(env.EB_CONSENT_DAYS, 180),
      authHosts: (env.EB_AUTH_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9][a-z0-9.-]{1,100}$/.test(h)),
      apiUrl: bankApiUrl(env.EB_API_URL),
    },
  };
}

/** One formatter per time zone: making one costs far more than using it, and an answer of the dashboard asks for many days. */
const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>();
function dayFormat(timezone: string): Intl.DateTimeFormat {
  let f = DAY_FORMATS.get(timezone);
  if (!f) {
    // an unknown zone throws here, as before, and is not kept
    f = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    DAY_FORMATS.set(timezone, f);
  }
  return f;
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timezone: string, now = new Date()): string {
  return dayFormat(timezone).format(now);
}

/**
 * The instant as an ISO timestamp in the given time zone, with its offset: `2026-10-12T01:30:00+03:00`. Its first ten
 * characters are the local day, which a UTC timestamp gets wrong in the first hours of a day.
 */
export function isoIn(timezone: string, now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // longOffset says "GMT+03:00", or just "GMT" at zero
  const offset = (parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** Local hour (0–23) in the given time zone. */
export function hourIn(timezone: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
}
